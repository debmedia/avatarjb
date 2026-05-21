# HeyGen / LiveAvatar LITE adapter

Goal: keep this app's current conversation stack while using LiveAvatar only as the realtime video layer:

- Browser microphone -> Gemini Live
- Gemini tool calls -> local banking UI buttons
- Gemini response audio -> LiveAvatar command WebSocket from the browser
- LiveAvatar LITE -> realtime photoreal video stream through LiveKit

The browser never receives the LiveAvatar API key. Provider secrets stay in the local bridge or a backend service.

## Current flow

```text
Browser
  1. Opens local bridge ws://127.0.0.1:8788/liveavatar
  2. Asks bridge to list avatars / create a LITE session
  3. Receives livekit_url, livekit_client_token and ws_url
  4. Connects LiveKit directly for video
  5. Connects ws_url directly and sends agent.speak / agent.speak_end
  6. Connects Gemini Live directly for conversation audio/tools

Bridge
  1. Reads .env
  2. Uses LIVEAVATAR_API_KEY or HEYGEN_API_KEY
  3. Calls LiveAvatar sessions/token and sessions/start
  4. Returns short-lived session credentials to the browser
  5. Stops the session when requested
```

This avoids sending every Gemini audio chunk through localhost, which reduces the audio path by one WebSocket hop.

## Run locally

```powershell
python scripts/liveavatar_bridge.py --host 127.0.0.1 --port 8788
python -m http.server 8000
```

Open:

```text
http://127.0.0.1:8000/avatar3d-gemini-demo.html
```

## Local configuration

Copy the example env file and fill it with your Gemini / HeyGen / LiveAvatar values:

```powershell
Copy-Item .env.example .env
notepad .env
```

`.env` is ignored by Git.

```powershell
GEMINI_API_KEY=AIza...
HEYGEN_API_KEY=...
LIVEAVATAR_API_KEY=...
LIVEAVATAR_API_BASE=https://api.liveavatar.com
LIVEAVATAR_AVATAR_ID=
LIVEAVATAR_IS_SANDBOX=true
LIVEAVATAR_SANDBOX_AVATAR_ID=65f9e3c9-d48b-4118-b73a-4ae2e3cbb8f0
LIVEAVATAR_AUTO_START=false
LIVEAVATAR_VIDEO_QUALITY=medium
LIVEAVATAR_VIDEO_ENCODING=VP8
```

By default the page lists avatars and loads keys, but does not create a LiveAvatar session until the user presses **Iniciar** or **Conectar avatar**. To opt into old autostart behavior for debugging, use `?autoLiveAvatar=1` and set `LIVEAVATAR_AUTO_START=true`.

## Bridge protocol

Browser to bridge:

```json
{"type":"hello","mode":"liveavatar_lite","audio":{"mimeType":"audio/pcm;rate=24000"}}
{"type":"list_avatars","scope":"public"}
{"type":"select_avatar","avatarId":"<avatar-id>","scope":"public"}
{"type":"start_session","avatarId":"<avatar-id>","scope":"public"}
{"type":"stop_session"}
```

Bridge to browser:

```json
{"type":"ready","message":"bridge LiveAvatar conectado","config":{"geminiApiKey":"..."}}
{"type":"avatars","scope":"public","avatars":[{"id":"...","name":"..."}]}
{"type":"session","audioPath":"browser_direct","url":"<livekit_url>","access_token":"<livekit_client_token>","ws_url":"<liveavatar_ws_url>"}
{"type":"status","message":"..."}
{"type":"error","message":"..."}
```

The browser sends realtime audio directly to `ws_url`:

```json
{"type":"agent.speak","event_id":"turn-1","audio":"<base64 pcm16 24khz>"}
{"type":"agent.speak_end","event_id":"turn-1"}
{"type":"agent.interrupt"}
{"type":"session.keep_alive","event_id":"keepalive-..."}
```

## Notes

- In sandbox mode, not every public avatar is supported. The bridge falls back to `LIVEAVATAR_SANDBOX_AVATAR_ID` when the selected avatar is rejected for sandbox.
- `Mis avatares` can return zero if the key has no private LiveAvatar avatars or does not have the expected account permissions.
- The backend should not return raw LiveAvatar API keys to the browser. It should return only short-lived session credentials.
