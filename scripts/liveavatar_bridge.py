#!/usr/bin/env python3
"""Local bridge contract for Gemini audio -> LiveAvatar LITE/CUSTOM.

This first bridge keeps browser/provider secrets separated. The frontend sends
Gemini PCM chunks here; the provider-specific LiveAvatar session wiring belongs
in this process once API key, avatar id and WebRTC configuration are available.

Browser -> bridge:
  {"type":"hello","mode":"liveavatar_lite","audio":{"mimeType":"audio/pcm;rate=24000"}}
  {"type":"audio","mimeType":"audio/pcm;rate=24000","data":"<base64 pcm16 mono>"}
  {"type":"speak_end"}

Bridge -> browser:
  {"type":"ready","message":"..."}
  {"type":"status","message":"..."}
  {"type":"livekit","url":"...","access_token":"..."}
  {"type":"error","message":"..."}
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import websockets

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ENV_FILE = ROOT / ".env"
LEGACY_ENV_FILE = ROOT / ".env.liveavatar"


@dataclass
class BridgeState:
    started_at: float
    audio_chunks: int = 0
    audio_bytes: int = 0
    turns: int = 0
    avatar_id: str = ""
    avatar_scope: str = "user"


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


def liveavatar_headers() -> dict[str, str]:
    api_key = (os.getenv("LIVEAVATAR_API_KEY") or os.getenv("HEYGEN_API_KEY") or "").strip()
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "avatarjb-liveavatar-bridge/0.1",
    }
    if api_key:
        headers["X-API-KEY"] = api_key
    return headers


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
    if not (os.getenv("LIVEAVATAR_API_KEY") or os.getenv("HEYGEN_API_KEY")):
        raise RuntimeError("Falta LIVEAVATAR_API_KEY o HEYGEN_API_KEY en .env")
    path = "/v1/avatars/public" if scope == "public" else "/v1/avatars"
    url = f"{liveavatar_api_base()}{path}"

    def request() -> list[dict[str, Any]]:
        req = urllib.request.Request(url, headers=liveavatar_headers(), method="GET")
        try:
            with urllib.request.urlopen(req, timeout=20) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"LiveAvatar HTTP {error.code}: {detail[:300]}") from error
        return avatars_from_response(payload)

    return await asyncio.to_thread(request)


async def send_json(socket: websockets.WebSocketServerProtocol, payload: dict[str, Any]) -> None:
    await socket.send(json.dumps(payload, separators=(",", ":")))


async def handle_client(socket: websockets.WebSocketServerProtocol) -> None:
    state = BridgeState(started_at=time.time())
    await send_json(socket, {
        "type": "ready",
        "message": "bridge local conectado; falta configurar LiveAvatar provider",
        "env": env_summary(),
        "config": {
            "geminiApiKey": os.getenv("GEMINI_API_KEY", ""),
            "liveAvatarId": os.getenv("LIVEAVATAR_AVATAR_ID", ""),
        },
    })

    async for raw_message in socket:
        try:
            message = json.loads(raw_message)
        except json.JSONDecodeError:
            await send_json(socket, {"type": "error", "message": "mensaje JSON invalido"})
            continue

        message_type = message.get("type")
        if message_type == "hello":
            state.avatar_id = str(message.get("avatarId") or os.getenv("LIVEAVATAR_AVATAR_ID") or "").strip()
            state.avatar_scope = str(message.get("avatarScope") or "user")
            await send_json(socket, {"type": "status", "message": "modo LiveAvatar LITE inicializado"})
            continue

        if message_type == "list_avatars":
            scope = str(message.get("scope") or "user")
            if scope not in {"user", "public"}:
                scope = "user"
            try:
                avatars = await fetch_liveavatar_avatars(scope)
            except Exception as error:
                await send_json(socket, {"type": "error", "message": str(error)})
                continue
            await send_json(socket, {"type": "avatars", "scope": scope, "avatars": avatars})
            continue

        if message_type == "select_avatar":
            state.avatar_id = str(message.get("avatarId") or "").strip()
            state.avatar_scope = str(message.get("scope") or state.avatar_scope or "user")
            await send_json(socket, {
                "type": "status",
                "message": f"avatar seleccionado {state.avatar_id or 'sin id'}",
            })
            continue

        if message_type == "audio":
            audio = base64.b64decode(message.get("data") or "")
            state.audio_chunks += 1
            state.audio_bytes += len(audio)
            if state.audio_chunks % 20 == 0:
                await send_json(socket, {
                    "type": "status",
                    "message": f"audio recibido {state.audio_chunks} chunks / {state.audio_bytes} bytes",
                })
            continue

        if message_type == "speak_end":
            state.turns += 1
            await send_json(socket, {
                "type": "status",
                "message": f"turno {state.turns} cerrado; proveedor LiveAvatar pendiente",
            })
            continue

        await send_json(socket, {"type": "status", "message": f"evento ignorado: {message_type}"})


async def main() -> None:
    parser = argparse.ArgumentParser(description="Gemini audio to LiveAvatar LITE bridge skeleton")
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
