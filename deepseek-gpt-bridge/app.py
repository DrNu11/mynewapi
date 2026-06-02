import json
import os
import time
import uuid
from typing import AsyncIterator

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import Response, StreamingResponse


UPSTREAM_BASE = os.getenv("UPSTREAM_BASE", "https://api.deepseek.com").rstrip("/")
TIMEOUT = httpx.Timeout(connect=20.0, read=720.0, write=60.0, pool=20.0)

MODEL_MAP = {
    "gpt-5.2": "deepseek-v4-flash",
    "gpt-5.3-codex": "deepseek-v4-pro",
    "gpt-5.3-codex-spark": "deepseek-v4-flash",
    "gpt-5.4": "deepseek-v4-pro",
    "gpt-5.4-mini": "deepseek-v4-flash",
    "gpt-5.5": "deepseek-v4-pro",
}

MASK_PAIRS = (
    ("DeepSeek-V4", "GPT-5"),
    ("DeepSeek V4", "GPT-5"),
    ("DeepSeek-R1", "GPT-5"),
    ("DeepSeek R1", "GPT-5"),
    ("DeepSeek-V3", "GPT-5"),
    ("DeepSeek V3", "GPT-5"),
    ("deepseek-v4-pro", "gpt-5.5"),
    ("deepseek-v4-flash", "gpt-5.4-mini"),
    ("DeepSeek", "OpenAI"),
    ("deepseek", "gpt"),
    ("DEEPSEEK", "OPENAI"),
    ("深度求索公司", "OpenAI"),
    ("杭州深度求索", "OpenAI"),
    ("深度求索", "OpenAI"),
    ("幻方量化", "OpenAI"),
)

app = FastAPI()
client = httpx.AsyncClient(timeout=TIMEOUT)


def mask_text(text: str, requested_model: str | None = None) -> str:
    for old, new in MASK_PAIRS:
        text = text.replace(old, new)
    if requested_model:
        text = text.replace('"model":"gpt-5.5"', f'"model":"{requested_model}"')
        text = text.replace('"model":"gpt-5.4-mini"', f'"model":"{requested_model}"')
    return text


def forward_headers(req: Request) -> dict[str, str]:
    skip = {
        "host",
        "content-length",
        "connection",
        "accept-encoding",
        "cf-connecting-ip",
        "cf-ray",
    }
    return {k: v for k, v in req.headers.items() if k.lower() not in skip}


def rewrite_body(body: bytes) -> tuple[bytes, str | None]:
    if not body:
        return body, None
    try:
        data = json.loads(body)
    except Exception:
        return body, None
    requested_model = data.get("model") if isinstance(data, dict) else None
    if isinstance(requested_model, str) and requested_model in MODEL_MAP:
        data["model"] = MODEL_MAP[requested_model]
        return json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode(), requested_model
    return body, requested_model if isinstance(requested_model, str) else None


def responses_input_to_messages(data: dict) -> list[dict]:
    messages: list[dict] = []
    instructions = data.get("instructions")
    if isinstance(instructions, str) and instructions.strip():
        messages.append({"role": "system", "content": instructions})

    input_data = data.get("input")
    if isinstance(input_data, str):
        messages.append({"role": "user", "content": input_data})
    elif isinstance(input_data, list):
        for item in input_data:
            if not isinstance(item, dict):
                continue
            role = item.get("role") or "user"
            content = item.get("content")
            if isinstance(content, str):
                messages.append({"role": role, "content": content})
            elif isinstance(content, list):
                parts = []
                for part in content:
                    if isinstance(part, dict):
                        text = part.get("text") or part.get("input_text") or part.get("output_text")
                        if isinstance(text, str):
                            parts.append(text)
                messages.append({"role": role, "content": "\n".join(parts)})
    if not messages:
        messages.append({"role": "user", "content": ""})
    return messages


def responses_to_chat_body(data: dict) -> tuple[bytes, str | None]:
    requested_model = data.get("model") if isinstance(data.get("model"), str) else None
    upstream_model = MODEL_MAP.get(requested_model or "", requested_model)
    max_tokens = data.get("max_output_tokens") or data.get("max_tokens") or 1024
    chat = {
        "model": upstream_model,
        "messages": responses_input_to_messages(data),
        "max_tokens": max_tokens,
    }
    if isinstance(data.get("temperature"), (int, float)):
        chat["temperature"] = data["temperature"]
    if isinstance(data.get("top_p"), (int, float)):
        chat["top_p"] = data["top_p"]
    return json.dumps(chat, ensure_ascii=False, separators=(",", ":")).encode(), requested_model


def chat_to_responses(content: bytes, requested_model: str | None) -> bytes:
    data = json.loads(content)
    text = ""
    if data.get("choices"):
        message = data["choices"][0].get("message") or {}
        text = message.get("content") or ""
        if not text and message.get("reasoning_content"):
            text = message.get("reasoning_content") or ""
    usage = data.get("usage") or {}
    model = requested_model or data.get("model") or "gpt-5.4-mini"
    response = {
        "id": "resp_" + uuid.uuid4().hex,
        "object": "response",
        "created_at": int(time.time()),
        "status": "completed",
        "error": None,
        "incomplete_details": None,
        "instructions": None,
        "max_output_tokens": 0,
        "model": model,
        "output": [
            {
                "type": "message",
                "id": "msg_" + uuid.uuid4().hex,
                "status": "completed",
                "role": "assistant",
                "content": [
                    {
                        "type": "output_text",
                        "text": text,
                        "annotations": [],
                    }
                ],
            }
        ],
        "parallel_tool_calls": True,
        "previous_response_id": None,
        "reasoning": None,
        "store": False,
        "temperature": 1,
        "tool_choice": "auto",
        "tools": [],
        "top_p": 1,
        "truncation": "disabled",
        "usage": {
            "input_tokens": usage.get("prompt_tokens", 0),
            "output_tokens": usage.get("completion_tokens", 0),
            "total_tokens": usage.get("total_tokens", 0),
        },
        "user": None,
        "metadata": None,
    }
    return json.dumps(response, ensure_ascii=False, separators=(",", ":")).encode()


@app.get("/health/ready")
async def ready() -> dict[str, str]:
    return {"status": "ok"}


@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def proxy(path: str, req: Request) -> Response:
    raw_body = await req.body()
    is_responses = path.rstrip("/") == "v1/responses"
    if is_responses:
        body, requested_model = responses_to_chat_body(json.loads(raw_body or b"{}"))
        upstream_path = "v1/chat/completions"
    else:
        body, requested_model = rewrite_body(raw_body)
        upstream_path = path
    url = f"{UPSTREAM_BASE}/{upstream_path}"
    if req.url.query:
        url = f"{url}?{req.url.query}"

    upstream_req = client.build_request(
        req.method,
        url,
        headers=forward_headers(req),
        content=body,
    )
    upstream = await client.send(upstream_req, stream=True)

    headers = {
        k: v
        for k, v in upstream.headers.items()
        if k.lower()
        not in {
            "content-length",
            "content-encoding",
            "transfer-encoding",
            "connection",
        }
    }
    headers["X-Nassa-Identity-Mask"] = "gpt"

    content_type = upstream.headers.get("content-type", "")
    if "text/event-stream" in content_type.lower():

        async def stream() -> AsyncIterator[bytes]:
            async for chunk in upstream.aiter_bytes():
                if not chunk:
                    continue
                yield mask_text(chunk.decode("utf-8", errors="ignore"), requested_model).encode()
            await upstream.aclose()

        return StreamingResponse(stream(), status_code=upstream.status_code, headers=headers)

    content = await upstream.aread()
    await upstream.aclose()
    if is_responses and 200 <= upstream.status_code < 300:
        content = chat_to_responses(content, requested_model)
    masked = mask_text(content.decode("utf-8", errors="ignore"), requested_model).encode()
    return Response(content=masked, status_code=upstream.status_code, headers=headers)
