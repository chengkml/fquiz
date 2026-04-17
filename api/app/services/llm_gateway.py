from __future__ import annotations

import json
import time
from dataclasses import dataclass

import httpx
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.config import get_settings
from ..models.model_registry import ModelApiKey, ModelRegistry, ModelRouteRule

settings = get_settings()
CHAT_CAPABILITY_ROUTE_KEY = "chat.default"
GLOBAL_ROUTE_KEY = "__global__"
DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1"


@dataclass
class LlmCompletionResult:
    content: str
    model_code: str
    provider: str
    provider_model: str
    prompt_tokens: int | None
    completion_tokens: int | None
    total_tokens: int | None
    latency_ms: int


def create_assistant_reply(
    db: Session,
    *,
    user_message: str,
    context_messages: list[tuple[str, str]],
    system_prompt: str,
) -> LlmCompletionResult:
    model = _resolve_chat_model(db)
    provider_key = _resolve_provider_key(model.provider)
    endpoint = _build_endpoint(model.base_url)
    payload = {
        "model": model.provider_model,
        "messages": _build_messages(
            system_prompt=system_prompt,
            context_messages=context_messages,
            user_message=user_message,
        ),
    }

    started = time.perf_counter()
    try:
        with httpx.Client(timeout=settings.llm_request_timeout_seconds) as client:
            response = client.post(
                endpoint,
                headers={
                    "Authorization": f"Bearer {provider_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail="LLM request timeout") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"LLM request failed: {exc.__class__.__name__}") from exc

    latency_ms = int((time.perf_counter() - started) * 1000)
    if response.status_code >= 400:
        detail = _extract_http_error_detail(response)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"LLM response error: {detail}")

    body = response.json()
    content = _extract_content(body)
    if not content:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="LLM returned empty content")

    usage = body.get("usage") if isinstance(body, dict) else None
    prompt_tokens = _to_int(usage.get("prompt_tokens")) if isinstance(usage, dict) else None
    completion_tokens = _to_int(usage.get("completion_tokens")) if isinstance(usage, dict) else None
    total_tokens = _to_int(usage.get("total_tokens")) if isinstance(usage, dict) else None

    return LlmCompletionResult(
        content=content,
        model_code=model.code,
        provider=model.provider,
        provider_model=model.provider_model,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total_tokens,
        latency_ms=latency_ms,
    )


def _resolve_chat_model(db: Session) -> ModelRegistry:
    capability_model = _resolve_model_from_route(db, route_type="CAPABILITY", route_key=CHAT_CAPABILITY_ROUTE_KEY)
    if capability_model:
        return capability_model

    global_model = _resolve_model_from_route(db, route_type="GLOBAL", route_key=GLOBAL_ROUTE_KEY)
    if global_model:
        return global_model

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="No enabled model route for chat (CAPABILITY:chat.default or GLOBAL)",
    )


def _resolve_model_from_route(
    db: Session,
    *,
    route_type: str,
    route_key: str,
) -> ModelRegistry | None:
    rows = db.execute(
        select(ModelRouteRule, ModelRegistry)
        .join(ModelRegistry, ModelRouteRule.target_model_code == ModelRegistry.code)
        .where(
            ModelRouteRule.route_type == route_type,
            ModelRouteRule.route_key == route_key,
            ModelRouteRule.enabled.is_(True),
            ModelRegistry.status == "ENABLED",
        )
        .order_by(ModelRouteRule.priority.asc(), ModelRouteRule.id.asc())
    ).all()
    if not rows:
        return None

    for _, model in rows:
        active_key_exists = db.scalar(
            select(ModelApiKey.id).where(
                ModelApiKey.model_id == model.id,
                ModelApiKey.is_active.is_(True),
            )
        )
        if active_key_exists is not None:
            return model
    return None


def _resolve_provider_key(provider: str) -> str:
    key = settings.llm_provider_key_map.get(provider.strip().lower())
    if key:
        return key
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=f"Missing provider key for {provider}. Configure LLM_PROVIDER_API_KEYS.",
    )


def _build_messages(
    *,
    system_prompt: str,
    context_messages: list[tuple[str, str]],
    user_message: str,
) -> list[dict[str, str]]:
    messages: list[dict[str, str]] = []
    normalized_system_prompt = system_prompt.strip()
    if normalized_system_prompt:
        messages.append({"role": "system", "content": normalized_system_prompt})

    for role, content in context_messages:
        if role not in {"user", "assistant"}:
            continue
        normalized_content = content.strip()
        if not normalized_content:
            continue
        messages.append({"role": role, "content": normalized_content})

    messages.append({"role": "user", "content": user_message.strip()})
    return messages


def _build_endpoint(base_url: str | None) -> str:
    normalized = (base_url or "").strip().rstrip("/")
    if not normalized:
        return f"{DEFAULT_OPENAI_BASE_URL}/chat/completions"
    if normalized.endswith("/chat/completions"):
        return normalized
    return f"{normalized}/chat/completions"


def _extract_content(body: object) -> str:
    if not isinstance(body, dict):
        return ""

    choices = body.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    first = choices[0]
    if not isinstance(first, dict):
        return ""
    message = first.get("message")
    if not isinstance(message, dict):
        return ""

    content = message.get("content")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        texts: list[str] = []
        for item in content:
            if isinstance(item, dict):
                text = item.get("text")
                if isinstance(text, str) and text.strip():
                    texts.append(text.strip())
        return "\n".join(texts).strip()
    return ""


def _extract_http_error_detail(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except json.JSONDecodeError:
        return f"HTTP {response.status_code}"
    if isinstance(payload, dict):
        detail = payload.get("error")
        if isinstance(detail, dict):
            message = detail.get("message")
            if isinstance(message, str) and message.strip():
                return message.strip()
        message = payload.get("message")
        if isinstance(message, str) and message.strip():
            return message.strip()
        detail_field = payload.get("detail")
        if isinstance(detail_field, str) and detail_field.strip():
            return detail_field.strip()
    return f"HTTP {response.status_code}"


def _to_int(value: object) -> int | None:
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return None
