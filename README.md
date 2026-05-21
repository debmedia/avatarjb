# Journey Builder Avatar CDN Package

This folder contains a standalone static package for publishing the avatar widget on a CDN.

## Files

- `chat.html`
- `css/styles.css`
- `js/embed.js`
- `js/chat.js`
- `image/attachment.jpg`
- `image/background.png`
- `image/numia-icon-positive.svg`

## Publish

Upload the whole `avatar-cdn/` folder to your CDN keeping the same structure.

Example public URL:

- `https://cdn.example.com/numia-avatar/chat.html`

## Required query params

- `flowId`: Journey Builder flow ID
- `hostUrl`: Journey Builder API base URL
- `apiKey`: Journey Builder API key

## Optional query params

- `autoStart=1`
- `view=widget`
- `prompt`
- `speechRegion`
- `speechApiKey`
- `speechPrivateEndpoint`
- `ttsVoice`
- `avatarCharacter`
- `avatarStyle`

## Experimental Gemini Live avatar

This branch also includes a separate prototype entrypoint:

- `gemini-live.html`
- `css/gemini-live.css`
- `js/gemini-live-avatar.js`

It keeps the existing Azure avatar path untouched. The Gemini variant streams microphone audio
directly to Gemini Live, plays Gemini audio output in the browser, drives a lightweight local
mouth animation from audio energy, and exposes one function call named
`consultar_journey_builder` that posts to the configured Journey Builder flow.

Extra params:

- `chat_url=.../gemini-live.html`
- `gemini_api_key` for local demos, or `gemini_token_url` for a backend credentials endpoint
- `gemini_model` defaults to `gemini-3.1-flash-live-preview`
- `gemini_voice` defaults to `Charon`
- `anam_session_token` short-lived Anam session token for local testing
- `anam_token_url` backend endpoint that returns `{ "sessionToken": "..." }`
- `anam_audio_sample_rate` defaults to `16000`
- `avatar_mode=deer2d` enables the default lightweight ChileAtiende demo avatar
- `avatar_mode=anam` enables the Anam avatar prototype when token config is present
- `avatar_mode=talkinghead` enables the free browser 3D avatar prototype
- `talking_head_avatar_url` optional GLB URL for the TalkingHead avatar
- `talking_head_view` defaults to `head`
- `share_screen=1`
- `greet_on_start=1`
- `hide_transcripts=1` hides the live user/agent audio transcript panel
- `show_buttons=1` renders action buttons when the Journey Builder flow returns them

For production, prefer `gemini_token_url`; do not publish a long-lived Gemini API key in page
markup. The endpoint can return either `{ "apiKey": "..." }` / `{ "api_key": "..." }`, or an
ephemeral access token as `{ "access_token": "..." }`.

The Gemini widget renders Journey Builder action buttons when the flow response contains:

```json
{
  "respuesta": "Texto que el avatar debe responder",
  "form": "Nombre opcional del formulario o paso",
  "buttons": [
    { "label": "Texto visible", "value": "Valor enviado al flujo" }
  ]
}
```

For Anam production use, prefer `anam_token_url`; create the session server-side with
`personaConfig.enableAudioPassthrough: true`. The widget imports `@anam-ai/js-sdk` from esm.sh,
streams the Anam avatar into the local video element muted, and keeps Gemini Live as the audio
playback source to avoid double audio.

For the free TalkingHead prototype, the widget imports `met4citizen/TalkingHead` from jsDelivr
and drives the avatar mouth from Gemini audio energy. This is a lightweight approximation, not
phoneme-level lip-sync, because Gemini Live audio chunks do not include visemes.

## Character Creator FBX avatar

This repo also includes a local Character Creator source avatar:

- `avatar1_0.Fbx`
- `avatar1_0.json`

Use Blender to convert it to GLB and preserve facial morph targets:

```bash
blender --background --python scripts/convert-fbx-to-glb.py -- \
  --fbx avatar1_0.Fbx \
  --out public/avatar1_0.glb \
  --report public/avatar1_0.morph-report.json
```

Then open `tools/glb-morph-inspector.html` and load `public/avatar1_0.glb` to inspect the exact
`morphTargetDictionary` names for lip sync / Audio2Face mapping.

For a lighter browser test build, export only upper body:

```bash
blender --background --python scripts/convert-fbx-to-glb.py -- \
  --fbx avatar1_0.Fbx \
  --out public/avatar1_0_upper.glb \
  --report public/avatar1_0_upper.morph-report.json \
  --upper-body
```

Full notes: `docs/character-creator-fbx-to-glb.md`.

For a close facial-animation inspection build, export only the head:

```bash
blender --background --python scripts/convert-fbx-to-glb.py -- \
  --fbx avatar1_0.Fbx \
  --out public/avatar1_0_head.glb \
  --report public/avatar1_0_head.morph-report.json \
  --head-only
```

For the browser performance test, export only the face mesh and keep only the morphs currently
mapped from Audio2Face:

```bash
blender --background --python scripts/convert-fbx-to-glb.py -- \
  --fbx avatar1_0.Fbx \
  --out public/avatar1_0_face_a2f.glb \
  --report public/avatar1_0_face_a2f.morph-report.json \
  --face-only \
  --cut-ratio 0.5 \
  --a2f-morphs-only
```

### Standalone 3D Gemini voice demo

This branch includes a local prototype that does not call Journey Builder:

- `avatar3d-gemini-demo.html`
- `css/avatar3d-demo.css`
- `js/avatar3d-gemini-demo.js`

Run a static server from this folder and open:

```text
http://127.0.0.1:5500/avatar3d-gemini-demo.html
```

The page asks for a Gemini API key locally, connects to Gemini Live, plays Gemini audio and drives
the Character Creator avatar with local, OVR-style or Audio2Face blendshape data.

The standalone demo loads the optimized face-only Audio2Face GLB by default. To compare with the
full head or bust versions:

```text
http://127.0.0.1:5500/avatar3d-gemini-demo.html?avatar=head
http://127.0.0.1:5500/avatar3d-gemini-demo.html?avatar=upper
```

You can lower the render cap while testing audio smoothness:

```text
http://127.0.0.1:5500/avatar3d-gemini-demo.html?fps=20
```

Optional local Oculus-style lip sync bridge:

```bash
python3 scripts/ovr_lipsync_server.py --host 127.0.0.1 --port 8765
```

The demo will connect to `ws://127.0.0.1:8765` and send Gemini PCM audio chunks to receive
15 Oculus/OVR-style viseme weights. If `OVR_LIPSYNC_LIB=/path/to/libOVRLipSync.so` is set, the
server attempts to load a native OVR LipSync library; otherwise it runs a lightweight
protocol-compatible fallback so the browser wiring can be tested without the SDK binary.

The secondary text model used for semantic facial gestures defaults to `gemini-2.5-flash-lite`.
You can override it in local tests:

```text
http://127.0.0.1:5500/avatar3d-gemini-demo.html?gestureModel=gemini-2.5-flash
```

If that model returns 429/5xx, the page backs off for 60 seconds and uses local gesture fallback.

Optional Audio2Face-3D bridge:

```bash
python3 scripts/audio2face_bridge.py \
  --host 127.0.0.1 \
  --port 8766 \
  --target 44.223.28.18:52000
```

The demo connects to `ws://127.0.0.1:8766` by default and forwards Gemini PCM chunks to the
Audio2Face-3D NIM gRPC endpoint. You can override the local bridge URL:

```text
http://127.0.0.1:5500/avatar3d-gemini-demo.html?audio2FaceUrl=ws://127.0.0.1:8766
```

Audio2Face blendshapes have priority over the older OVR-style/local lip-sync fallback when fresh
frames are available.

### HeyGen / LiveAvatar LITE mode

The same Gemini + banking tool UI can be run with a photoreal LiveAvatar video surface instead of
the local Three.js avatar:

```text
http://127.0.0.1:5500/avatar3d-gemini-demo.html?avatarMode=liveavatar
```

In this mode the browser sends Gemini PCM response chunks to a local bridge:

```bash
python scripts/liveavatar_bridge.py --host 127.0.0.1 --port 8788
```

Provider setup notes and required HeyGen/LiveAvatar credentials are in
`docs/liveavatar-lite-adapter.md`.

## Embed examples

### Option A (recommended): script + tag attributes

```html
<script
  src="https://cdn.example.com/numia-avatar/js/embed.js"
  async>
</script>

<journey-builder-avatar
  flow_id="YOUR_FLOW_ID"
  host_url="https://api.example.com"
  api_key="YOUR_API_KEY"
  speech_region="eastus2"
  auto_start="1"
  view="widget"
  tts_voice="en-US-AvaMultilingualNeural"
  avatar_character="lisa"
  avatar_style="casual-sitting">
</journey-builder-avatar>
```

### Option B (legacy): all config in script query

```html
<script
  src="https://cdn.example.com/numia-avatar/js/embed.js?flowId=YOUR_FLOW_ID&hostUrl=https%3A%2F%2Fapi.example.com&apiKey=YOUR_API_KEY&view=widget&autoStart=1&ttsVoice=en-US-AvaMultilingualNeural&avatarCharacter=lisa&avatarStyle=casual-sitting"
  async>
</script>
```

## Notes

- `chat.js` loads Azure Speech SDK from `https://aka.ms/csspeech/jsbrowserpackageraw`.
- `embed.js` creates the iframe automatically and handles jsDelivr HTML fallback (`srcdoc`).
- `embed.js` supports both styles: `<journey-builder-avatar ...>` and query params in the script URL.
- If you use `useLocalVideoForIdle`, publish matching video files under `video/`.
- For jsDelivr specifically, avoid using `chat.html` directly as iframe `src` because it is served as plain text.
  Use `js/embed.js` (or the embed code generated by Journey Builder).
