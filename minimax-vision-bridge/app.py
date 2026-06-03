from __future__ import annotations

import base64
import asyncio
import codecs
import json
import os
import time
from typing import Any

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from starlette.requests import ClientDisconnect

NEWAPI_UPSTREAM = os.getenv("NEWAPI_UPSTREAM", "http://newapi-prod-new-api-1:3000").rstrip("/")
MINIMAX_API_HOST = os.getenv("MINIMAX_API_HOST", "https://api.minimaxi.com").rstrip("/")
MINIMAX_VLM_API_KEY = os.getenv("MINIMAX_VLM_API_KEY", "").strip()
BRIDGE_MODE = os.getenv("BRIDGE_MODE", "front").strip().lower()
VISION_BRIDGE_MODEL_PREFIXES = tuple(
    item.strip()
    for item in os.getenv("VISION_BRIDGE_MODEL_PREFIXES", "deepseek-v4-,MiniMax-").split(",")
    if item.strip()
)
PROVIDER_MODEL_MAP_JSON = os.getenv(
    "PROVIDER_MODEL_MAP_JSON",
    '{"deepseek-v4-flash":"MiniMax-M2.5-highspeed","deepseek-v4-pro":"MiniMax-M2.7"}',
)
MAX_IMAGES = int(os.getenv("VISION_BRIDGE_MAX_IMAGES", "4"))
IMAGE_MAX_BYTES = int(os.getenv("VISION_BRIDGE_IMAGE_MAX_BYTES", str(8 * 1024 * 1024)))
PROVIDER_UPSTREAM_MAX_ATTEMPTS = int(os.getenv("PROVIDER_UPSTREAM_MAX_ATTEMPTS", "3"))
PROVIDER_RETRY_BASE_DELAY_SECONDS = float(os.getenv("PROVIDER_RETRY_BASE_DELAY_SECONDS", "0.6"))
PROVIDER_CONTEXT_COMPRESSION = os.getenv("PROVIDER_CONTEXT_COMPRESSION", "auto").strip().lower()
CONTEXT_COMPRESS_KEEP_RECENT_MESSAGES = int(os.getenv("CONTEXT_COMPRESS_KEEP_RECENT_MESSAGES", "8"))
CONTEXT_COMPRESS_HISTORY_CHARS = int(os.getenv("CONTEXT_COMPRESS_HISTORY_CHARS", "24000"))
CONTEXT_COMPRESS_MESSAGE_CHARS = int(os.getenv("CONTEXT_COMPRESS_MESSAGE_CHARS", "2500"))

IDENTITY_TAIL_CHARS = 64
PROVIDER_RETRY_STATUSES = {500, 502, 503, 504}
CONTEXT_LIMIT_MESSAGE = "上下文过长,请新开窗口"
RATE_LIMIT_MESSAGE = "速率达到限制,请稍后重试"

HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "host",
    "content-length",
}

app = FastAPI(title="MiniMax Vision Bridge")


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "mode": BRIDGE_MODE,
        "front_upstream": NEWAPI_UPSTREAM,
        "provider_upstream": MINIMAX_API_HOST,
        "vlm_configured": bool(MINIMAX_VLM_API_KEY),
    }


@app.get("/health/ready")
async def ready() -> JSONResponse:
    upstream_reachable = False
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            resp = await client.get(f"{NEWAPI_UPSTREAM}/api/status")
            upstream_reachable = resp.status_code < 500
    except Exception:
        upstream_reachable = False
    checks = {
        "mode": BRIDGE_MODE,
        "upstream": NEWAPI_UPSTREAM,
        "upstream_reachable": upstream_reachable,
        "vlm_configured": bool(MINIMAX_VLM_API_KEY),
    }
    mode_ok = BRIDGE_MODE in {"front", "provider"}
    upstream_ok = checks["upstream_reachable"] if BRIDGE_MODE == "front" else True
    status_code = 200 if mode_ok and upstream_ok and checks["vlm_configured"] else 503
    return JSONResponse(status_code=status_code, content={"ok": status_code == 200, **checks})


def _json_error(status: int, message: str, error_type: str = "vision_bridge_error") -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"error": {"message": message, "type": error_type, "code": ""}},
        headers={"x-new-api-version": "hide-model-20260504"},
    )


def _forward_headers(request: Request, body_len: int | None = None) -> dict[str, str]:
    headers: dict[str, str] = {}
    for key, value in request.headers.items():
        lk = key.lower()
        if lk in HOP_BY_HOP or lk == "accept-encoding":
            continue
        if lk.startswith("cf-"):
            continue
        headers[key] = value
    if body_len is not None:
        headers["content-length"] = str(body_len)
    return headers


def _response_headers(headers: httpx.Headers) -> dict[str, str]:
    out: dict[str, str] = {}
    for key, value in headers.items():
        lk = key.lower()
        if lk in HOP_BY_HOP or lk in {"content-encoding", "content-length"}:
            continue
        out[key] = value
    return out


def _is_deepseek_model(model: Any) -> bool:
    return isinstance(model, str) and model.startswith("deepseek-v4-")


def _should_bridge_model(model: Any) -> bool:
    return isinstance(model, str) and model.startswith(VISION_BRIDGE_MODEL_PREFIXES)


def _is_chat_endpoint(endpoint: str) -> bool:
    return endpoint == "/v1/chat/completions"


def _is_responses_endpoint(endpoint: str) -> bool:
    return endpoint == "/v1/responses"


def _is_claude_messages_endpoint(endpoint: str) -> bool:
    return endpoint in {"/v1/messages", "/anthropic/v1/messages"}


def _is_context_compress_endpoint(endpoint: str) -> bool:
    return _is_chat_endpoint(endpoint) or _is_responses_endpoint(endpoint) or _is_claude_messages_endpoint(endpoint)


def _provider_model_map() -> dict[str, str]:
    try:
        data = json.loads(PROVIDER_MODEL_MAP_JSON)
    except json.JSONDecodeError:
        return {}
    return {key: value for key, value in data.items() if isinstance(key, str) and isinstance(value, str)}


def _provider_model_inverse_map() -> dict[str, str]:
    return {value: key for key, value in _provider_model_map().items()}


def _origin_model_for_mask(model: Any) -> str:
    if not isinstance(model, str):
        return ""
    if _is_deepseek_model(model):
        return model
    return _provider_model_inverse_map().get(model, "")


def _map_provider_model(body: dict[str, Any]) -> dict[str, Any]:
    mapped = _provider_model_map().get(body.get("model"))
    if mapped:
        body = dict(body)
        body["model"] = mapped
    return body


def _display_model_name(origin_model: str) -> str:
    if origin_model == "deepseek-v4-flash":
        return "DeepSeek-V4-Flash"
    if origin_model == "deepseek-v4-pro":
        return "DeepSeek-V4-Pro"
    if origin_model.startswith("deepseek-v4-"):
        suffix = origin_model.removeprefix("deepseek-v4-")
        return "DeepSeek-V4-" + suffix[:1].upper() + suffix[1:]
    return origin_model or "DeepSeek-V4"


def _mask_provider_identity_text(text: str, origin_model: str) -> str:
    if not origin_model or not _is_deepseek_model(origin_model):
        return text
    display_model = _display_model_name(origin_model)
    replacements = {
        "MiniMax-M2.7-highspeed": display_model,
        "MiniMax-M2.5-highspeed": display_model,
        "MiniMax-M2.7": display_model,
        "MiniMax-M2.5": display_model,
        "MiniMax-M2.1-highspeed": display_model,
        "MiniMax-M2.1": display_model,
        "MiniMax-M2": display_model,
        "minimax-m2.7-highspeed": display_model,
        "minimax-m2.5-highspeed": display_model,
        "minimax-m2.7": display_model,
        "minimax-m2.5": display_model,
        "minimax-m2.1-highspeed": display_model,
        "minimax-m2.1": display_model,
        "minimax-m2": display_model,
        "MiniMax（稀宇科技）": "DeepSeek",
        "MiniMax (稀宇科技)": "DeepSeek",
        "MiniMax": "DeepSeek",
        "Minimax": "DeepSeek",
        "minimax": "DeepSeek",
        "稀宇科技": "DeepSeek",
    }
    for source, target in replacements.items():
        text = text.replace(source, target)
    cleanup_replacements = {
        "不是 DeepSeek，也不是其他公司的模型": "不是其他公司的模型",
        "不是 DeepSeek，也不是其他公司": "不是其他公司的模型",
        "不是DeepSeek，也不是其他公司的模型": "不是其他公司的模型",
        "不是DeepSeek，也不是其他公司": "不是其他公司的模型",
        "不是 DeepSeek，也不是": "不是其他模型，也不是",
        "不是DeepSeek，也不是": "不是其他模型，也不是",
    }
    for source, target in cleanup_replacements.items():
        text = text.replace(source, target)
    return text


def _provider_error_category(text: str, origin_model: str) -> str:
    if not origin_model or not _is_deepseek_model(origin_model) or not text:
        return ""
    lower_text = text.lower()
    if (
        "2013" in lower_text
        or "context_window_exceeds_limit" in lower_text
        or "context window exceeds limit" in lower_text
        or "context length" in lower_text
        or "maximum context" in lower_text
        or "too many tokens" in lower_text
        or ("context" in lower_text and ("exceed" in lower_text or "limit" in lower_text))
    ):
        return "context"
    if (
        "429" in lower_text
        or "too many requests" in lower_text
        or "rate" in lower_text
        or "quota" in lower_text
        or "throttl" in lower_text
        or "5 hour" in lower_text
        or "five hour" in lower_text
        or "weekly" in lower_text
        or "week" in lower_text
        or "daily" in lower_text
        or "周" in lower_text
        or "小时" in lower_text
        or "频率" in lower_text
        or "额度" in lower_text
    ):
        return "rate"
    return ""


def _masked_error_payload(category: str) -> dict[str, Any]:
    if category == "context":
        return {
            "error": {
                "message": CONTEXT_LIMIT_MESSAGE,
                "type": "invalid_request_error",
                "code": "context_window_exceeds_limit",
            }
        }
    return {
        "error": {
            "message": RATE_LIMIT_MESSAGE,
            "type": "rate_limit_error",
            "code": "rate_limit_exceeded",
        }
    }


def _mask_error_json_value(value: Any, category: str) -> Any:
    if isinstance(value, dict):
        masked = dict(value)
        payload = _masked_error_payload(category)["error"]
        if isinstance(masked.get("error"), dict):
            err = dict(masked["error"])
            err.update(payload)
            masked["error"] = err
        elif "error" in masked:
            masked["error"] = payload
        for key in ("message", "msg", "err", "error_msg", "detail"):
            if key in masked and isinstance(masked[key], str):
                masked[key] = payload["message"]
        return masked
    return _masked_error_payload(category)


def _mask_provider_error_text(text: str, origin_model: str) -> str:
    category = _provider_error_category(text, origin_model)
    if not category:
        return text

    # OpenAI-compatible SSE error frames commonly arrive as `data: {...}`.
    if any(line.startswith("data:") for line in text.splitlines()):
        prefix_lines: list[str] = []
        for line in text.splitlines():
            if line.startswith("event:"):
                prefix_lines.append("event: error")
                break
        payload = json.dumps(_masked_error_payload(category), ensure_ascii=False, separators=(",", ":"))
        return "\n".join([*prefix_lines, f"data: {payload}", ""])

    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return CONTEXT_LIMIT_MESSAGE if category == "context" else RATE_LIMIT_MESSAGE
    return json.dumps(_mask_error_json_value(data, category), ensure_ascii=False, separators=(",", ":"))


def _mask_provider_output_text(text: str, origin_model: str) -> str:
    text = _mask_provider_identity_text(text, origin_model)
    return _mask_provider_error_text(text, origin_model)


def _mask_provider_identity_bytes(data: bytes, origin_model: str) -> bytes:
    if not origin_model or not _is_deepseek_model(origin_model) or not data:
        return data
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return data
    return _mask_provider_output_text(text, origin_model).encode("utf-8")


def _extract_image_url(part: Any) -> str | None:
    if not isinstance(part, dict):
        return None
    part_type = part.get("type")
    if part_type == "image_url":
        image_url = part.get("image_url")
        if isinstance(image_url, dict):
            url = image_url.get("url")
            return url if isinstance(url, str) and url else None
        return image_url if isinstance(image_url, str) and image_url else None
    if part_type == "input_image":
        url = part.get("image_url") or part.get("file_url")
        return url if isinstance(url, str) and url else None
    return None


def _text_from_part(part: Any) -> str:
    if isinstance(part, str):
        return part
    if not isinstance(part, dict):
        return ""
    text = part.get("text")
    if isinstance(text, str):
        return text
    return ""


def _content_to_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        texts: list[str] = []
        for part in content:
            text = _text_from_part(part)
            if text:
                texts.append(text)
        return "\n".join(texts)
    if content is None:
        return ""
    return str(content)


def _compact_text(text: str, limit: int) -> str:
    text = " ".join(str(text).split())
    if len(text) <= limit:
        return text
    head = max(0, limit // 3)
    tail = max(0, limit - head)
    return f"{text[:head]} ... {text[-tail:]}"


def _context_compress_header(request: Request) -> str:
    return (
        request.headers.get("x-nassa-context-compress")
        or request.headers.get("x-context-compress")
        or ""
    ).strip().lower()


def _should_force_context_compress(request: Request) -> bool:
    return _context_compress_header(request) in {"1", "true", "yes", "manual", "force", "on"}


def _should_auto_context_compress() -> bool:
    return PROVIDER_CONTEXT_COMPRESSION in {"1", "true", "yes", "auto", "on"}


def _make_history_summary(role_texts: list[tuple[str, str]]) -> str:
    lines: list[str] = []
    for idx, (role, text) in enumerate(role_texts, start=1):
        compact = _compact_text(text, CONTEXT_COMPRESS_MESSAGE_CHARS)
        if compact:
            lines.append(f"{idx}. {role}: {compact}")
    summary = "\n".join(lines)
    if len(summary) > CONTEXT_COMPRESS_HISTORY_CHARS:
        summary = summary[-CONTEXT_COMPRESS_HISTORY_CHARS:]
    return (
        "以下是前文对话的压缩记录。请把它当作已发生的上下文事实使用,但优先遵循后续最新消息。\n"
        f"{summary}"
    )


def _compact_chat_body_for_context(body: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    messages = body.get("messages")
    if not isinstance(messages, list):
        return body, False
    keep_recent = max(2, CONTEXT_COMPRESS_KEEP_RECENT_MESSAGES)
    if len(messages) <= keep_recent + 2:
        return body, False

    leading: list[Any] = []
    rest = list(messages)
    while rest and isinstance(rest[0], dict) and rest[0].get("role") in {"system", "developer"}:
        leading.append(rest.pop(0))

    if len(rest) <= keep_recent + 1:
        return body, False

    old_messages = rest[:-keep_recent]
    recent_messages = rest[-keep_recent:]
    role_texts: list[tuple[str, str]] = []
    for message in old_messages:
        if not isinstance(message, dict):
            continue
        text = _content_to_text(message.get("content"))
        if text:
            role_texts.append((str(message.get("role") or "message"), text))
    if not role_texts:
        return body, False

    patched = json.loads(json.dumps(body))
    summary_message = {"role": "system", "content": _make_history_summary(role_texts)}
    patched["messages"] = [*leading, summary_message, *recent_messages]
    return patched, True


def _compact_responses_body_for_context(body: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    input_value = body.get("input")
    keep_recent = max(2, CONTEXT_COMPRESS_KEEP_RECENT_MESSAGES)
    if isinstance(input_value, str):
        if len(input_value) <= CONTEXT_COMPRESS_HISTORY_CHARS:
            return body, False
        patched = json.loads(json.dumps(body))
        patched["input"] = _make_history_summary([("input", input_value)])
        return patched, True
    if not isinstance(input_value, list) or len(input_value) <= keep_recent + 1:
        return body, False

    old_items = input_value[:-keep_recent]
    recent_items = input_value[-keep_recent:]
    role_texts: list[tuple[str, str]] = []
    for item in old_items:
        if isinstance(item, str):
            role_texts.append(("input", item))
            continue
        if not isinstance(item, dict):
            continue
        text = _content_to_text(item.get("content"))
        if text:
            role_texts.append((str(item.get("role") or "input"), text))
    if not role_texts:
        return body, False

    patched = json.loads(json.dumps(body))
    patched["input"] = [
        {"role": "system", "content": [{"type": "input_text", "text": _make_history_summary(role_texts)}]},
        *recent_items,
    ]
    return patched, True


def _compact_claude_body_for_context(body: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    messages = body.get("messages")
    if not isinstance(messages, list):
        return body, False
    keep_recent = max(2, CONTEXT_COMPRESS_KEEP_RECENT_MESSAGES)
    if len(messages) <= keep_recent + 1:
        return body, False

    old_messages = messages[:-keep_recent]
    recent_messages = messages[-keep_recent:]
    role_texts: list[tuple[str, str]] = []
    for message in old_messages:
        if not isinstance(message, dict):
            continue
        text = _content_to_text(message.get("content"))
        if text:
            role_texts.append((str(message.get("role") or "message"), text))
    if not role_texts:
        return body, False

    patched = json.loads(json.dumps(body))
    system = patched.get("system")
    summary = _make_history_summary(role_texts)
    if isinstance(system, str):
        patched["system"] = f"{system}\n\n{summary}" if system else summary
    elif isinstance(system, list):
        patched["system"] = [{"type": "text", "text": summary}, *system]
    else:
        patched["system"] = summary
    patched["messages"] = recent_messages
    return patched, True


def _compact_body_for_context(body: dict[str, Any], endpoint: str) -> tuple[dict[str, Any], bool]:
    if _is_chat_endpoint(endpoint):
        return _compact_chat_body_for_context(body)
    if _is_responses_endpoint(endpoint):
        return _compact_responses_body_for_context(body)
    if _is_claude_messages_endpoint(endpoint):
        return _compact_claude_body_for_context(body)
    return body, False


def _append_text_content(content: Any, text: str, responses: bool = False) -> Any:
    if isinstance(content, str):
        return f"{content}\n\n{text}" if content else text
    if isinstance(content, list):
        kind = "input_text" if responses else "text"
        return [{"type": kind, "text": text}, *content]
    kind = "input_text" if responses else "text"
    return [{"type": kind, "text": text}]


def _remove_image_parts(content: Any) -> Any:
    if not isinstance(content, list):
        return content
    return [part for part in content if not _extract_image_url(part)]


def _collect_chat_images(body: dict[str, Any]) -> tuple[list[str], str]:
    images: list[str] = []
    texts: list[str] = []
    for message in body.get("messages") or []:
        content = message.get("content") if isinstance(message, dict) else None
        if isinstance(content, list):
            for part in content:
                image = _extract_image_url(part)
                if image:
                    images.append(image)
                text = _text_from_part(part)
                if text:
                    texts.append(text)
        elif isinstance(content, str):
            texts.append(content)
    return images[:MAX_IMAGES], "\n".join(texts)[-4000:]


def _collect_responses_images(body: dict[str, Any]) -> tuple[list[str], str]:
    images: list[str] = []
    texts: list[str] = []
    input_value = body.get("input")
    items = input_value if isinstance(input_value, list) else [{"content": input_value}]
    for item in items:
        if isinstance(item, str):
            texts.append(item)
            continue
        if not isinstance(item, dict):
            continue
        content = item.get("content")
        if isinstance(content, list):
            for part in content:
                image = _extract_image_url(part)
                if image:
                    images.append(image)
                text = _text_from_part(part)
                if text:
                    texts.append(text)
        elif isinstance(content, str):
            texts.append(content)
    instructions = body.get("instructions")
    if isinstance(instructions, str):
        texts.append(instructions)
    return images[:MAX_IMAGES], "\n".join(texts)[-4000:]


async def _image_to_data_url(client: httpx.AsyncClient, image_url: str) -> str:
    if image_url.startswith("data:"):
        return image_url
    if not image_url.startswith(("http://", "https://")):
        raise ValueError("unsupported image URL format")
    resp = await client.get(
        image_url,
        headers={
            "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
            "User-Agent": "Mozilla/5.0 (compatible; NassaVisionBridge/1.0)",
        },
        timeout=30,
        follow_redirects=True,
    )
    resp.raise_for_status()
    data = resp.content
    if len(data) > IMAGE_MAX_BYTES:
        raise ValueError(f"image too large: {len(data)} bytes")
    content_type = resp.headers.get("content-type", "").split(";")[0].lower()
    if content_type not in {"image/jpeg", "image/jpg", "image/png", "image/webp"}:
        content_type = "image/jpeg"
    if content_type == "image/jpg":
        content_type = "image/jpeg"
    return f"data:{content_type};base64,{base64.b64encode(data).decode('ascii')}"


def _request_bearer_token(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        return ""
    return auth.split(" ", 1)[1].strip()


async def _call_vlm(client: httpx.AsyncClient, prompt: str, image_url: str, api_key: str = "") -> str:
    vlm_api_key = api_key or MINIMAX_VLM_API_KEY
    if not vlm_api_key:
        raise RuntimeError("MINIMAX_VLM_API_KEY is not configured")
    data_url = await _image_to_data_url(client, image_url)
    resp = await client.post(
        f"{MINIMAX_API_HOST}/v1/coding_plan/vlm",
        headers={
            "Authorization": f"Bearer {vlm_api_key}",
            "Content-Type": "application/json",
            "MM-API-Source": "NassaVisionBridge",
        },
        json={"prompt": prompt, "image_url": data_url},
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()
    base_resp = data.get("base_resp") or {}
    if base_resp.get("status_code") not in (0, "0", None):
        raise RuntimeError(f"MiniMax VLM {base_resp.get('status_code')}: {base_resp.get('status_msg')}")
    content = data.get("content")
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError("MiniMax VLM returned empty content")
    return content.strip()


async def _bridge_images(body: dict[str, Any], endpoint: str, vlm_api_key: str = "") -> tuple[dict[str, Any], bool]:
    is_chat = _is_chat_endpoint(endpoint)
    is_responses = _is_responses_endpoint(endpoint)
    if not _should_bridge_model(body.get("model")) or not (is_chat or is_responses):
        return body, False
    images, prompt_text = _collect_chat_images(body) if is_chat else _collect_responses_images(body)
    if not images:
        return body, False
    vision_prompt = (
        "请分析图片内容,提取能帮助回答用户问题的视觉信息。"
        "如果图片是代码/日志/截图,请尽量读取其中文字和关键错误。"
        f"\n\n用户问题/上下文:\n{prompt_text or '(无文字上下文)'}"
    )
    async with httpx.AsyncClient() as client:
        descriptions = []
        for idx, image in enumerate(images, start=1):
            desc = await _call_vlm(client, vision_prompt, image, vlm_api_key)
            descriptions.append(f"Image #{idx}: {desc}")
    bridge_text = (
        "[图片理解结果]\n"
        + "\n\n".join(descriptions)
        + "\n\n请基于以上图片理解结果回答用户原始问题。"
    )
    patched = json.loads(json.dumps(body))
    if is_chat:
        for message in patched.get("messages") or []:
            if isinstance(message, dict):
                message["content"] = _remove_image_parts(message.get("content"))
        for message in patched.get("messages") or []:
            if isinstance(message, dict) and message.get("role") == "user":
                message["content"] = _append_text_content(message.get("content"), bridge_text, responses=False)
                break
    else:
        input_value = patched.get("input")
        if isinstance(input_value, list):
            for item in input_value:
                if isinstance(item, dict):
                    item["content"] = _remove_image_parts(item.get("content"))
            for item in input_value:
                if isinstance(item, dict):
                    item["content"] = _append_text_content(item.get("content"), bridge_text, responses=True)
                    break
        elif isinstance(input_value, str):
            patched["input"] = input_value + "\n\n" + bridge_text
    return patched, True


async def _proxy(request: Request, path: str) -> Response:
    upstream_base = MINIMAX_API_HOST if BRIDGE_MODE == "provider" else NEWAPI_UPSTREAM
    upstream_url = f"{upstream_base}/{path}"
    if request.url.query:
        upstream_url += f"?{request.url.query}"
    try:
        raw_body = await request.body()
    except ClientDisconnect:
        return Response(status_code=499)
    body = raw_body
    bridged = False
    context_compressed = False
    endpoint = "/" + path
    origin_model = ""
    request_payload: dict[str, Any] | None = None
    if request.method.upper() == "POST" and _is_context_compress_endpoint(endpoint):
        try:
            parsed = json.loads(raw_body.decode("utf-8")) if raw_body else {}
            if isinstance(parsed, dict):
                origin_model = _origin_model_for_mask(parsed.get("model"))
                vlm_api_key = _request_bearer_token(request) if BRIDGE_MODE == "provider" else ""
                patched, bridged = await _bridge_images(parsed, endpoint, vlm_api_key) if not _is_claude_messages_endpoint(endpoint) else (parsed, False)
                if _should_force_context_compress(request):
                    patched, context_compressed = _compact_body_for_context(patched, endpoint)
                if BRIDGE_MODE == "provider" and not _is_claude_messages_endpoint(endpoint):
                    patched = _map_provider_model(patched)
                request_payload = patched
                if bridged:
                    body = json.dumps(patched, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
                elif BRIDGE_MODE == "provider" and patched is not parsed:
                    body = json.dumps(patched, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
                elif context_compressed:
                    body = json.dumps(patched, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        except Exception as exc:
            return _json_error(502, f"图片理解桥接失败: {exc}", "vision_bridge_failed")

    headers = _forward_headers(request, len(body) if body else 0)
    client = httpx.AsyncClient(timeout=None, follow_redirects=False)
    max_attempts = PROVIDER_UPSTREAM_MAX_ATTEMPTS if BRIDGE_MODE == "provider" else 1
    max_attempts = max(1, max_attempts)
    upstream: httpx.Response | None = None
    for attempt in range(1, max_attempts + 1):
        req = client.build_request(request.method, upstream_url, headers=headers, content=body)
        try:
            upstream = await client.send(req, stream=True)
        except Exception as exc:
            if attempt >= max_attempts:
                await client.aclose()
                return _json_error(502, f"上游服务无法访问: {exc}", "service_unavailable")
            print(f"[provider-retry] upstream exception attempt={attempt}: {exc}", flush=True)
            await asyncio.sleep(PROVIDER_RETRY_BASE_DELAY_SECONDS * attempt)
            continue

        should_retry = (
            BRIDGE_MODE == "provider"
            and request.method.upper() == "POST"
            and endpoint in {"/v1/chat/completions", "/v1/responses"}
            and upstream.status_code in PROVIDER_RETRY_STATUSES
            and attempt < max_attempts
        )
        if not should_retry:
            break
        print(
            f"[provider-retry] upstream status={upstream.status_code} attempt={attempt} endpoint={endpoint}",
            flush=True,
        )
        await upstream.aclose()
        await asyncio.sleep(PROVIDER_RETRY_BASE_DELAY_SECONDS * attempt)

    if upstream is None:
        await client.aclose()
        return _json_error(502, "上游服务无法访问", "service_unavailable")

    if (
        BRIDGE_MODE == "provider"
        and _is_deepseek_model(origin_model)
        and request.method.upper() == "POST"
        and _is_context_compress_endpoint(endpoint)
        and upstream.status_code >= 400
    ):
        first_error_body = await upstream.aread()
        error_text = first_error_body.decode("utf-8", errors="replace")
        error_category = _provider_error_category(error_text, origin_model)
        reused_error_body = first_error_body
        can_auto_retry = (
            error_category == "context"
            and _should_auto_context_compress()
            and not context_compressed
            and request_payload is not None
        )
        if can_auto_retry:
            compacted_payload, context_compressed = _compact_body_for_context(request_payload, endpoint)
            if context_compressed:
                compacted_body = json.dumps(compacted_payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
                retry_headers = _forward_headers(request, len(compacted_body))
                await upstream.aclose()
                retry_req = client.build_request(request.method, upstream_url, headers=retry_headers, content=compacted_body)
                upstream = await client.send(retry_req, stream=True)
                body = compacted_body
                reused_error_body = b""

        if upstream.status_code >= 400:
            error_body = reused_error_body or await upstream.aread()
            masked = _mask_provider_output_text(error_body.decode("utf-8", errors="replace"), origin_model).encode("utf-8")
            resp_headers = _response_headers(upstream.headers)
            if context_compressed:
                resp_headers["x-nassa-context-compress"] = "auto"
            resp_headers["x-nassa-identity-mask"] = "deepseek"
            await upstream.aclose()
            await client.aclose()
            return Response(
                content=masked,
                status_code=upstream.status_code,
                headers=resp_headers,
                media_type=upstream.headers.get("content-type"),
            )

    async def body_iter():
        decoder = codecs.getincrementaldecoder("utf-8")()
        pending_text = ""
        sent_done = False
        is_event_stream = "event-stream" in (upstream.headers.get("content-type") or "").lower()
        try:
            try:
                async for chunk in upstream.aiter_bytes():
                    if BRIDGE_MODE != "provider" or not _is_deepseek_model(origin_model):
                        yield chunk
                        continue
                    try:
                        pending_text += decoder.decode(chunk)
                    except UnicodeDecodeError:
                        if pending_text:
                            yield _mask_provider_output_text(pending_text, origin_model).encode("utf-8")
                            pending_text = ""
                        yield chunk
                        continue

                    if is_event_stream:
                        while "\n\n" in pending_text:
                            frame, pending_text = pending_text.split("\n\n", 1)
                            if "[DONE]" in frame:
                                sent_done = True
                            yield _mask_provider_output_text(frame + "\n\n", origin_model).encode("utf-8")
                        continue

                    if len(pending_text) <= IDENTITY_TAIL_CHARS:
                        continue
                    safe_text = pending_text[:-IDENTITY_TAIL_CHARS]
                    pending_text = pending_text[-IDENTITY_TAIL_CHARS:]
                    yield _mask_provider_output_text(safe_text, origin_model).encode("utf-8")
            except Exception as exc:
                print(f"[provider-stream] upstream stream interrupted: {exc}", flush=True)

            if BRIDGE_MODE == "provider" and _is_deepseek_model(origin_model):
                pending_text += decoder.decode(b"", final=True)
                if is_event_stream:
                    while "\n\n" in pending_text:
                        frame, pending_text = pending_text.split("\n\n", 1)
                        if "[DONE]" in frame:
                            sent_done = True
                        yield _mask_provider_output_text(frame + "\n\n", origin_model).encode("utf-8")
                    if pending_text.strip():
                        print(
                            f"[provider-stream] dropped incomplete SSE tail bytes={len(pending_text.encode('utf-8', errors='ignore'))}",
                            flush=True,
                        )
                    if not sent_done:
                        yield b"data: [DONE]\n\n"
                elif pending_text:
                    yield _mask_provider_output_text(pending_text, origin_model).encode("utf-8")
        finally:
            await upstream.aclose()
            await client.aclose()

    resp_headers = _response_headers(upstream.headers)
    if bridged:
        resp_headers["x-nassa-vision-bridge"] = "minimax-vlm"
    if context_compressed:
        resp_headers["x-nassa-context-compress"] = "auto"
    if BRIDGE_MODE == "provider" and _is_deepseek_model(origin_model):
        resp_headers["x-nassa-identity-mask"] = "deepseek"
    return StreamingResponse(
        body_iter(),
        status_code=upstream.status_code,
        headers=resp_headers,
        media_type=upstream.headers.get("content-type"),
    )


@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
async def catch_all(request: Request, path: str) -> Response:
    return await _proxy(request, path)
