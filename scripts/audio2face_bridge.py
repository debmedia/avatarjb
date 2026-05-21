#!/usr/bin/env python3
"""WebSocket bridge from browser PCM chunks to Audio2Face-3D NIM gRPC.

Protocol from browser:
  {"type":"audio","sampleRate":24000,"data":"<base64 pcm16 mono>"}
  {"type":"end"}

Protocol to browser:
  {"type":"ready","engine":"audio2face-3d","target":"host:52000"}
  {"type":"blendshapes","frames":[{"timeCode":0.0,"blendShapes":{...}}]}
  {"type":"status","code":0,"message":"..."}
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import sys
from pathlib import Path
from typing import Any, Dict, Optional

ROOT = Path(__file__).resolve().parents[1]
ACE_WHEEL = ROOT / "vendor" / "nvidia_ace-1.2.0-py3-none-any.whl"
if ACE_WHEEL.exists():
    sys.path.insert(0, str(ACE_WHEEL))

import grpc
import yaml
import websockets

from nvidia_ace.a2f.v1_pb2 import (
    AudioWithEmotion,
    BlendShapeParameters,
    EmotionPostProcessingParameters,
    FaceParameters,
)
from nvidia_ace.animation_data.v1_pb2 import AnimationData, AnimationDataStreamHeader
from nvidia_ace.audio.v1_pb2 import AudioHeader
from nvidia_ace.controller.v1_pb2 import AudioStream, AudioStreamHeader
from nvidia_ace.emotion_aggregate.v1_pb2 import EmotionAggregate
from nvidia_ace.emotion_with_timecode.v1_pb2 import EmotionWithTimeCode
from nvidia_ace.services.a2f_controller.v1_pb2_grpc import A2FControllerServiceStub


BITS_PER_SAMPLE = 16
CHANNEL_COUNT = 1
AUDIO_FORMAT = AudioHeader.AUDIO_FORMAT_PCM


def load_config(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def parse_sample_rate(message: dict) -> int:
    value = message.get("sampleRate") or message.get("sample_rate") or 24000
    try:
        return int(value)
    except (TypeError, ValueError):
        return 24000


def build_header(sample_rate: int, config: Dict[str, Any]) -> AudioStream:
    emotions = [
        EmotionWithTimeCode(
            emotion={**value["emotions"]},
            time_code=float(value["time_code"]),
        )
        for value in config.get("emotion_with_timecode_list", {}).values()
    ]

    return AudioStream(
        audio_stream_header=AudioStreamHeader(
            audio_header=AudioHeader(
                samples_per_second=sample_rate,
                bits_per_sample=BITS_PER_SAMPLE,
                channel_count=CHANNEL_COUNT,
                audio_format=AUDIO_FORMAT,
            ),
            emotion_post_processing_params=EmotionPostProcessingParameters(
                **config["post_processing_parameters"]
            ),
            face_params=FaceParameters(float_params=config["face_parameters"]),
            blendshape_params=BlendShapeParameters(
                bs_weight_multipliers=config["blendshape_parameters"]["multipliers"],
                bs_weight_offsets=config["blendshape_parameters"]["offsets"],
            ),
        )
    ), emotions


def parse_emotions(animation_data: AnimationData) -> Dict[str, Any]:
    if "emotion_aggregate" not in animation_data.metadata:
        return {}
    aggregate = EmotionAggregate()
    if not animation_data.metadata["emotion_aggregate"].Unpack(aggregate):
        return {}
    return {
        "a2f_smoothed_output": [
            {"timeCode": item.time_code, "emotion": dict(item.emotion)}
            for item in aggregate.a2f_smoothed_output
        ]
    }


class A2FSession:
    def __init__(self, websocket, target: str, config: Dict[str, Any]):
        self.websocket = websocket
        self.target = target
        self.config = config
        self.channel: Optional[grpc.aio.Channel] = None
        self.stream = None
        self.read_task: Optional[asyncio.Task] = None
        self.blendshape_names = []
        self.started = False
        self.closed = False

    async def start(self, sample_rate: int) -> None:
        if self.started:
            return
        self.channel = grpc.aio.insecure_channel(self.target)
        stub = A2FControllerServiceStub(self.channel)
        self.stream = stub.ProcessAudioStream()
        header, emotions = build_header(sample_rate, self.config)
        await self.stream.write(header)
        self.read_task = asyncio.create_task(self.read_loop())
        if emotions:
            await self.stream.write(
                AudioStream(
                    audio_with_emotion=AudioWithEmotion(
                        audio_buffer=b"",
                        emotions=emotions,
                    )
                )
            )
        self.started = True

    async def write_audio(self, pcm16: bytes, sample_rate: int) -> None:
        await self.start(sample_rate)
        if not pcm16:
            return
        await self.stream.write(
            AudioStream(audio_with_emotion=AudioWithEmotion(audio_buffer=pcm16))
        )

    async def end_audio(self) -> None:
        if not self.started or self.closed:
            return
        await self.stream.write(AudioStream(end_of_audio=AudioStream.EndOfAudio()))
        await self.stream.done_writing()

    async def read_loop(self) -> None:
        while True:
            message = await self.stream.read()
            if message == grpc.aio.EOF:
                return

            if message.HasField("animation_data_stream_header"):
                header: AnimationDataStreamHeader = message.animation_data_stream_header
                self.blendshape_names = list(header.skel_animation_header.blend_shapes)
                await self.websocket.send(
                    json.dumps({
                        "type": "header",
                        "blendshapeNames": self.blendshape_names,
                        "sampleRate": header.audio_header.samples_per_second,
                    })
                )
                continue

            if message.HasField("animation_data"):
                animation_data: AnimationData = message.animation_data
                frames = []
                for weights in animation_data.skel_animation.blend_shape_weights:
                    frames.append({
                        "timeCode": weights.time_code,
                        "blendShapes": dict(zip(self.blendshape_names, weights.values)),
                    })
                payload = {"type": "blendshapes", "frames": frames}
                emotions = parse_emotions(animation_data)
                if emotions:
                    payload["emotions"] = emotions
                await self.websocket.send(json.dumps(payload))
                continue

            if message.HasField("status"):
                status = message.status
                await self.websocket.send(
                    json.dumps({
                        "type": "status",
                        "code": status.code,
                        "message": status.message,
                    })
                )

    async def close(self) -> None:
        self.closed = True
        if self.stream and self.started:
            try:
                await self.end_audio()
            except Exception:
                pass
        if self.read_task:
            try:
                await asyncio.wait_for(self.read_task, timeout=2)
            except Exception:
                self.read_task.cancel()
        if self.channel:
            await self.channel.close()


async def handle_client(websocket, target: str, config: Dict[str, Any]) -> None:
    session = A2FSession(websocket, target, config)
    await websocket.send(json.dumps({
        "type": "ready",
        "engine": "audio2face-3d",
        "target": target,
    }))

    try:
        async for raw_message in websocket:
            message = json.loads(raw_message)
            msg_type = message.get("type")
            if msg_type == "audio":
                pcm16 = base64.b64decode(message.get("data", ""))
                await session.write_audio(pcm16, parse_sample_rate(message))
            elif msg_type == "end":
                await session.end_audio()
            elif msg_type == "ping":
                await websocket.send(json.dumps({"type": "pong"}))
    finally:
        await session.close()


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--target", default="44.223.28.18:52000")
    parser.add_argument("--config", default=str(ROOT / "configs" / "audio2face_james.yml"))
    args = parser.parse_args()

    config = load_config(Path(args.config))
    async with websockets.serve(
        lambda websocket: handle_client(websocket, args.target, config),
        args.host,
        args.port,
        max_size=4_000_000,
        compression=None,
    ):
        print(f"Audio2Face bridge listening on ws://{args.host}:{args.port}")
        print(f"Forwarding gRPC to {args.target}")
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
