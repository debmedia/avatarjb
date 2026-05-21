#!/usr/bin/env python3
"""Local WebSocket bridge for Oculus/OVR-style lip sync.

The browser sends Gemini Live PCM chunks here and receives 15 Oculus-style
viseme weights. If OVR_LIPSYNC_LIB points to a native OVRLipSync shared library,
the server will try to use it. Otherwise it falls back to a small audio analyzer
that preserves the same protocol so the Three.js wiring can be tested.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import ctypes
import json
import os
import signal
from dataclasses import dataclass
from typing import Dict, Iterable

import numpy as np
import websockets


VISEMES = [
    "sil",
    "PP",
    "FF",
    "TH",
    "DD",
    "kk",
    "CH",
    "SS",
    "nn",
    "RR",
    "aa",
    "E",
    "ih",
    "oh",
    "ou",
]


def empty_visemes() -> Dict[str, float]:
    return {name: 0.0 for name in VISEMES}


@dataclass
class LipSyncResult:
    engine: str
    visemes: Dict[str, float]

    @property
    def dominant(self) -> str:
        return max(self.visemes.items(), key=lambda item: item[1])[0]


class FallbackOvrLikeEngine:
    """Tiny real-time viseme estimator with the Oculus 15-viseme interface.

    This is not Oculus LipSync. It is a protocol-compatible fallback so we can
    validate transport, morph mapping and latency while the native SDK is wired.
    """

    engine_name = "fallback-ovr-like"

    def process(self, pcm16: bytes, sample_rate: int) -> LipSyncResult:
        samples = np.frombuffer(pcm16, dtype="<i2").astype(np.float32) / 32768.0
        if samples.size < 16:
            visemes = empty_visemes()
            visemes["sil"] = 1.0
            return LipSyncResult(self.engine_name, visemes)

        samples = samples - float(np.mean(samples))
        rms = float(np.sqrt(np.mean(np.square(samples))))
        volume = clamp((rms - 0.010) * 13.0)
        if volume <= 0.015:
            visemes = empty_visemes()
            visemes["sil"] = 1.0
            return LipSyncResult(self.engine_name, visemes)

        window = np.hanning(samples.size)
        spectrum = np.abs(np.fft.rfft(samples * window))
        freqs = np.fft.rfftfreq(samples.size, 1.0 / max(1, sample_rate))

        low = band_energy(spectrum, freqs, 90, 500)
        mid = band_energy(spectrum, freqs, 500, 1800)
        high = band_energy(spectrum, freqs, 1800, 6400)
        total = max(low + mid + high, 1e-6)
        low /= total
        mid /= total
        high /= total

        zero_cross = zero_crossing_rate(samples)
        rounded = clamp((low * 1.55 - high * 0.55) * volume * 2.1)
        wide = clamp((mid * 1.15 + high * 0.58 - low * 0.35) * volume * 1.85)
        noisy = clamp((high * 1.8 + zero_cross * 0.25 - low * 0.35) * volume * 1.5)
        open_vowel = clamp(volume * (0.62 + low * 0.52 + mid * 0.16))
        consonant = clamp((zero_cross * 2.9 + high * 0.72) * volume)

        visemes = empty_visemes()
        visemes["sil"] = clamp(1.0 - volume * 2.4)
        visemes["aa"] = open_vowel
        visemes["E"] = wide * 0.82
        visemes["ih"] = wide * 0.66
        visemes["oh"] = rounded * 0.92
        visemes["ou"] = rounded * 0.72
        visemes["FF"] = noisy * 0.48
        visemes["TH"] = noisy * 0.34
        visemes["SS"] = noisy * 0.46
        visemes["CH"] = consonant * 0.42
        visemes["DD"] = consonant * 0.26
        visemes["kk"] = consonant * 0.24
        visemes["nn"] = consonant * 0.18
        visemes["RR"] = consonant * 0.16
        visemes["PP"] = clamp((consonant - open_vowel * 0.46) * 0.34)

        normalize(visemes)
        return LipSyncResult(self.engine_name, visemes)


class NativeOvrEngine:
    """Best-effort native OVR adapter.

    Meta has shipped OVR LipSync with slightly different packaging over time.
    This adapter intentionally keeps loading conservative; if the expected
    symbols are missing, the server falls back instead of crashing.
    """

    engine_name = "native-ovr"

    def __init__(self, library_path: str):
        self.library_path = library_path
        self.lib = ctypes.cdll.LoadLibrary(library_path)
        required = [
            "ovrLipSyncDll_Initialize",
            "ovrLipSyncDll_Shutdown",
            "ovrLipSyncDll_CreateContext",
            "ovrLipSyncDll_DestroyContext",
            "ovrLipSyncDll_ProcessFrameEx",
        ]
        missing = [name for name in required if not hasattr(self.lib, name)]
        if missing:
            raise RuntimeError(f"OVR library missing symbols: {', '.join(missing)}")

        self.context = ctypes.c_uint32(0)
        self._configure_signatures()
        result = self.lib.ovrLipSyncDll_Initialize(0)
        if result != 0:
            raise RuntimeError(f"ovrLipSyncDll_Initialize failed: {result}")

        # Provider 1 is the enhanced provider in common OVR LipSync builds.
        result = self.lib.ovrLipSyncDll_CreateContext(ctypes.byref(self.context), 1, 48000, 4096)
        if result != 0:
            self.lib.ovrLipSyncDll_Shutdown()
            raise RuntimeError(f"ovrLipSyncDll_CreateContext failed: {result}")

    def _configure_signatures(self) -> None:
        self.lib.ovrLipSyncDll_Initialize.argtypes = [ctypes.c_int]
        self.lib.ovrLipSyncDll_Initialize.restype = ctypes.c_int
        self.lib.ovrLipSyncDll_Shutdown.argtypes = []
        self.lib.ovrLipSyncDll_Shutdown.restype = ctypes.c_int
        self.lib.ovrLipSyncDll_CreateContext.argtypes = [
            ctypes.POINTER(ctypes.c_uint32),
            ctypes.c_int,
            ctypes.c_int,
            ctypes.c_int,
        ]
        self.lib.ovrLipSyncDll_CreateContext.restype = ctypes.c_int
        self.lib.ovrLipSyncDll_DestroyContext.argtypes = [ctypes.c_uint32]
        self.lib.ovrLipSyncDll_DestroyContext.restype = ctypes.c_int

    def process(self, pcm16: bytes, sample_rate: int) -> LipSyncResult:
        # Native processing is left guarded because the public binaries differ by
        # platform/package. Once the exact Linux shared library is present, this
        # method is the only place that needs final symbol/struct adjustment.
        raise NotImplementedError("Native OVR processing needs the exact SDK binary ABI.")

    def close(self) -> None:
        if getattr(self, "context", None):
            self.lib.ovrLipSyncDll_DestroyContext(self.context)
        self.lib.ovrLipSyncDll_Shutdown()


def clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, float(value)))


def band_energy(spectrum: np.ndarray, freqs: np.ndarray, low: float, high: float) -> float:
    mask = (freqs >= low) & (freqs < high)
    if not np.any(mask):
        return 0.0
    return float(np.mean(spectrum[mask]))


def zero_crossing_rate(samples: np.ndarray) -> float:
    signs = np.signbit(samples)
    return float(np.count_nonzero(signs[1:] != signs[:-1]) / max(1, samples.size - 1))


def normalize(visemes: Dict[str, float]) -> None:
    strongest = max(visemes.values(), default=0.0)
    if strongest <= 1.0:
        return
    for key in visemes:
        visemes[key] = clamp(visemes[key] / strongest)


def parse_sample_rate(message: dict) -> int:
    value = message.get("sampleRate") or message.get("sample_rate") or 24000
    try:
        return int(value)
    except (TypeError, ValueError):
        return 24000


def load_engine() -> FallbackOvrLikeEngine | NativeOvrEngine:
    library_path = os.environ.get("OVR_LIPSYNC_LIB", "").strip()
    if not library_path:
        print("OVR_LIPSYNC_LIB not set; using fallback-ovr-like engine.")
        return FallbackOvrLikeEngine()

    try:
        engine = NativeOvrEngine(library_path)
        print(f"Loaded native OVR LipSync library: {library_path}")
        return engine
    except Exception as exc:
        print(f"Could not load native OVR LipSync ({exc}); using fallback-ovr-like engine.")
        return FallbackOvrLikeEngine()


async def handle_client(websocket, engine) -> None:
    await websocket.send(json.dumps({
        "type": "ready",
        "engine": engine.engine_name,
        "visemes": VISEMES,
    }))

    async for raw_message in websocket:
        try:
            message = json.loads(raw_message)
            if message.get("type") == "ping":
                await websocket.send(json.dumps({"type": "pong"}))
                continue

            if message.get("type") != "audio":
                continue

            pcm16 = base64.b64decode(message.get("data", ""))
            sample_rate = parse_sample_rate(message)
            result = engine.process(pcm16, sample_rate)
            await websocket.send(json.dumps({
                "type": "visemes",
                "engine": result.engine,
                "dominant": result.dominant,
                "visemes": result.visemes,
            }))
        except NotImplementedError as exc:
            await websocket.send(json.dumps({
                "type": "error",
                "message": str(exc),
            }))
        except Exception as exc:
            await websocket.send(json.dumps({
                "type": "error",
                "message": f"lip sync processing error: {exc}",
            }))


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    engine = load_engine()
    stop = asyncio.Future()
    loop = asyncio.get_running_loop()

    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set_result, None)

    async with websockets.serve(
        lambda websocket: handle_client(websocket, engine),
        args.host,
        args.port,
        max_size=2_000_000,
        compression=None,
    ):
        print(f"OVR lip sync bridge listening on ws://{args.host}:{args.port}")
        await stop

    close = getattr(engine, "close", None)
    if close:
        close()


if __name__ == "__main__":
    asyncio.run(main())
