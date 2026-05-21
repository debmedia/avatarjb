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
from dataclasses import dataclass
from typing import Any

import websockets


@dataclass
class BridgeState:
    started_at: float
    audio_chunks: int = 0
    audio_bytes: int = 0
    turns: int = 0


def env_summary() -> dict[str, bool]:
    return {
        "LIVEAVATAR_API_KEY": bool(os.getenv("LIVEAVATAR_API_KEY")),
        "LIVEAVATAR_AVATAR_ID": bool(os.getenv("LIVEAVATAR_AVATAR_ID")),
        "LIVEAVATAR_SESSION_PAYLOAD_JSON": bool(os.getenv("LIVEAVATAR_SESSION_PAYLOAD_JSON")),
    }


async def send_json(socket: websockets.WebSocketServerProtocol, payload: dict[str, Any]) -> None:
    await socket.send(json.dumps(payload, separators=(",", ":")))


async def handle_client(socket: websockets.WebSocketServerProtocol) -> None:
    state = BridgeState(started_at=time.time())
    await send_json(socket, {
        "type": "ready",
        "message": "bridge local conectado; falta configurar LiveAvatar provider",
        "env": env_summary(),
    })

    async for raw_message in socket:
        try:
            message = json.loads(raw_message)
        except json.JSONDecodeError:
            await send_json(socket, {"type": "error", "message": "mensaje JSON invalido"})
            continue

        message_type = message.get("type")
        if message_type == "hello":
            await send_json(socket, {"type": "status", "message": "modo LiveAvatar LITE inicializado"})
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
    args = parser.parse_args()

    async with websockets.serve(handle_client, args.host, args.port):
        print(f"LiveAvatar bridge listening on ws://{args.host}:{args.port}/liveavatar")
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
