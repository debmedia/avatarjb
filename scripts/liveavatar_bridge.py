#!/usr/bin/env python3
"""Local session bridge for Gemini -> HeyGen LiveAvatar LITE.

The browser keeps the Gemini realtime session. This bridge owns the LiveAvatar
API key, creates a LITE session, returns LiveKit credentials plus the provider
``ws_url``, and then the browser sends audio directly to LiveAvatar.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import urllib.parse
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import websockets
from websockets.exceptions import ConnectionClosed

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ENV_FILE = ROOT / ".env"
LEGACY_ENV_FILE = ROOT / ".env.liveavatar"
DEFAULT_SANDBOX_AVATAR_ID = "65f9e3c9-d48b-4118-b73a-4ae2e3cbb8f0"
GEMINI_AUTH_TOKEN_URL = "https://generativelanguage.googleapis.com/v1alpha/auth_tokens"
GEMINI_CONSTRAINED_WS = (
    "wss://generativelanguage.googleapis.com/ws/"
    "google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained"
)


@dataclass
class LiveAvatarSession:
    session_id: str = ""
    session_token: str = ""
    avatar_id: str = ""
    livekit_url: str = ""
    livekit_client_token: str = ""
    ws_url: str = ""


@dataclass
class BridgeState:
    started_at: float
    turns: int = 0
    avatar_id: str = ""
    avatar_scope: str = "public"
    session: LiveAvatarSession | None = None


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and value and not os.environ.get(key):
            os.environ[key] = value


def load_env_files(primary_path: Path) -> None:
    load_env_file(primary_path)
    if primary_path != LEGACY_ENV_FILE and not primary_path.exists():
        load_env_file(LEGACY_ENV_FILE)


def truthy_env(name: str, default: bool = False) -> bool:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default
    return raw_value.strip().lower() not in {"0", "false", "no", "off"}


def env_summary() -> dict[str, bool]:
    return {
        "GEMINI_API_KEY": bool(os.getenv("GEMINI_API_KEY")),
        "HEYGEN_API_KEY": bool(os.getenv("HEYGEN_API_KEY")),
        "LIVEAVATAR_API_KEY": bool(os.getenv("LIVEAVATAR_API_KEY")),
        "LIVEAVATAR_AVATAR_ID": bool(os.getenv("LIVEAVATAR_AVATAR_ID")),
        "LIVEAVATAR_IS_SANDBOX": bool(os.getenv("LIVEAVATAR_IS_SANDBOX")),
        "LIVEAVATAR_SESSION_PAYLOAD_JSON": bool(os.getenv("LIVEAVATAR_SESSION_PAYLOAD_JSON")),
    }


def liveavatar_api_base() -> str:
    return os.getenv("LIVEAVATAR_API_BASE", "https://api.liveavatar.com").rstrip("/")


def liveavatar_api_key() -> str:
    return (os.getenv("LIVEAVATAR_API_KEY") or os.getenv("HEYGEN_API_KEY") or "").strip()


def liveavatar_headers() -> dict[str, str]:
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "avatarjb-liveavatar-bridge/0.2",
    }
    api_key = liveavatar_api_key()
    if api_key:
        headers["X-API-KEY"] = api_key
    return headers


def http_json(method: str, path: str, headers: dict[str, str], payload: dict[str, Any] | None = None) -> dict[str, Any]:
    url = f"{liveavatar_api_base()}{path}"
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, method=method, headers=headers, data=data)
    try:
        with urllib.request.urlopen(request, timeout=35) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"LiveAvatar HTTP {error.code}: {detail[:500]}") from error
    try:
        return json.loads(raw)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"LiveAvatar devolvio JSON invalido: {raw[:200]}") from error


def create_gemini_ephemeral_token_sync() -> str:
    api_key = (os.getenv("GEMINI_API_KEY") or "").strip()
    if not api_key:
        raise RuntimeError("Falta GEMINI_API_KEY en .env")

    url = f"{GEMINI_AUTH_TOKEN_URL}?key={urllib.parse.quote(api_key, safe='')}"
    data = json.dumps({"uses": 1}).encode("utf-8")
    request = urllib.request.Request(
        url,
        method="POST",
        headers={"Content-Type": "application/json", "User-Agent": "avatarjb-liveavatar-bridge/0.2"},
        data=data,
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Gemini token HTTP {error.code}: {detail[:500]}") from error

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"Gemini token devolvio JSON invalido: {raw[:200]}") from error

    token = str(payload.get("name") or "").strip()
    if not token:
        raise RuntimeError("Gemini no devolvio token efimero")
    return token


def gemini_ephemeral_endpoint(token: str) -> str:
    return f"{GEMINI_CONSTRAINED_WS}?access_token={urllib.parse.quote(token, safe='')}"


def normalize_avatar(raw: dict[str, Any]) -> dict[str, Any]:
    avatar_id = raw.get("id") or raw.get("avatar_id") or raw.get("avatarId")
    name = (
        raw.get("name")
        or raw.get("display_name")
        or raw.get("displayName")
        or raw.get("avatar_name")
        or raw.get("title")
        or avatar_id
    )
    thumbnail = (
        raw.get("thumbnail_url")
        or raw.get("thumbnailUrl")
        or raw.get("preview_url")
        or raw.get("previewUrl")
        or raw.get("image_url")
        or raw.get("imageUrl")
    )
    return {
        "id": str(avatar_id or ""),
        "name": str(name or ""),
        "thumbnail_url": str(thumbnail or ""),
        "raw": raw,
    }


def avatars_from_response(payload: Any) -> list[dict[str, Any]]:
    data = payload.get("data") if isinstance(payload, dict) else payload
    if isinstance(data, dict):
        for key in ("avatars", "items", "results", "data"):
            if isinstance(data.get(key), list):
                data = data[key]
                break
    if not isinstance(data, list):
        return []
    return [normalize_avatar(item) for item in data if isinstance(item, dict)]


async def fetch_liveavatar_avatars(scope: str) -> list[dict[str, Any]]:
    if not liveavatar_api_key():
        raise RuntimeError("Falta LIVEAVATAR_API_KEY o HEYGEN_API_KEY en .env")
    path = "/v1/avatars/public" if scope == "public" else "/v1/avatars"
    return await asyncio.to_thread(lambda: avatars_from_response(http_json("GET", path, liveavatar_headers())))


def session_payload(avatar_id: str) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "mode": "LITE",
        "avatar_id": avatar_id,
        "is_sandbox": truthy_env("LIVEAVATAR_IS_SANDBOX", True),
        "video_settings": {
            "quality": os.getenv("LIVEAVATAR_VIDEO_QUALITY", "medium"),
            "encoding": os.getenv("LIVEAVATAR_VIDEO_ENCODING", "VP8"),
        },
    }
    override = os.getenv("LIVEAVATAR_SESSION_PAYLOAD_JSON", "").strip()
    if override:
        payload.update(json.loads(override))
        payload["avatar_id"] = avatar_id
    return payload


def session_data(payload: dict[str, Any]) -> dict[str, Any]:
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, dict):
        raise RuntimeError(f"LiveAvatar respuesta inesperada: {str(payload)[:240]}")
    return data


def create_session_token_sync(avatar_id: str) -> tuple[str, str]:
    payload = session_payload(avatar_id)
    token_payload = http_json("POST", "/v1/sessions/token", liveavatar_headers(), payload)
    data = session_data(token_payload)
    session_id = str(data.get("session_id") or data.get("id") or "").strip()
    session_token = str(data.get("session_token") or data.get("token") or "").strip()
    if not session_id or not session_token:
        raise RuntimeError("LiveAvatar no devolvio session_id/session_token")
    return session_id, session_token


def start_session_sync(session_id: str, session_token: str) -> dict[str, Any]:
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Authorization": f"Bearer {session_token}",
        "User-Agent": "avatarjb-liveavatar-bridge/0.2",
    }
    payload = http_json("POST", "/v1/sessions/start", headers, {"session_id": session_id})
    data = session_data(payload)
    return {
        "session_id": str(data.get("session_id") or session_id),
        "livekit_url": str(data.get("livekit_url") or ""),
        "livekit_client_token": str(data.get("livekit_client_token") or ""),
        "livekit_agent_token": str(data.get("livekit_agent_token") or ""),
        "max_session_duration": data.get("max_session_duration"),
        "ws_url": str(data.get("ws_url") or ""),
    }


def stop_session_sync(session: LiveAvatarSession) -> None:
    if not session.session_id or not session.session_token:
        return
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Authorization": f"Bearer {session.session_token}",
        "User-Agent": "avatarjb-liveavatar-bridge/0.2",
    }
    try:
        http_json("POST", "/v1/sessions/stop", headers, {
            "session_id": session.session_id,
            "reason": "USER_DISCONNECTED",
        })
    except Exception as error:
        print(f"LiveAvatar stop warning: {error}")


async def send_json(socket: websockets.WebSocketServerProtocol, payload: dict[str, Any]) -> None:
    try:
        await socket.send(json.dumps(payload, separators=(",", ":")))
    except ConnectionClosed:
        pass


async def stop_liveavatar_session(state: BridgeState) -> None:
    session = state.session
    state.session = None
    if not session:
        return
    await asyncio.to_thread(stop_session_sync, session)


async def create_liveavatar_session(
    browser: websockets.WebSocketServerProtocol,
    state: BridgeState,
    avatar_id: str,
) -> LiveAvatarSession:
    if not liveavatar_api_key():
        raise RuntimeError("Falta LIVEAVATAR_API_KEY o HEYGEN_API_KEY en .env")

    requested_avatar_id = (avatar_id or os.getenv("LIVEAVATAR_AVATAR_ID") or sandbox_avatar_id()).strip()
    selected_avatar_id = requested_avatar_id
    fallback_used = False

    async def create_token(candidate: str) -> tuple[str, str]:
        return await asyncio.to_thread(create_session_token_sync, candidate)

    try:
        session_id, session_token = await create_token(selected_avatar_id)
    except Exception as error:
        sandbox_id = sandbox_avatar_id()
        error_text = str(error).lower()
        should_retry_sandbox = (
            truthy_env("LIVEAVATAR_IS_SANDBOX", True)
            and selected_avatar_id != sandbox_id
            and ("not supported in sandbox" in error_text or "avatar_id" in error_text)
        )
        if should_retry_sandbox:
            await send_json(browser, {
                "type": "status",
                "message": f"Avatar no disponible en sandbox; usando sandbox demo {sandbox_id}",
            })
            selected_avatar_id = sandbox_id
            fallback_used = True
            session_id, session_token = await create_token(selected_avatar_id)
        else:
            raise error

    start_data = await asyncio.to_thread(start_session_sync, session_id, session_token)
    session = LiveAvatarSession(
        session_id=start_data["session_id"],
        session_token=session_token,
        avatar_id=selected_avatar_id,
        livekit_url=start_data["livekit_url"],
        livekit_client_token=start_data["livekit_client_token"],
        ws_url=start_data["ws_url"],
    )
    if not session.livekit_url or not session.livekit_client_token:
        raise RuntimeError("LiveAvatar no devolvio livekit_url/livekit_client_token")

    await send_json(browser, {
        "type": "session",
        "avatarId": session.avatar_id,
        "requestedAvatarId": requested_avatar_id,
        "fallback": fallback_used,
        "sessionId": session.session_id,
        "url": session.livekit_url,
        "access_token": session.livekit_client_token,
        "ws_url": session.ws_url,
        "wsUrl": session.ws_url,
        "audioPath": "browser_direct",
        "wsReady": False,
        "message": "LiveAvatar session creada; audio directo desde navegador",
    })
    return session


def sandbox_avatar_id() -> str:
    return os.getenv("LIVEAVATAR_SANDBOX_AVATAR_ID", DEFAULT_SANDBOX_AVATAR_ID).strip()


async def handle_client(socket: websockets.WebSocketServerProtocol) -> None:
    state = BridgeState(started_at=asyncio.get_running_loop().time())
    await send_json(socket, {
        "type": "ready",
        "message": "bridge LiveAvatar conectado",
        "env": env_summary(),
        "config": {
            "geminiApiKey": os.getenv("GEMINI_API_KEY", ""),
            "liveAvatarId": os.getenv("LIVEAVATAR_AVATAR_ID", ""),
            "sandbox": truthy_env("LIVEAVATAR_IS_SANDBOX", True),
            "sandboxAvatarId": sandbox_avatar_id(),
            "autoStart": truthy_env("LIVEAVATAR_AUTO_START", False),
        },
    })

    try:
        async for raw_message in socket:
            try:
                message = json.loads(raw_message)
            except json.JSONDecodeError:
                await send_json(socket, {"type": "error", "message": "mensaje JSON invalido"})
                continue

            message_type = message.get("type")

            if message_type == "hello":
                state.avatar_id = str(message.get("avatarId") or os.getenv("LIVEAVATAR_AVATAR_ID") or "").strip()
                state.avatar_scope = str(message.get("avatarScope") or "public")
                await send_json(socket, {"type": "status", "message": "modo LiveAvatar LITE listo"})
                continue

            if message_type == "list_avatars":
                scope = str(message.get("scope") or "public")
                if scope not in {"user", "public"}:
                    scope = "public"
                try:
                    avatars = await fetch_liveavatar_avatars(scope)
                except Exception as error:
                    await send_json(socket, {"type": "error", "message": str(error), "scope": scope})
                    continue
                await send_json(socket, {"type": "avatars", "scope": scope, "avatars": avatars})
                continue

            if message_type == "select_avatar":
                state.avatar_id = str(message.get("avatarId") or "").strip()
                state.avatar_scope = str(message.get("scope") or state.avatar_scope or "public")
                await send_json(socket, {"type": "status", "message": f"avatar seleccionado {state.avatar_id or 'sin id'}"})
                continue

            if message_type == "gemini_token":
                try:
                    token = await asyncio.to_thread(create_gemini_ephemeral_token_sync)
                except Exception as error:
                    await send_json(socket, {"type": "error", "message": str(error), "source": "gemini_token"})
                    continue
                await send_json(socket, {
                    "type": "gemini_token",
                    "auth": "ephemeral",
                    "endpoint": gemini_ephemeral_endpoint(token),
                    "message": "Gemini token efimero listo",
                })
                continue

            if message_type == "start_session":
                state.avatar_id = str(message.get("avatarId") or state.avatar_id or "").strip()
                state.avatar_scope = str(message.get("scope") or state.avatar_scope or "public")
                try:
                    await stop_liveavatar_session(state)
                    state.session = await create_liveavatar_session(socket, state, state.avatar_id)
                except Exception as error:
                    await send_json(socket, {"type": "error", "message": str(error)})
                continue

            if message_type == "stop_session":
                await stop_liveavatar_session(state)
                await send_json(socket, {"type": "status", "message": "LiveAvatar detenido"})
                continue

            if message_type == "interrupt":
                await send_json(socket, {"type": "status", "message": "interrupt ignorado: audio directo desde navegador"})
                continue

            if message_type == "audio":
                await send_json(socket, {"type": "status", "message": "audio ignorado: el navegador envia directo a LiveAvatar"})
                continue

            if message_type == "speak_end":
                state.turns += 1
                await send_json(socket, {"type": "status", "message": f"turno {state.turns} cerrado en modo directo"})
                continue

            await send_json(socket, {"type": "status", "message": f"evento ignorado: {message_type}"})
    finally:
        await stop_liveavatar_session(state)


async def main() -> None:
    parser = argparse.ArgumentParser(description="Gemini audio to LiveAvatar LITE bridge")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8788)
    parser.add_argument("--env-file", default=str(DEFAULT_ENV_FILE))
    args = parser.parse_args()
    load_env_files(Path(args.env_file))

    async with websockets.serve(handle_client, args.host, args.port):
        print(f"LiveAvatar bridge listening on ws://{args.host}:{args.port}/liveavatar")
        print(f"LiveAvatar env loaded: {env_summary()}")
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
