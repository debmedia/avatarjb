# HeyGen / LiveAvatar LITE adapter

Goal: keep this app's current stack for conversation control:

- Browser microphone -> Gemini Live
- Gemini tool calls -> local banking UI buttons
- Gemini response audio -> local `liveavatar_bridge.py`
- LiveAvatar LITE/CUSTOM -> realtime photoreal video stream

The browser never stores the LiveAvatar API key. Provider secrets belong in the local bridge or a
backend service.

## Current branch status

The UI already supports `avatarMode=liveavatar`:

```text
http://127.0.0.1:8000/avatar3d-gemini-demo.html?avatarMode=liveavatar
```

In this mode the Three.js canvas is hidden, Audio2Face is skipped, and Gemini PCM output is sent to:

```text
ws://127.0.0.1:8788/liveavatar
```

Run the placeholder bridge:

```bash
python scripts/liveavatar_bridge.py --host 127.0.0.1 --port 8788
```

The bridge currently validates the browser protocol and counts audio chunks. The provider-specific
LiveAvatar session creation and WebRTC handoff are the next piece.

## Bridge protocol

Browser to bridge:

```json
{"type":"hello","mode":"liveavatar_lite","audio":{"mimeType":"audio/pcm;rate=24000"}}
{"type":"audio","mimeType":"audio/pcm;rate=24000","data":"<base64 pcm16 mono>"}
{"type":"speak_end"}
```

Bridge to browser:

```json
{"type":"ready","message":"bridge listo"}
{"type":"status","message":"..."}
{"type":"livekit","url":"<room url>","access_token":"<client token>"}
{"type":"error","message":"..."}
```

When the bridge sends `livekit`, the frontend connects the embedded LiveKit client and attaches the
remote audio/video tracks to the LiveAvatar video element.

## Data needed from HeyGen / LiveAvatar

- `LIVEAVATAR_API_KEY`: developer API key.
- `LIVEAVATAR_AVATAR_ID`: the avatar/replica id to render.
- LITE/CUSTOM session configuration required by the account, especially WebRTC provider settings.
- Whether to run in sandbox/test mode first.
- Desired video quality/resolution and max session duration.
- Whether Gemini audio is the final voice, or whether LiveAvatar should use a separate TTS voice.

If using an older HeyGen Streaming API instead of LiveAvatar LITE, we need:

- HeyGen API key.
- Streaming `avatar_name` / `avatar_id`.
- Optional `voice_id`.
- Whether tasks should be `repeat` (we provide final text) or audio-to-video (we provide PCM audio).
