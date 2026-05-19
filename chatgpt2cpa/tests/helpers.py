import base64
import json
from typing import Any


def b64url_json(value: dict[str, Any]) -> str:
    raw = json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def make_unsigned_jwt(payload: dict[str, Any]) -> str:
    header = {"alg": "none", "typ": "JWT"}
    return f"{b64url_json(header)}.{b64url_json(payload)}."


def sample_session_payload(include_id_token: bool) -> dict[str, Any]:
    access_payload = {
        "exp": 1893456000,
        "https://api.openai.com/auth": {
            "chatgpt_account_id": "acc_1234567890",
            "chatgpt_plan_type": "plus",
            "chatgpt_user_id": "user_123",
        },
        "https://api.openai.com/profile": {
            "email": "demo@example.com",
        },
    }
    payload: dict[str, Any] = {
        "access_token": make_unsigned_jwt(access_payload),
        "refresh_token": "refresh-demo",
        "session_token": "session-demo",
        "user": {"email": "demo@example.com", "id": "user_123"},
        "account": {"id": "acc_1234567890", "planType": "plus"},
        "expires": "2030-01-01T00:00:00Z",
    }
    if include_id_token:
        payload["id_token"] = make_unsigned_jwt(
            {
                "email": "demo@example.com",
                "https://api.openai.com/auth": {
                    "chatgpt_account_id": "acc_1234567890",
                    "chatgpt_plan_type": "plus",
                },
            }
        )
    return payload
