import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const PARAMS = new URLSearchParams(window.location.search);
const DEFAULT_MODEL = PARAMS.get("model")
  || PARAMS.get("geminiModel")
  || "gemini-2.5-flash-native-audio-preview-12-2025";
const GESTURE_MODEL = PARAMS.get("gestureModel") || "gemini-2.5-flash-lite";
const AVATAR_PRESETS = {
  face: "./public/avatar1_0_face_a2f.glb",
  faceFullMorphs: "./public/avatar1_0_head.glb",
  clothed: "./public/avatar1_0_upper.glb",
  head: "./public/avatar1_0_head.glb",
  upper: "./public/avatar1_0_upper.glb",
  full: "./public/avatar1_0.glb",
};
const AVATAR_LABELS = {
  face: "Cara A2F rapida",
  faceFullMorphs: "Avatar + pelo balance",
  clothed: "Avatar + ropa balance",
  head: "Cabeza + pelo alta",
  upper: "Torso + pelo pesado",
  full: "Cuerpo completo muy pesado",
};
const RENDER_QUALITY_PRESETS = {
  performance: {
    label: "Rendimiento",
    maxPixelRatio: 1,
    antialias: false,
    shadows: false,
    keyIntensity: 2.0,
    fillIntensity: 0.75,
    rimIntensity: 0.85,
  },
  balanced: {
    label: "Balance",
    maxPixelRatio: 1.1,
    antialias: false,
    shadows: false,
    keyIntensity: 2.25,
    fillIntensity: 0.9,
    rimIntensity: 1.0,
  },
  high: {
    label: "Alta",
    maxPixelRatio: 1.5,
    antialias: true,
    shadows: true,
    keyIntensity: 2.6,
    fillIntensity: 1.0,
    rimIntensity: 1.25,
  },
};
const CAMERA_FRAMING_PRESETS = {
  face: { targetRatio: 0.58, distanceRatio: 0.68, faceWeight: 0.75, cameraYOffsetRatio: 0.012 },
  faceFullMorphs: { targetRatio: 0.62, distanceRatio: 0.78, faceWeight: 0.8, cameraYOffsetRatio: 0.012 },
  head: { targetRatio: 0.62, distanceRatio: 0.78, faceWeight: 0.8, cameraYOffsetRatio: 0.012 },
  clothed: { targetRatio: 0.78, distanceRatio: 1.02, faceWeight: 0.72, cameraYOffsetRatio: 0.015 },
  upper: { targetRatio: 0.78, distanceRatio: 1.02, faceWeight: 0.72, cameraYOffsetRatio: 0.015 },
  full: { targetRatio: 0.76, distanceRatio: 1.16, faceWeight: 0.6, cameraYOffsetRatio: 0.018 },
};
const MORPH_MAP_URL = "./public/avatar1_0.morph-map.json";
const STORAGE_KEY = "avatar3d_gemini_api_key";
const EXPRESSIVENESS_STORAGE_KEY = "avatar3d_expressiveness";
const AVATAR_STORAGE_KEY = "avatar3d_avatar_preset";
const RENDER_QUALITY_STORAGE_KEY = "avatar3d_render_quality";
const STORED_AVATAR_PRESET = localStorage.getItem(AVATAR_STORAGE_KEY);
const STORED_RENDER_QUALITY = localStorage.getItem(RENDER_QUALITY_STORAGE_KEY);
const DEFAULT_AVATAR_PRESET = PARAMS.get("avatar")
  || (STORED_AVATAR_PRESET === "face" ? "face" : "clothed");
const AVATAR_PRESET = AVATAR_PRESETS[DEFAULT_AVATAR_PRESET] ? DEFAULT_AVATAR_PRESET : "clothed";
const AVATAR_URL = PARAMS.get("avatarUrl") || AVATAR_PRESETS[AVATAR_PRESET] || AVATAR_PRESETS.clothed;
const DEFAULT_RENDER_QUALITY = PARAMS.get("quality") || STORED_RENDER_QUALITY || "balanced";
const RENDER_QUALITY = RENDER_QUALITY_PRESETS[DEFAULT_RENDER_QUALITY] ? DEFAULT_RENDER_QUALITY : "balanced";
const OVR_LIPSYNC_URL = "ws://127.0.0.1:8765";
const AUDIO2FACE_URL = PARAMS.get("audio2FaceUrl") || "ws://127.0.0.1:8766";
const RENDER_FPS = Number(PARAMS.get("fps") || 30);
const MORPH_EPSILON = 0.005;
const HEAD_MORPH_EPSILON = 0.0007;
const METRICS_WINDOW_MS = 5000;
const METRICS_SAMPLE_INTERVAL_MS = 1000;
const METRICS_MAX_SAMPLES = 3600;
const METRICS_GRAPH_SAMPLES = 60;
const AUDIO2FACE_GAP_WARN_MS = 250;
const AUDIO2FACE_STALE_MS = 1000;
const AUDIO2FACE_FRAME_HOLD_MS = 350;
const AUDIO2FACE_SYNC_OFFSET_MS = Number(PARAMS.get("a2fOffsetMs") || 0);
const DEFAULT_A2F_MOUTH_GAIN = Number(PARAMS.get("a2fMouthGain") || PARAMS.get("mouthGain") || 1.35);
const DEFAULT_A2F_LOWER_FACE_GAIN = Number(PARAMS.get("a2fLowerFaceGain") || PARAMS.get("lowerFaceGain") || 1.45);
const DEFAULT_AUDIO2FACE_BLEND_SMOOTHING = Number(PARAMS.get("a2fSmoothing") || 0.44);
const DEFAULT_HEAD_MOTION_GAIN = Number(PARAMS.get("headMotionGain") || PARAMS.get("headGain") || 0.75);
const DEFAULT_HAIR_ALPHA_TEST = Number(PARAMS.get("hairAlphaTest") || 0.16);
const DEFAULT_HAIR_CAP_ALPHA_TEST = Number(PARAMS.get("hairCapAlphaTest") || 0.24);
const DEFAULT_HAIR_CAP_OPACITY = Number(PARAMS.get("hairCapOpacity") || 0.58);
const RELAXED_ARM_POSE = PARAMS.get("armPose") !== "0";
const BANKING_TOOL_NAME = "consultar_flujo_bancario";
const ENABLE_GEMINI_TOOLS = PARAMS.get("tools") !== "0" && PARAMS.get("useTools") !== "0";
const SHOW_ACTION_BUTTONS = PARAMS.get("showButtons") !== "0";
const DEBUG_AUDIO2FACE_METRICS = PARAMS.get("debugA2F") === "1";
const HEAD_MORPHS = [
  "Head_Turn_Up",
  "Head_Turn_Down",
  "Head_Turn_L",
  "Head_Turn_R",
  "Head_Tilt_L",
  "Head_Tilt_R",
  "Head_L",
  "Head_R",
  "Head_Forward",
  "Head_Backward",
];
const HEAD_MORPH_SET = new Set(HEAD_MORPHS);
const EYE_ATTACHMENT_MORPHS = new Set([
  ...HEAD_MORPHS,
  "Eye_Blink_L",
  "Eye_Blink_R",
  "Eye_Widen_L",
  "Eye_Widen_R",
  "Eye_Squint_Inner_L",
  "Eye_Squint_Inner_R",
  "Eye_Squint_L",
  "Eye_Squint_R",
  "Eye_Cheek_Raise_L",
  "Eye_Cheek_Raise_R",
]);
const BROW_ATTACHMENT_MORPHS = new Set([
  ...EYE_ATTACHMENT_MORPHS,
  "Brow_Down_L",
  "Brow_Down_R",
  "Brow_Raise_In_L",
  "Brow_Raise_In_R",
  "Brow_Raise_Outer_L",
  "Brow_Raise_Outer_R",
]);
const FACE_ATTACHMENT_MORPHS = new Set([
  ...HEAD_MORPHS,
  "Jaw_Open",
  "Jaw_Left",
  "Jaw_Right",
  "Jaw_Fwd",
  "Mouth_Corner_Pull_L",
  "Mouth_Corner_Pull_R",
  "Mouth_Stretch_L",
  "Mouth_Stretch_R",
  "Mouth_Dimple_L",
  "Mouth_Dimple_R",
  "Mouth_Corner_Depress_L",
  "Mouth_Corner_Depress_R",
  "Mouth_UpperLip_Raise_L",
  "Mouth_UpperLip_Raise_R",
  "Mouth_LowerLip_Depress_L",
  "Mouth_LowerLip_Depress_R",
]);
const METRICS_COLUMNS = [
  "timestamp_iso",
  "elapsed_ms",
  "mode",
  "avatar_preset",
  "render_quality",
  "ws_state",
  "muted",
  "mic_capture_fps",
  "mic_send_fps",
  "mic_level",
  "mic_frames_captured_total",
  "mic_frames_sent_total",
  "a2f_audio_send_fps",
  "a2f_audio_drop_fps",
  "a2f_audio_bytes_per_sec",
  "a2f_audio_chunks_sent_total",
  "a2f_audio_chunks_dropped_total",
  "a2f_socket_open_count",
  "a2f_socket_close_count",
  "a2f_last_close_code",
  "a2f_last_close_reason",
  "a2f_buffer_ahead_ms",
  "lipsync_source",
  "fallback_active",
  "fallback_enter_count",
  "fallback_reason",
  "fallback_duration_ms",
  "mouth_gain",
  "lower_face_gain",
  "a2f_smoothing",
  "head_motion_gain",
  "head_motion_level",
  "a2f_rx_fps",
  "a2f_packet_fps",
  "a2f_timecode_fps",
  "a2f_frames_received_total",
  "avatar_a2f_fps",
  "avatar_fallback_fps",
  "fallback_pct",
  "stale_ms",
  "stale_state",
  "gap_count",
  "last_gap_ms",
  "max_gap_ms",
  "blend_active_count",
  "blend_energy",
  "blend_max_weight",
  "top_blendshapes",
  "jaw_max_seen",
  "avatar_paused",
];

const elements = {
  stage: document.getElementById("avatarStage"),
  avatarSelect: document.getElementById("avatarSelect"),
  renderQualitySelect: document.getElementById("renderQualitySelect"),
  micSelect: document.getElementById("micSelect"),
  apiKeyInput: document.getElementById("apiKeyInput"),
  voiceSelect: document.getElementById("voiceSelect"),
  promptInput: document.getElementById("promptInput"),
  mouthGainInput: document.getElementById("mouthGainInput"),
  mouthGainValue: document.getElementById("mouthGainValue"),
  lowerFaceGainInput: document.getElementById("lowerFaceGainInput"),
  lowerFaceGainValue: document.getElementById("lowerFaceGainValue"),
  a2fSmoothingInput: document.getElementById("a2fSmoothingInput"),
  a2fSmoothingValue: document.getElementById("a2fSmoothingValue"),
  headMotionGainInput: document.getElementById("headMotionGainInput"),
  headMotionGainValue: document.getElementById("headMotionGainValue"),
  pauseAvatarButton: document.getElementById("pauseAvatarButton"),
  micA2FButton: document.getElementById("micA2FButton"),
  startButton: document.getElementById("startButton"),
  muteButton: document.getElementById("muteButton"),
  stopButton: document.getElementById("stopButton"),
  statusText: document.getElementById("statusText"),
  statusDot: document.getElementById("statusDot"),
  actionPanel: document.getElementById("actionPanel"),
  gestureStatus: document.getElementById("gestureStatus"),
  fallbackBadge: document.getElementById("fallbackBadge"),
  metricsStatus: document.getElementById("metricsStatus"),
  fpsChartCanvas: document.getElementById("fpsChartCanvas"),
  latencyChartCanvas: document.getElementById("latencyChartCanvas"),
  blendChartCanvas: document.getElementById("blendChartCanvas"),
  downloadMetricsCsvButton: document.getElementById("downloadMetricsCsvButton"),
  downloadMetricsJsonButton: document.getElementById("downloadMetricsJsonButton"),
  clearMetricsButton: document.getElementById("clearMetricsButton"),
};

const state = {
  socket: null,
  ready: false,
  directAudio2Face: false,
  muted: false,
  starting: false,
  micStream: null,
  micContext: null,
  micSource: null,
  micProcessor: null,
  micMonitorGain: null,
  micRemainder: new Float32Array(0),
  micFramesCaptured: 0,
  micFramesSent: 0,
  micLastLevel: 0,
  micStatusTimer: 0,
  playbackContext: null,
  playbackGain: null,
  playbackAnalyser: null,
  headAudioTimeData: null,
  playbackCursor: 0,
  playbackSources: new Set(),
  lipsyncSocket: null,
  lipsyncReady: false,
  lipsyncEngine: "",
  ovrVisemes: {},
  lastOvrVisemeAt: 0,
  audio2FaceSocket: null,
  audio2FaceReady: false,
  audio2FaceBlendShapes: {},
  audio2FaceFrameBuffer: [],
  audio2FacePlaybackStartAt: 0,
  audio2FaceSmoothedBlendShapes: {},
  audio2FaceResetTimer: 0,
  audio2FaceFramesReceived: 0,
  audio2FaceMaxJawOpen: 0,
  lastAudio2FaceAt: 0,
  lipSyncSource: "idle",
  fallbackReason: "",
  fallbackActiveSince: 0,
  fallbackLastAt: 0,
  mouthGain: clampRange(DEFAULT_A2F_MOUTH_GAIN, 0.5, 2.5),
  lowerFaceGain: clampRange(DEFAULT_A2F_LOWER_FACE_GAIN, 0.5, 2.5),
  a2fSmoothing: clampRange(DEFAULT_AUDIO2FACE_BLEND_SMOOTHING, 0.15, 0.8),
  headMotionGain: clampRange(DEFAULT_HEAD_MOTION_GAIN, 0, 1.5),
  headMotionLevel: 0,
  headCurrent: { nod: 0, turn: 0, tilt: 0, forward: 0 },
  semanticHead: { nod: 0, turn: 0, tilt: 0, until: 0 },
  metricsTimer: 0,
  metrics: {
    micCapture: [],
    micSend: [],
    a2fAudioSend: [],
    a2fAudioDrop: [],
    a2fAudioBytes: [],
    a2fPackets: [],
    a2fFrames: [],
    a2fApply: [],
    localFallback: [],
    a2fTimecodes: [],
    a2fLastPacketAt: 0,
    a2fGapCount: 0,
    a2fLastGapMs: 0,
    a2fMaxGapMs: 0,
    a2fLastActiveCount: 0,
    a2fLastEnergy: 0,
    a2fLastMaxWeight: 0,
    a2fLastTop: "",
    a2fAudioChunksSent: 0,
    a2fAudioChunksDropped: 0,
    a2fSocketOpenCount: 0,
    a2fSocketCloseCount: 0,
    a2fLastCloseCode: "",
    a2fLastCloseReason: "",
    fallbackEnterCount: 0,
    samples: [],
    lastSampleAt: 0,
    sessionStartAt: Date.now(),
    sessionStartPerfAt: performance.now(),
  },
  animationFrame: 0,
  lastRenderAt: 0,
  morphTargetsByName: new Map(),
  morphValues: new Map(),
  scene: null,
  camera: null,
  renderer: null,
  controls: null,
  avatarRoot: null,
  avatarPreset: AVATAR_PRESET,
  avatarUrl: AVATAR_URL,
  renderQuality: RENDER_QUALITY,
  morphMeshes: [],
  morphMap: null,
  avatarPaused: false,
  lipCurrent: {},
  lipTargets: {},
  idleStartAt: performance.now(),
  expressionActiveUntil: 0,
  blinkTimer: 0,
  blinkSequenceTimeouts: [],
  blink: null,
  naturalBlinkLeft: 0,
  naturalBlinkRight: 0,
  a2fBlinkLeft: 0,
  a2fBlinkRight: 0,
  closingManually: false,
  actionPayload: null,
  bankingFlow: {
    accountType: "",
    ageConfirmed: false,
    usingMockData: false,
  },
  responseTranscript: "",
  lastUserText: "",
  geminiModel: DEFAULT_MODEL,
  geminiToolsEnabled: ENABLE_GEMINI_TOOLS,
  lastGestureTextLength: 0,
  lastGestureRequestAt: 0,
  lastLocalGestureAt: 0,
  gestureAbort: null,
  gestureBackoffUntil: 0,
  expressionTimeouts: [],
};

function setStatus(text, mode = "idle") {
  elements.statusText.textContent = text;
  elements.statusDot.classList.toggle("is-ready", mode === "ready");
  elements.statusDot.classList.toggle("is-error", mode === "error");
}

function setButtons() {
  elements.startButton.disabled = state.starting || state.ready || state.directAudio2Face;
  elements.micA2FButton.disabled = state.starting || state.ready;
  elements.micA2FButton.textContent = state.directAudio2Face ? "Detener microfono -> avatar" : "Microfono -> avatar";
  elements.stopButton.disabled = !state.socket && !state.ready && !state.starting && !state.directAudio2Face;
  elements.muteButton.disabled = !state.ready && !state.directAudio2Face;
  elements.muteButton.textContent = state.muted ? "Activar" : "Mutear";
  elements.pauseAvatarButton.textContent = state.avatarPaused ? "Mostrar avatar" : "Pausar avatar";
}

function clearActionPanel() {
  state.actionPayload = null;
  document.body.classList.remove("has-action-panel");
  if (!elements.actionPanel) return;
  elements.actionPanel.hidden = true;
  elements.actionPanel.innerHTML = "";
}

function tryParseStructuredJson(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || !["{", "["].includes(trimmed[0])) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function normalizeActionButton(button) {
  if (typeof button === "string") {
    const value = button.trim();
    return value ? { label: value, value } : null;
  }
  if (!button || typeof button !== "object") return null;
  const label = String(button.label || button.text || button.title || button.nombre || button.value || "").trim();
  const value = String(button.value || button.message || button.mensaje || button.action || button.label || button.text || button.title || "").trim();
  if (!label || !value) return null;
  return { label, value };
}

function normalizeUiText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function actionButtonsFromObject(buttonsObject) {
  if (!buttonsObject || typeof buttonsObject !== "object" || Array.isArray(buttonsObject)) return [];

  const directKeys = ["buttons", "button", "options", "opciones", "actions", "acciones", "choices"];
  for (const key of directKeys) {
    if (buttonsObject[key] !== undefined) {
      return normalizeActionButtons(buttonsObject[key]);
    }
  }

  return Object.entries(buttonsObject)
    .map(([label, value]) => {
      if (typeof value === "string" || typeof value === "number") {
        return normalizeActionButton({ label, value });
      }
      return normalizeActionButton(value);
    })
    .filter(Boolean);
}

function normalizeActionButtons(rawButtons) {
  const parsed = tryParseStructuredJson(rawButtons);
  const buttons = parsed !== null ? parsed : rawButtons;
  if (buttons && typeof buttons === "object" && !Array.isArray(buttons)) {
    const fromObject = actionButtonsFromObject(buttons);
    if (fromObject.length) return fromObject.slice(0, 8);
  }
  const buttonList = Array.isArray(buttons) ? buttons : buttons ? [buttons] : [];
  return buttonList
    .map((button) => {
      const nested = tryParseStructuredJson(button);
      return normalizeActionButton(nested !== null ? nested : button);
    })
    .filter(Boolean)
    .slice(0, 8);
}

function fallbackActionButtons(form) {
  const text = normalizeUiText(form);
  if (text.includes("tipo de cuenta") || text.includes("cuenta te interesa") || text.includes("cuenta quieres")) {
    return normalizeActionButtons(["Cuenta corriente", "Cuenta vista", "Cuenta de ahorro"]);
  }
  if (text.includes("mayor de edad") || text.includes("18")) {
    return normalizeActionButtons(["Si, soy mayor de 18", "No, necesito ayuda"]);
  }
  if (text.includes("continuar") || text.includes("seguimos") || text.includes("siguiente")) {
    return normalizeActionButtons(["Continuar", "Volver atras"]);
  }
  return [];
}

function actionPayloadFromAssistantText(text) {
  const normalized = normalizeUiText(text);
  if (normalized.includes("tipo de cuenta") || normalized.includes("cuenta te interesa") || normalized.includes("cuenta quieres")) {
    return {
      form: "Que tipo de cuenta te interesa?",
      buttons: ["Cuenta corriente", "Cuenta vista", "Cuenta de ahorro"],
    };
  }
  if (normalized.includes("mayor de edad") || normalized.includes("mayor de 18") || normalized.includes("eres mayor")) {
    return {
      form: "Eres mayor de 18?",
      buttons: ["Si, soy mayor de 18", "No, necesito ayuda"],
    };
  }
  if (normalized.includes("continuamos") || normalized.includes("quieres continuar") || normalized.includes("seguimos")) {
    return {
      form: "Seguimos con la simulacion?",
      buttons: ["Continuar", "Volver atras"],
    };
  }
  return null;
}

function maybeRenderActionPanelFromText(text) {
  if (state.actionPayload) return;
  const payload = actionPayloadFromAssistantText(text);
  if (!payload) return;
  renderActionPanel(payload);
  setGestureStatus("UI: botones por texto");
}

function renderActionPanel(payload = {}) {
  if (!SHOW_ACTION_BUTTONS || !elements.actionPanel) return;
  clearActionPanel();
  const parsedPayload = tryParseStructuredJson(payload);
  const data = parsedPayload !== null ? parsedPayload : payload || {};
  const form = String(data.form || data.title || data.text || data.titulo || data.pregunta || "").trim();
  let buttons = normalizeActionButtons(
    data.buttons || data.button || data.options || data.opciones || data.actions || data.acciones || data.choices,
  );
  if (!buttons.length) buttons = fallbackActionButtons(form);
  if (!form && !buttons.length) return;

  state.actionPayload = { form, buttons };

  if (form) {
    const formElement = document.createElement("p");
    formElement.className = "action-form";
    formElement.textContent = form;
    elements.actionPanel.appendChild(formElement);
  }

  if (buttons.length) {
    const wrapper = document.createElement("div");
    wrapper.className = "action-buttons";
    buttons.forEach((button) => {
      const buttonElement = document.createElement("button");
      buttonElement.className = "action-button";
      buttonElement.type = "button";
      buttonElement.textContent = button.label;
      buttonElement.addEventListener("click", () => handleActionButtonClick(button));
      wrapper.appendChild(buttonElement);
    });
    elements.actionPanel.appendChild(wrapper);
  }

  elements.actionPanel.hidden = false;
  document.body.classList.add("has-action-panel");
  setGestureStatus(`UI: ${buttons.length} botones renderizados`);
}

function handleActionButtonClick(button) {
  if (!button?.value) return;
  clearActionPanel();
  setStatus("Opcion enviada", state.ready ? "ready" : "idle");
  setGestureStatus(`UI: ${button.label}`);
  sendClientText(button.value);
}

function resetBankingFlow() {
  state.bankingFlow = {
    accountType: "",
    ageConfirmed: false,
    usingMockData: false,
  };
}

function setGestureStatus(text) {
  if (elements.gestureStatus) {
    elements.gestureStatus.textContent = text;
  }
}

function fallbackReasonLabel(reason) {
  if (reason === "direct_mic_no_a2f") return "mic directo sin A2F";
  if (reason === "playback_no_a2f") return "audio sin frames A2F";
  return reason || "";
}

function fallbackDurationMs(now = performance.now()) {
  if (state.lipSyncSource !== "fallback" || !state.fallbackActiveSince) return 0;
  return Math.max(0, Math.round(now - state.fallbackActiveSince));
}

function updateFallbackBadge() {
  const source = state.avatarPaused ? "paused" : state.lipSyncSource;
  const isFallback = source === "fallback";
  if (elements.fallbackBadge) {
    elements.fallbackBadge.classList.toggle("is-a2f", source === "audio2face");
    elements.fallbackBadge.classList.toggle("is-fallback", isFallback);
    elements.fallbackBadge.classList.toggle("is-paused", source === "paused");
    elements.fallbackBadge.classList.toggle("is-idle", source === "idle");

    let text = "Lip-sync: esperando";
    if (source === "audio2face") text = "Lip-sync: A2F activo";
    if (source === "fallback") {
      const reason = fallbackReasonLabel(state.fallbackReason);
      text = `Lip-sync: FALLBACK LOCAL${reason ? ` - ${reason}` : ""}`;
    }
    if (source === "ovr") text = "Lip-sync: OVR activo";
    if (source === "paused") text = "Lip-sync: avatar pausado";
    if (elements.fallbackBadge.textContent !== text) {
      elements.fallbackBadge.textContent = text;
    }
  }
  elements.metricsStatus?.classList.toggle("is-fallback", isFallback);
}

function setLipSyncSource(source, reason = "") {
  const nextSource = source || "idle";
  const nextReason = nextSource === "fallback" ? reason : "";
  const wasFallback = state.lipSyncSource === "fallback";
  const changed = state.lipSyncSource !== nextSource || state.fallbackReason !== nextReason;
  const now = performance.now();

  if (nextSource === "fallback") {
    state.fallbackLastAt = now;
    if (!wasFallback) {
      state.fallbackActiveSince = now;
      state.metrics.fallbackEnterCount += 1;
    }
  } else {
    state.fallbackActiveSince = 0;
  }

  state.lipSyncSource = nextSource;
  state.fallbackReason = nextReason;
  if (changed) updateFallbackBadge();
}

function formatGain(value) {
  return `${Number(value).toFixed(2)}x`;
}

function updateExpressivenessControls() {
  if (elements.mouthGainInput) elements.mouthGainInput.value = state.mouthGain.toFixed(2);
  if (elements.mouthGainValue) elements.mouthGainValue.textContent = formatGain(state.mouthGain);
  if (elements.lowerFaceGainInput) elements.lowerFaceGainInput.value = state.lowerFaceGain.toFixed(2);
  if (elements.lowerFaceGainValue) elements.lowerFaceGainValue.textContent = formatGain(state.lowerFaceGain);
  if (elements.a2fSmoothingInput) elements.a2fSmoothingInput.value = state.a2fSmoothing.toFixed(2);
  if (elements.a2fSmoothingValue) elements.a2fSmoothingValue.textContent = state.a2fSmoothing.toFixed(2);
  if (elements.headMotionGainInput) elements.headMotionGainInput.value = state.headMotionGain.toFixed(2);
  if (elements.headMotionGainValue) elements.headMotionGainValue.textContent = formatGain(state.headMotionGain);
}

function persistExpressivenessSettings() {
  localStorage.setItem(EXPRESSIVENESS_STORAGE_KEY, JSON.stringify({
    mouthGain: state.mouthGain,
    lowerFaceGain: state.lowerFaceGain,
    a2fSmoothing: state.a2fSmoothing,
    headMotionGain: state.headMotionGain,
  }));
}

function setExpressivenessSetting(key, value, persist = true) {
  if (key === "mouthGain") {
    state.mouthGain = clampRange(value, 0.5, 2.5);
  }
  if (key === "lowerFaceGain") {
    state.lowerFaceGain = clampRange(value, 0.5, 2.5);
  }
  if (key === "a2fSmoothing") {
    state.a2fSmoothing = clampRange(value, 0.15, 0.8);
  }
  if (key === "headMotionGain") {
    state.headMotionGain = clampRange(value, 0, 1.5);
  }
  updateExpressivenessControls();
  if (persist) persistExpressivenessSettings();
  updateMetricsStatus();
}

function setMicStatus(text) {
  const lipsync = state.audio2FaceReady
    ? `lip-sync audio2face frames:${state.audio2FaceFramesReceived} jaw:${state.audio2FaceMaxJawOpen.toFixed(2)}`
    : state.lipsyncReady
      ? `lip-sync ${state.lipsyncEngine || "local"}`
      : "lip-sync local";
  setGestureStatus(`${text} | ${lipsync} | ${state.avatarPaused ? "avatar pausado" : "avatar activo"}`);
  updateMetricsStatus();
}

function markMetric(bucket, value = 1) {
  const now = performance.now();
  bucket.push([now, value]);
  pruneMetric(bucket, now);
}

function pruneMetric(bucket, now = performance.now()) {
  const cutoff = now - METRICS_WINDOW_MS;
  while (bucket.length && bucket[0][0] < cutoff) {
    bucket.shift();
  }
}

function metricRate(bucket, now = performance.now()) {
  pruneMetric(bucket, now);
  const total = bucket.reduce((sum, sample) => sum + sample[1], 0);
  return total / (METRICS_WINDOW_MS / 1000);
}

function resetAudio2FaceMetrics() {
  state.audio2FaceFramesReceived = 0;
  state.audio2FaceMaxJawOpen = 0;
  state.metrics.micCapture = [];
  state.metrics.micSend = [];
  state.metrics.a2fAudioSend = [];
  state.metrics.a2fAudioDrop = [];
  state.metrics.a2fAudioBytes = [];
  state.metrics.a2fPackets = [];
  state.metrics.a2fFrames = [];
  state.metrics.a2fApply = [];
  state.metrics.localFallback = [];
  state.metrics.a2fTimecodes = [];
  state.metrics.a2fLastPacketAt = 0;
  state.metrics.a2fGapCount = 0;
  state.metrics.a2fLastGapMs = 0;
  state.metrics.a2fMaxGapMs = 0;
  state.metrics.a2fLastActiveCount = 0;
  state.metrics.a2fLastEnergy = 0;
  state.metrics.a2fLastMaxWeight = 0;
  state.metrics.a2fLastTop = "";
  state.metrics.a2fAudioChunksSent = 0;
  state.metrics.a2fAudioChunksDropped = 0;
  state.metrics.a2fSocketOpenCount = 0;
  state.metrics.a2fSocketCloseCount = 0;
  state.metrics.a2fLastCloseCode = "";
  state.metrics.a2fLastCloseReason = "";
  state.metrics.fallbackEnterCount = 0;
  state.metrics.samples = [];
  state.metrics.lastSampleAt = 0;
  state.metrics.sessionStartAt = Date.now();
  state.metrics.sessionStartPerfAt = performance.now();
  setLipSyncSource("idle");
  updateMetricsButtons();
  updateMetricsStatus();
}

function updateAudio2FaceFrameMetrics(frames = []) {
  const now = performance.now();
  const metrics = state.metrics;
  if (metrics.a2fLastPacketAt) {
    const gapMs = now - metrics.a2fLastPacketAt;
    metrics.a2fLastGapMs = gapMs;
    if (gapMs > AUDIO2FACE_GAP_WARN_MS) {
      metrics.a2fGapCount += 1;
      metrics.a2fMaxGapMs = Math.max(metrics.a2fMaxGapMs, gapMs);
      if (DEBUG_AUDIO2FACE_METRICS) {
        console.info(`[A2F metrics] gap ${Math.round(gapMs)}ms`);
      }
    }
  } else {
    metrics.a2fLastGapMs = 0;
  }
  metrics.a2fLastPacketAt = now;
  markMetric(metrics.a2fPackets);
  markMetric(metrics.a2fFrames, frames.length);

  frames.forEach((frame) => {
    const timeCode = Number(frame?.timeCode);
    if (Number.isFinite(timeCode)) {
      metrics.a2fTimecodes.push([now, timeCode]);
    }
  });
  pruneMetric(metrics.a2fTimecodes, now);

  const frame = frames[frames.length - 1];
  const blendShapes = frame?.blendShapes || {};
  const entries = Object.entries(blendShapes)
    .map(([name, value]) => [name, clamp01(value)])
    .filter(([, value]) => value > 0.02);
  const totalWeights = Object.values(blendShapes).length || 1;
  const energy = Object.values(blendShapes).reduce((sum, value) => sum + clamp01(value), 0) / totalWeights;
  const maxWeight = entries.reduce((max, [, value]) => Math.max(max, value), 0);

  metrics.a2fLastActiveCount = entries.length;
  metrics.a2fLastEnergy = energy;
  metrics.a2fLastMaxWeight = maxWeight;
  metrics.a2fLastTop = entries
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name, value]) => `${name}:${value.toFixed(2)}`)
    .join(" ");
}

function audio2FaceTimecodeFps(now = performance.now()) {
  const samples = state.metrics.a2fTimecodes;
  pruneMetric(samples, now);
  if (samples.length < 2) return null;
  const first = samples[0][1];
  const last = samples[samples.length - 1][1];
  const seconds = last - first;
  if (!Number.isFinite(seconds) || seconds <= 0.05) return null;
  return (samples.length - 1) / seconds;
}

function buildMetricsSnapshot(now = performance.now()) {
  const metrics = state.metrics;
  const a2fRxFps = metricRate(metrics.a2fFrames, now);
  const a2fPacketFps = metricRate(metrics.a2fPackets, now);
  const a2fApplyFps = metricRate(metrics.a2fApply, now);
  const fallbackFps = metricRate(metrics.localFallback, now);
  const micCaptureFps = metricRate(metrics.micCapture, now);
  const micSendFps = metricRate(metrics.micSend, now);
  const a2fAudioSendFps = metricRate(metrics.a2fAudioSend, now);
  const a2fAudioDropFps = metricRate(metrics.a2fAudioDrop, now);
  const a2fAudioBytesPerSec = metricRate(metrics.a2fAudioBytes, now);
  const drivenFps = a2fApplyFps + fallbackFps;
  const fallbackPct = drivenFps > 0 ? (fallbackFps / drivenFps) * 100 : 0;
  const staleMs = state.lastAudio2FaceAt ? Math.max(0, Date.now() - state.lastAudio2FaceAt) : 0;
  const staleLabel = state.audio2FaceReady && staleMs > AUDIO2FACE_STALE_MS ? "STALE" : "ok";
  const tcFps = audio2FaceTimecodeFps(now);
  const playbackTime = currentAudio2FacePlaybackTime();
  const latestBufferedFrame = state.audio2FaceFrameBuffer[state.audio2FaceFrameBuffer.length - 1];
  const bufferAheadMs = Number.isFinite(playbackTime) && latestBufferedFrame
    ? Math.max(0, (latestBufferedFrame.timeCode - playbackTime) * 1000)
    : "";
  const fallbackActive = state.lipSyncSource === "fallback";
  const wsState = state.audio2FaceSocket
    ? ["CONNECTING", "OPEN", "CLOSING", "CLOSED"][state.audio2FaceSocket.readyState] || "?"
    : "off";

  return {
    timestamp_iso: new Date().toISOString(),
    elapsed_ms: Math.round(now - metrics.sessionStartPerfAt),
    mode: state.ready ? "gemini" : state.directAudio2Face ? "mic_avatar" : "idle",
    avatar_preset: state.avatarPreset,
    render_quality: state.renderQuality,
    ws_state: wsState,
    muted: state.muted ? 1 : 0,
    mic_capture_fps: Number(micCaptureFps.toFixed(3)),
    mic_send_fps: Number(micSendFps.toFixed(3)),
    mic_level: Number(state.micLastLevel.toFixed(4)),
    mic_frames_captured_total: state.micFramesCaptured,
    mic_frames_sent_total: state.micFramesSent,
    a2f_audio_send_fps: Number(a2fAudioSendFps.toFixed(3)),
    a2f_audio_drop_fps: Number(a2fAudioDropFps.toFixed(3)),
    a2f_audio_bytes_per_sec: Math.round(a2fAudioBytesPerSec),
    a2f_audio_chunks_sent_total: metrics.a2fAudioChunksSent,
    a2f_audio_chunks_dropped_total: metrics.a2fAudioChunksDropped,
    a2f_socket_open_count: metrics.a2fSocketOpenCount,
    a2f_socket_close_count: metrics.a2fSocketCloseCount,
    a2f_last_close_code: metrics.a2fLastCloseCode,
    a2f_last_close_reason: metrics.a2fLastCloseReason,
    a2f_buffer_ahead_ms: bufferAheadMs === "" ? "" : Math.round(bufferAheadMs),
    lipsync_source: state.lipSyncSource,
    fallback_active: fallbackActive ? 1 : 0,
    fallback_enter_count: metrics.fallbackEnterCount,
    fallback_reason: fallbackActive ? state.fallbackReason : "",
    fallback_duration_ms: fallbackActive ? fallbackDurationMs(now) : 0,
    mouth_gain: Number(state.mouthGain.toFixed(3)),
    lower_face_gain: Number(state.lowerFaceGain.toFixed(3)),
    a2f_smoothing: Number(state.a2fSmoothing.toFixed(3)),
    head_motion_gain: Number(state.headMotionGain.toFixed(3)),
    head_motion_level: Number(state.headMotionLevel.toFixed(4)),
    a2f_rx_fps: Number(a2fRxFps.toFixed(3)),
    a2f_packet_fps: Number(a2fPacketFps.toFixed(3)),
    a2f_timecode_fps: tcFps ? Number(tcFps.toFixed(3)) : "",
    a2f_frames_received_total: state.audio2FaceFramesReceived,
    avatar_a2f_fps: Number(a2fApplyFps.toFixed(3)),
    avatar_fallback_fps: Number(fallbackFps.toFixed(3)),
    fallback_pct: Number(fallbackPct.toFixed(3)),
    stale_ms: Math.round(staleMs),
    stale_state: staleLabel,
    gap_count: metrics.a2fGapCount,
    last_gap_ms: Math.round(metrics.a2fLastGapMs),
    max_gap_ms: Math.round(metrics.a2fMaxGapMs),
    blend_active_count: metrics.a2fLastActiveCount,
    blend_energy: Number(metrics.a2fLastEnergy.toFixed(5)),
    blend_max_weight: Number(metrics.a2fLastMaxWeight.toFixed(4)),
    top_blendshapes: metrics.a2fLastTop || "",
    jaw_max_seen: Number(state.audio2FaceMaxJawOpen.toFixed(4)),
    avatar_paused: state.avatarPaused ? 1 : 0,
  };
}

function maybeRecordMetricsSample(snapshot, now = performance.now()) {
  if (!state.micStream && !state.audio2FaceReady && !state.ready && !state.directAudio2Face) return;
  if (now - state.metrics.lastSampleAt < METRICS_SAMPLE_INTERVAL_MS) return;
  state.metrics.lastSampleAt = now;
  state.metrics.samples.push(snapshot);
  if (state.metrics.samples.length > METRICS_MAX_SAMPLES) {
    state.metrics.samples.splice(0, state.metrics.samples.length - METRICS_MAX_SAMPLES);
  }
  updateMetricsButtons();
}

function updateMetricsStatus() {
  if (!elements.metricsStatus) return;
  const now = performance.now();
  const snapshot = buildMetricsSnapshot(now);
  maybeRecordMetricsSample(snapshot, now);
  drawMetricsCharts(snapshot);
  const fallbackState = snapshot.fallback_active
    ? `ON ${fallbackReasonLabel(snapshot.fallback_reason) || snapshot.fallback_reason} ${snapshot.fallback_duration_ms}ms`
    : "off";
  elements.metricsStatus.textContent = [
    `A2F rx:${snapshot.a2f_rx_fps.toFixed(1)}fps pkt:${snapshot.a2f_packet_fps.toFixed(1)}/s tc:${snapshot.a2f_timecode_fps || "-"}fps ws:${snapshot.ws_state}`,
    `A2F out:${snapshot.a2f_audio_send_fps.toFixed(1)}/s drop:${snapshot.a2f_audio_drop_fps.toFixed(1)}/s close:${snapshot.a2f_socket_close_count} code:${snapshot.a2f_last_close_code || "-"}`,
    `avatar a2f:${snapshot.avatar_a2f_fps.toFixed(1)}fps fallback:${snapshot.avatar_fallback_fps.toFixed(1)}fps lost:${snapshot.fallback_pct.toFixed(0)}% source:${snapshot.lipsync_source}`,
    `fallback:${fallbackState} enters:${snapshot.fallback_enter_count} stale:${snapshot.stale_ms}ms ${snapshot.stale_state} buf:${snapshot.a2f_buffer_ahead_ms || "-"}ms`,
    `gaps>${AUDIO2FACE_GAP_WARN_MS}ms:${snapshot.gap_count} max:${snapshot.max_gap_ms}ms mic cap:${snapshot.mic_capture_fps.toFixed(1)}/s send:${snapshot.mic_send_fps.toFixed(1)}/s`,
    `blend active:${snapshot.blend_active_count}/68 energy:${snapshot.blend_energy.toFixed(3)} max:${snapshot.blend_max_weight.toFixed(2)} gains boca:${snapshot.mouth_gain} cara:${snapshot.lower_face_gain} cabeza:${snapshot.head_motion_gain}`,
    `samples:${state.metrics.samples.length}/${METRICS_MAX_SAMPLES}`,
  ].join("\n");
}

function chartSamples(currentSnapshot) {
  const samples = state.metrics.samples.slice(-METRICS_GRAPH_SAMPLES);
  const last = samples[samples.length - 1];
  if (!last || last.elapsed_ms !== currentSnapshot.elapsed_ms) {
    samples.push(currentSnapshot);
  }
  return samples.slice(-METRICS_GRAPH_SAMPLES);
}

function drawMetricsCharts(snapshot = buildMetricsSnapshot()) {
  const samples = chartSamples(snapshot);
  drawMetricChart(elements.fpsChartCanvas, samples, {
    unit: "fps",
    floorMax: 30,
    series: [
      { key: "a2f_rx_fps", label: "A2F", color: "#b451ff", fill: true },
      { key: "a2f_audio_send_fps", label: "out", color: "#38d996" },
      { key: "avatar_a2f_fps", label: "avatar", color: "#4bc3ff" },
      { key: "avatar_fallback_fps", label: "fallback", color: "#ffb347" },
    ],
  });
  drawMetricChart(elements.latencyChartCanvas, samples, {
    unit: "ms",
    floorMax: 1000,
    warnAt: AUDIO2FACE_STALE_MS,
    series: [
      { key: "stale_ms", label: "stale", color: "#ff5f7e", fill: true },
      { key: "last_gap_ms", label: "gap", color: "#ffd166" },
    ],
  });
  drawMetricChart(elements.blendChartCanvas, samples, {
    unit: "",
    floorMax: 1,
    fixedMax: 1,
    series: [
      { key: "blend_energy", label: "energia", color: "#38d996", fill: true },
      { key: "blend_max_weight", label: "max", color: "#e8f060" },
      { key: "mic_level", label: "mic", color: "#6aa8ff" },
    ],
  });
}

function drawMetricChart(canvas, samples, config) {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width || canvas.width || 320));
  const height = Math.max(1, Math.floor(rect.height || canvas.height || 92));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pixelWidth = Math.floor(width * dpr);
  const pixelHeight = Math.floor(height * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#151a20";
  ctx.fillRect(0, 0, width, height);

  const padLeft = 8;
  const padRight = 38;
  const padTop = 6;
  const padBottom = 10;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;
  const allValues = samples.flatMap((sample) => config.series.map((series) => Number(sample[series.key]) || 0));
  const maxValue = config.fixedMax || Math.max(config.floorMax || 1, ...allValues, 1);
  const yFor = (value) => padTop + plotHeight - (Math.max(0, Number(value) || 0) / maxValue) * plotHeight;
  const xFor = (index) => padLeft + (samples.length <= 1 ? plotWidth : (index / (samples.length - 1)) * plotWidth);

  ctx.strokeStyle = "#2b313a";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = padTop + (plotHeight / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(width - padRight, y);
    ctx.stroke();
  }
  for (let i = 0; i <= 5; i += 1) {
    const x = padLeft + (plotWidth / 5) * i;
    ctx.beginPath();
    ctx.moveTo(x, padTop);
    ctx.lineTo(x, height - padBottom);
    ctx.stroke();
  }

  if (config.warnAt) {
    const warnY = yFor(config.warnAt);
    if (warnY >= padTop && warnY <= height - padBottom) {
      ctx.strokeStyle = "rgba(255, 95, 126, 0.55)";
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(padLeft, warnY);
      ctx.lineTo(width - padRight, warnY);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  config.series.forEach((series) => {
    if (!samples.length) return;
    ctx.beginPath();
    samples.forEach((sample, index) => {
      const x = xFor(index);
      const y = yFor(sample[series.key]);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    if (series.fill) {
      const lastX = xFor(samples.length - 1);
      const firstX = xFor(0);
      const baseY = height - padBottom;
      ctx.lineTo(lastX, baseY);
      ctx.lineTo(firstX, baseY);
      ctx.closePath();
      const gradient = ctx.createLinearGradient(0, padTop, 0, baseY);
      gradient.addColorStop(0, `${series.color}88`);
      gradient.addColorStop(1, `${series.color}22`);
      ctx.fillStyle = gradient;
      ctx.fill();
    }

    ctx.beginPath();
    samples.forEach((sample, index) => {
      const x = xFor(index);
      const y = yFor(sample[series.key]);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = series.color;
    ctx.lineWidth = 1.6;
    ctx.stroke();
  });

  const latest = samples[samples.length - 1] || {};
  ctx.fillStyle = "#d8e4ef";
  ctx.font = "10px Consolas, Menlo, monospace";
  ctx.textAlign = "right";
  ctx.fillText(`${maxValue.toFixed(maxValue <= 1 ? 1 : 0)}${config.unit}`, width - 5, padTop + 9);
  ctx.fillStyle = "#9eadbd";
  ctx.fillText("0", width - 5, height - padBottom);

  ctx.textAlign = "left";
  let legendX = padLeft;
  config.series.forEach((series) => {
    const value = Number(latest[series.key]) || 0;
    const text = `${series.label}:${value.toFixed(config.fixedMax ? 2 : 1)}`;
    ctx.fillStyle = series.color;
    ctx.fillRect(legendX, height - 8, 5, 5);
    ctx.fillStyle = "#cbd6e2";
    ctx.fillText(text, legendX + 8, height - 3);
    legendX += ctx.measureText(text).width + 18;
  });
}

function updateMetricsButtons() {
  const hasSamples = state.metrics.samples.length > 0;
  if (elements.downloadMetricsCsvButton) elements.downloadMetricsCsvButton.disabled = !hasSamples;
  if (elements.downloadMetricsJsonButton) elements.downloadMetricsJsonButton.disabled = !hasSamples;
  if (elements.clearMetricsButton) elements.clearMetricsButton.disabled = !hasSamples;
  window.__avatarA2FMetrics = state.metrics.samples;
}

function metricsFilename(extension) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `avatar-a2f-metrics-${stamp}.${extension}`;
}

function csvValue(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function metricsToCsv(samples) {
  const lines = [METRICS_COLUMNS.join(",")];
  samples.forEach((sample) => {
    lines.push(METRICS_COLUMNS.map((column) => csvValue(sample[column])).join(","));
  });
  return `${lines.join("\n")}\n`;
}

function downloadTextFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadMetricsCsv() {
  if (!state.metrics.samples.length) return;
  downloadTextFile(metricsFilename("csv"), metricsToCsv(state.metrics.samples), "text/csv;charset=utf-8");
}

function downloadMetricsJson() {
  if (!state.metrics.samples.length) return;
  const payload = {
    exportedAt: new Date().toISOString(),
    sampleIntervalMs: METRICS_SAMPLE_INTERVAL_MS,
    rollingWindowMs: METRICS_WINDOW_MS,
    audio2FaceUrl: AUDIO2FACE_URL,
    avatarPreset: state.avatarPreset,
    avatarUrl: state.avatarUrl,
    renderQuality: state.renderQuality,
    samples: state.metrics.samples,
  };
  downloadTextFile(metricsFilename("json"), `${JSON.stringify(payload, null, 2)}\n`, "application/json;charset=utf-8");
}

function currentRenderQuality() {
  return RENDER_QUALITY_PRESETS[state.renderQuality] || RENDER_QUALITY_PRESETS.balanced;
}

function initThree() {
  const quality = currentRenderQuality();
  state.scene = new THREE.Scene();
  state.scene.background = new THREE.Color(0xf1f6fb);

  state.camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
  state.renderer = new THREE.WebGLRenderer({
    antialias: quality.antialias,
    powerPreference: "high-performance",
  });
  state.renderer.outputColorSpace = THREE.SRGBColorSpace;
  state.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  state.renderer.toneMappingExposure = quality.shadows ? 1.08 : 1.03;
  state.renderer.shadowMap.enabled = quality.shadows;
  if (quality.shadows) {
    state.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }
  state.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.maxPixelRatio));
  elements.stage.appendChild(state.renderer.domElement);

  state.controls = new OrbitControls(state.camera, state.renderer.domElement);
  state.controls.enableDamping = false;
  state.controls.enablePan = false;

  state.scene.add(new THREE.HemisphereLight(0xffffff, 0x6f7f91, 1.55));
  const fill = new THREE.DirectionalLight(0x9ec5ff, quality.fillIntensity);
  fill.position.set(-3.5, 2.2, 3.5);
  state.scene.add(fill);

  const key = new THREE.DirectionalLight(0xffffff, quality.keyIntensity);
  key.position.set(2.5, 4, 3);
  key.castShadow = quality.shadows;
  if (quality.shadows) key.shadow.mapSize.set(1024, 1024);
  state.scene.add(key);

  const rim = new THREE.DirectionalLight(0xffffff, quality.rimIntensity);
  rim.position.set(-2.5, 3.4, -3.2);
  state.scene.add(rim);

  window.addEventListener("resize", resize);
  resize();
  startRenderLoop();
}

function resize() {
  if (!state.renderer || !state.camera) return;
  const rect = elements.stage.getBoundingClientRect();
  state.renderer.setSize(rect.width, rect.height, false);
  state.camera.aspect = rect.width / Math.max(1, rect.height);
  state.camera.updateProjectionMatrix();
}

function startRenderLoop() {
  if (state.animationFrame || state.avatarPaused) return;
  state.animationFrame = requestAnimationFrame(animate);
}

function stopRenderLoop() {
  if (!state.animationFrame) return;
  cancelAnimationFrame(state.animationFrame);
  state.animationFrame = 0;
}

function animate() {
  state.animationFrame = 0;
  if (state.avatarPaused) return;
  state.animationFrame = requestAnimationFrame(animate);
  const now = performance.now();
  if (now - state.lastRenderAt < 1000 / RENDER_FPS) return;
  state.lastRenderAt = now;
  if (state.controls?.enableDamping) state.controls.update();
  updateMouthFromAudio();
  updateListeningIdle();
  updateHeadMotion();
  updateNaturalBlink(now);
  if (state.renderer && state.scene && state.camera) {
    state.renderer.render(state.scene, state.camera);
  }
}

async function loadAvatar() {
  const label = AVATAR_LABELS[state.avatarPreset] || "Avatar";
  setStatus(`Cargando ${label}`);
  state.morphMap = await fetch(MORPH_MAP_URL).then((response) => response.json());
  const gltf = await new GLTFLoader().loadAsync(state.avatarUrl, (event) => {
    if (!event.lengthComputable || !event.total) return;
    const percent = Math.round((event.loaded / event.total) * 100);
    setStatus(`Cargando ${label} ${percent}%`);
  });
  state.avatarRoot = gltf.scene;
  normalizeAvatarScene(state.avatarRoot);
  applyRelaxedArmPose(state.avatarRoot);
  state.scene.add(state.avatarRoot);
  collectMorphMeshes(state.avatarRoot);
  frameAvatar(state.avatarRoot);
  startIdleBlink();
  setStatus(`${label} listo (${state.morphMeshes.length} meshes con morphs)`, "ready");
}

function normalizedName(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeAvatarScene(root) {
  const hiddenParts = ["eyeocclusion", "tearline", "sphere01", "default"];
  root.traverse((node) => {
    if (!node.isMesh && !node.isSkinnedMesh) return;
    const nodeName = normalizedName(node.name);
    if (hiddenParts.some((part) => nodeName.includes(part))) {
      node.visible = false;
      stripMorphTargets(node);
      return;
    }

    optimizeAttachmentMorphTargets(node, nodeName);
    node.castShadow = currentRenderQuality().shadows;
    node.receiveShadow = currentRenderQuality().shadows;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    const nextMaterials = materials.map((material) => normalizeMaterial(material, node));
    node.material = Array.isArray(node.material) ? nextMaterials : nextMaterials[0];
  });
}

function findNamedObject(root, name) {
  const direct = root.getObjectByName(name);
  if (direct) return direct;
  const normalizedTarget = normalizedName(name);
  let found = null;
  root.traverse((node) => {
    if (!found && normalizedName(node.name) === normalizedTarget) {
      found = node;
    }
  });
  return found;
}

function setBoneDirectionWorld(root, boneName, childName, targetDirection) {
  const bone = findNamedObject(root, boneName);
  const child = findNamedObject(root, childName);
  if (!bone || !child || !bone.parent) return false;

  root.updateMatrixWorld(true);
  const origin = new THREE.Vector3();
  const childPosition = new THREE.Vector3();
  bone.getWorldPosition(origin);
  child.getWorldPosition(childPosition);

  const currentDirection = childPosition.sub(origin);
  if (currentDirection.lengthSq() < 0.000001) return false;
  currentDirection.normalize();

  const target = new THREE.Vector3(...targetDirection).normalize();
  const delta = new THREE.Quaternion().setFromUnitVectors(currentDirection, target);
  const worldRotation = bone.getWorldQuaternion(new THREE.Quaternion());
  const nextWorldRotation = delta.multiply(worldRotation);
  const parentWorldRotation = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  bone.quaternion.copy(parentWorldRotation.multiply(nextWorldRotation));
  bone.updateMatrixWorld(true);
  return true;
}

function applyRelaxedArmPose(root) {
  if (!RELAXED_ARM_POSE) return;
  const applied = [
    setBoneDirectionWorld(root, "CC_Base_L_Upperarm", "CC_Base_L_Forearm", [0.18, -0.96, 0.08]),
    setBoneDirectionWorld(root, "CC_Base_R_Upperarm", "CC_Base_R_Forearm", [-0.18, -0.96, 0.08]),
    setBoneDirectionWorld(root, "CC_Base_L_Forearm", "CC_Base_L_Hand", [0.08, -0.96, 0.24]),
    setBoneDirectionWorld(root, "CC_Base_R_Forearm", "CC_Base_R_Hand", [-0.08, -0.96, 0.24]),
  ].some(Boolean);
  if (applied) {
    root.updateMatrixWorld(true);
  }
}

function stripMorphTargets(node) {
  if (!node.geometry?.morphAttributes) return;
  node.geometry.morphAttributes = {};
  node.morphTargetDictionary = undefined;
  node.morphTargetInfluences = undefined;
}

function filterMorphTargets(node, keepNames) {
  if (!node.morphTargetDictionary || !node.geometry?.morphAttributes) return;
  const orderedNames = Object.entries(node.morphTargetDictionary)
    .sort((a, b) => a[1] - b[1])
    .map(([name]) => name);
  const keepIndexes = orderedNames
    .map((name, index) => ({ name, index }))
    .filter(({ name }) => keepNames.has(name));

  if (!keepIndexes.length) {
    stripMorphTargets(node);
    return;
  }

  const nextAttributes = {};
  Object.entries(node.geometry.morphAttributes).forEach(([key, attributes]) => {
    nextAttributes[key] = keepIndexes
      .map(({ index }) => attributes[index])
      .filter(Boolean);
  });
  node.geometry.morphAttributes = nextAttributes;
  node.morphTargetDictionary = Object.fromEntries(keepIndexes.map(({ name }, index) => [name, index]));
  node.morphTargetInfluences = new Array(keepIndexes.length).fill(0);
}

function optimizeAttachmentMorphTargets(node, nodeName) {
  if (!node.morphTargetDictionary) return;
  if (nodeName.includes("ccbasebody")) return;
  if (nodeName.includes("classicslickback")) {
    filterMorphTargets(node, HEAD_MORPH_SET);
    return;
  }
  if (nodeName.includes("brows")) {
    filterMorphTargets(node, BROW_ATTACHMENT_MORPHS);
    return;
  }
  if (nodeName.includes("eyelash")) {
    filterMorphTargets(node, EYE_ATTACHMENT_MORPHS);
    return;
  }
  if (nodeName.includes("stubble")) {
    filterMorphTargets(node, FACE_ATTACHMENT_MORPHS);
    return;
  }
  if (nodeName.includes("shirt") || nodeName.includes("trousers") || nodeName.includes("sneakers")) {
    stripMorphTargets(node);
    return;
  }
  filterMorphTargets(node, HEAD_MORPH_SET);
}

function tuneMaterialTextures(material) {
  if (!material) return;
  ["map", "emissiveMap"].forEach((key) => {
    if (material[key]) material[key].colorSpace = THREE.SRGBColorSpace;
  });
}

function normalizeMaterial(material, node) {
  const name = String(material?.name || "");
  const lower = name.toLowerCase();
  const nodeName = normalizedName(node.name);
  const morphTargets = Boolean(node.morphTargetDictionary);
  const skinning = Boolean(node.isSkinnedMesh);
  tuneMaterialTextures(material);

  if (lower.includes("cornea")) {
    return new THREE.MeshStandardMaterial({
      name: `${name || "cornea"}__demo_safe`,
      color: 0xeaf6ff,
      roughness: 0.02,
      transparent: true,
      opacity: 0.045,
      side: THREE.DoubleSide,
      depthWrite: false,
      skinning,
      morphTargets,
      morphNormals: true,
    });
  }

  if (lower.includes("std_eye") || lower.includes("eye_r") || lower.includes("eye_l")) {
    const replacement = material.clone();
    replacement.roughness = Math.min(material.roughness ?? 0.42, 0.28);
    replacement.metalness = material.metalness ?? 0;
    replacement.envMapIntensity = 0.25;
    replacement.needsUpdate = true;
    return replacement;
  }

  if (lower.includes("hair") || nodeName.includes("classicslickback") || nodeName.includes("brows") || nodeName.includes("stubble")) {
    const replacement = material.clone();
    const isScalpHair = nodeName.includes("classicslickback");
    const isHairCap = isScalpHair && (lower.includes("hair_clap") || lower.includes("haircap") || lower.includes("hair_cap"));
    replacement.name = `${name || node.name || "hair"}__demo_lit`;
    replacement.opacity = isHairCap ? clampRange(DEFAULT_HAIR_CAP_OPACITY, 0.25, 0.95) : material?.opacity ?? 1;
    replacement.alphaTest = isHairCap
      ? clampRange(DEFAULT_HAIR_CAP_ALPHA_TEST, 0.08, 0.5)
      : clampRange(DEFAULT_HAIR_ALPHA_TEST, 0.04, 0.38);
    replacement.transparent = isHairCap || !isScalpHair;
    replacement.depthWrite = isScalpHair && !isHairCap;
    replacement.depthTest = true;
    replacement.side = THREE.DoubleSide;
    if ("alphaHash" in replacement) replacement.alphaHash = false;
    if ("alphaToCoverage" in replacement) replacement.alphaToCoverage = false;
    if ("forceSinglePass" in replacement) replacement.forceSinglePass = isScalpHair && !isHairCap;
    if (isHairCap && replacement.color) {
      replacement.color.multiplyScalar(0.86);
    } else if (isScalpHair && replacement.color) {
      replacement.color.multiplyScalar(0.58);
    }
    replacement.roughness = Math.max(material.roughness ?? 0.62, 0.62);
    replacement.metalness = Math.min(material.metalness ?? 0.02, 0.04);
    replacement.envMapIntensity = isHairCap ? 0.12 : isScalpHair ? 0.08 : 0.14;
    replacement.skinning = skinning;
    replacement.morphTargets = morphTargets;
    replacement.morphNormals = true;
    replacement.needsUpdate = true;
    return replacement;
  }

  if (lower.includes("eyelash")) {
    const replacement = new THREE.MeshStandardMaterial({
      name: `${name || "transparent"}__demo_safe`,
      color: material?.color ? material.color.clone() : new THREE.Color(0xffffff),
      map: material?.map || null,
      roughness: 0.76,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
      alphaTest: 0.35,
      skinning,
      morphTargets,
      morphNormals: true,
    });
    return replacement;
  }

  if (lower.includes("skin")) {
    const replacement = material.clone();
    replacement.roughness = Math.min(material.roughness ?? 0.72, 0.62);
    replacement.metalness = material.metalness ?? 0.0;
    replacement.envMapIntensity = 0.45;
    replacement.needsUpdate = true;
    return replacement;
  }

  return material;
}

function collectMorphMeshes(root) {
  state.morphMeshes = [];
  state.morphTargetsByName = new Map();
  state.morphValues = new Map();
  root.traverse((node) => {
    if ((node.isMesh || node.isSkinnedMesh) && node.morphTargetDictionary && node.morphTargetInfluences) {
      state.morphMeshes.push(node);
      Object.entries(node.morphTargetDictionary).forEach(([name, index]) => {
        if (!state.morphTargetsByName.has(name)) {
          state.morphTargetsByName.set(name, []);
        }
        state.morphTargetsByName.get(name).push({ mesh: node, index });
      });
    }
  });
}

function cameraFramingForPreset() {
  const framing = CAMERA_FRAMING_PRESETS[state.avatarPreset] || CAMERA_FRAMING_PRESETS.clothed;
  return {
    ...framing,
    targetRatio: Number(PARAMS.get("cameraTargetRatio") || PARAMS.get("targetRatio") || framing.targetRatio),
    distanceRatio: Number(PARAMS.get("cameraDistanceRatio") || PARAMS.get("distanceRatio") || framing.distanceRatio),
  };
}

function getWorldPoint(root, name) {
  const object = root.getObjectByName(name);
  if (!object) return null;
  return object.getWorldPosition(new THREE.Vector3());
}

function findFaceTarget(root) {
  root.updateMatrixWorld(true);
  const leftEye = getWorldPoint(root, "CC_Base_L_Eye");
  const rightEye = getWorldPoint(root, "CC_Base_R_Eye");
  if (leftEye && rightEye) {
    return leftEye.add(rightEye).multiplyScalar(0.5);
  }

  const head = getWorldPoint(root, "CC_Base_Head");
  if (!head) return null;
  head.y += 0.08;
  return head;
}

function frameAvatar(root) {
  root.updateMatrixWorld(true);
  const framing = cameraFramingForPreset();
  const body = root.getObjectByName("CC_Base_Body") || root;
  const box = new THREE.Box3().setFromObject(body);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const bodyTarget = new THREE.Vector3(center.x, box.min.y + size.y * framing.targetRatio, center.z);
  const faceTarget = findFaceTarget(root);
  const target = bodyTarget.clone();
  if (faceTarget) {
    target.x = THREE.MathUtils.lerp(bodyTarget.x, faceTarget.x, 0.85);
    target.y = THREE.MathUtils.lerp(bodyTarget.y, faceTarget.y, framing.faceWeight);
    target.z = THREE.MathUtils.lerp(bodyTarget.z, faceTarget.z, 0.5);
  }

  const distance = Math.max(size.x * 1.15, size.y * framing.distanceRatio, size.z * 1.55);
  state.controls.target.copy(target);
  state.camera.position.set(target.x, target.y + size.y * framing.cameraYOffsetRatio, target.z + distance);
  state.camera.near = Math.max(0.01, distance / 100);
  state.camera.far = Math.max(50, distance * 20);
  state.camera.updateProjectionMatrix();
  state.controls.update();
}

function setMorph(name, value) {
  if (!name) return;
  if (state.avatarPaused && Number(value) !== 0) return;
  const clamped = Math.max(0, Math.min(1, Number(value) || 0));
  const previous = state.morphValues.get(name) || 0;
  const epsilon = HEAD_MORPH_SET.has(name) ? HEAD_MORPH_EPSILON : MORPH_EPSILON;
  if (Math.abs(previous - clamped) < epsilon) return;
  state.morphValues.set(name, clamped);
  const targets = state.morphTargetsByName.get(name);
  if (!targets) return;
  targets.forEach(({ mesh, index }) => {
    mesh.morphTargetInfluences[index] = clamped;
  });
}

function setMouthLevel(level) {
  const value = gainValue(level, state.mouthGain);
  const lipSync = state.morphMap?.lipSync || {};
  setLipTargets({
    [lipSync.mouthOpen || "V_Open"]: value * 0.95,
    [lipSync.lipOpen || "V_Lip_Open"]: value * 0.45,
    [lipSync.tightO || "V_Tight_O"]: Math.max(0, value - 0.55) * 0.5,
  });
  applyLipTargets(0.42);
}

function setLipTargets(nextTargets = {}) {
  const lipSync = state.morphMap?.lipSync || {};
  [
    lipSync.silence || "V_None",
    lipSync.mouthOpen || "V_Open",
    lipSync.lipOpen || "V_Lip_Open",
    lipSync.tightO || "V_Tight_O",
    lipSync.tight || "V_Tight",
    lipSync.wide || "V_Wide",
    lipSync.dentalLip || "V_Dental_Lip",
    lipSync.affricate || "V_Affricate",
    lipSync.explosive || "V_Explosive",
    lipSync.tongueUp || "V_Tongue_up",
    lipSync.tongueOut || "V_Tongue_Out",
  ].forEach((name) => {
    state.lipTargets[name] = clamp01(nextTargets[name] || 0);
  });
}

function applyLipTargets(speed = 0.28) {
  Object.entries(state.lipTargets).forEach(([name, target]) => {
    const current = state.lipCurrent[name] || 0;
    const next = current + (target - current) * speed;
    state.lipCurrent[name] = Math.abs(next) < 0.01 ? 0 : next;
    setMorph(name, state.lipCurrent[name]);
  });
}

function clearExpressionTimeouts() {
  state.expressionTimeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
  state.expressionTimeouts = [];
}

function resetSemanticExpression() {
  const expressions = state.morphMap?.expressions || {};
  [
    expressions.smileLeft || "Mouth_Corner_Pull_L",
    expressions.smileRight || "Mouth_Corner_Pull_R",
    expressions.browRaiseOuterLeft || "Brow_Raise_Outer_L",
    expressions.browRaiseOuterRight || "Brow_Raise_Outer_R",
    expressions.browDownLeft || "Brow_Down_L",
    expressions.browDownRight || "Brow_Down_R",
    expressions.eyeWideLeft || "Eye_Widen_L",
    expressions.eyeWideRight || "Eye_Widen_R",
    "Eye_Cheek_Raise_L",
    "Eye_Cheek_Raise_R",
  ].forEach((morphName) => setMorph(morphName, 0));
  state.semanticHead = { nod: 0, turn: 0, tilt: 0, until: 0 };
  state.expressionActiveUntil = 0;
}

function resetListeningIdle() {
  resetHeadMorphs();
}

function resetHeadMorphs() {
  state.headCurrent = { nod: 0, turn: 0, tilt: 0, forward: 0 };
  HEAD_MORPHS.forEach((morphName) => setMorph(morphName, 0));
}

function applySignedHeadPair(positiveName, negativeName, value) {
  const signed = signedClamp(value);
  setMorph(positiveName, signed > 0 ? signed : 0);
  setMorph(negativeName, signed < 0 ? Math.abs(signed) : 0);
}

function setHeadPose(pose = {}, speed = 0.16) {
  const smooth = clampRange(speed, 0.02, 1);
  ["nod", "turn", "tilt", "forward"].forEach((key) => {
    const current = state.headCurrent[key] || 0;
    const target = signedClamp(pose[key] || 0);
    state.headCurrent[key] = current + (target - current) * smooth;
  });

  applySignedHeadPair("Head_Turn_Down", "Head_Turn_Up", state.headCurrent.nod);
  applySignedHeadPair("Head_Turn_R", "Head_Turn_L", state.headCurrent.turn);
  applySignedHeadPair("Head_Tilt_R", "Head_Tilt_L", state.headCurrent.tilt);
  applySignedHeadPair("Head_Forward", "Head_Backward", state.headCurrent.forward);
}

function playbackAudioLevel() {
  if (!state.playbackAnalyser || state.playbackSources.size === 0) return 0;
  if (!state.headAudioTimeData || state.headAudioTimeData.length !== 128) {
    state.headAudioTimeData = new Uint8Array(128);
  }
  state.playbackAnalyser.getByteTimeDomainData(state.headAudioTimeData);
  let sum = 0;
  for (let i = 0; i < state.headAudioTimeData.length; i += 1) {
    const centered = (state.headAudioTimeData[i] - 128) / 128;
    sum += centered * centered;
  }
  const rms = Math.sqrt(sum / state.headAudioTimeData.length);
  return clamp01((rms - 0.01) * 14);
}

function updateHeadMotion() {
  if (state.avatarPaused) return;
  const t = (performance.now() - state.idleStartAt) / 1000;
  const gain = state.headMotionGain;
  const rawLevel = state.directAudio2Face && state.micStream ? state.micLastLevel : playbackAudioLevel();
  state.headMotionLevel += (rawLevel - state.headMotionLevel) * 0.08;
  const speaking = state.playbackSources.size > 0 || (state.directAudio2Face && state.micStream && state.headMotionLevel > 0.015);
  const semanticActive = Date.now() < state.semanticHead.until;

  let nod = semanticActive ? state.semanticHead.nod : 0;
  let turn = semanticActive ? state.semanticHead.turn : 0;
  let tilt = semanticActive ? state.semanticHead.tilt : 0;
  let forward = 0;

  if (speaking) {
    const level = state.headMotionLevel;
    nod += (level * 0.04 + Math.sin(t * 2.4) * level * 0.012) * gain;
    turn += Math.sin(t * 0.72 + 0.7) * 0.028 * gain;
    tilt += Math.sin(t * 0.48 + 1.3) * 0.026 * gain;
    forward += (0.014 + level * 0.04 + Math.sin(t * 1.9) * level * 0.008) * gain;
    setHeadPose({ nod, turn, tilt, forward }, 0.11);
    return;
  }

  const idleGain = gain * 0.72;
  const breathe = (Math.sin(t * 1.25) + 1) * 0.5;
  turn += Math.sin(t * 0.55) * 0.045 * idleGain;
  tilt += Math.sin(t * 0.31 + 1.6) * 0.04 * idleGain;
  forward += (0.015 + breathe * 0.025) * idleGain;
  setHeadPose({ nod, turn, tilt, forward }, semanticActive ? 0.08 : 0.055);
}

function updateListeningIdle() {
  if (state.avatarPaused || state.playbackSources.size > 0 || hasFreshAudio2FaceBlendShapes() || Date.now() < state.expressionActiveUntil) {
    return;
  }

  const expressions = state.morphMap?.expressions || {};
  const t = (performance.now() - state.idleStartAt) / 1000;
  const breathe = (Math.sin(t * 1.25) + 1) * 0.5;

  setMorph(expressions.browRaiseOuterLeft || "Brow_Raise_Outer_L", 0.035 + breathe * 0.025);
  setMorph(expressions.browRaiseOuterRight || "Brow_Raise_Outer_R", 0.035 + breathe * 0.025);
  setMorph(expressions.eyeWideLeft || "Eye_Widen_L", 0.025 + breathe * 0.018);
  setMorph(expressions.eyeWideRight || "Eye_Widen_R", 0.025 + breathe * 0.018);
  setMorph(expressions.smileLeft || "Mouth_Corner_Pull_L", 0.025 + breathe * 0.018);
  setMorph(expressions.smileRight || "Mouth_Corner_Pull_R", 0.025 + breathe * 0.018);
  setMorph("Eye_Cheek_Raise_L", 0.015 + breathe * 0.015);
  setMorph("Eye_Cheek_Raise_R", 0.015 + breathe * 0.015);
}

function applyGesturePlan(plan) {
  if (!plan || typeof plan !== "object") return;
  if (state.avatarPaused) return;

  clearExpressionTimeouts();
  resetSemanticExpression();

  const expressions = state.morphMap?.expressions || {};
  const intensity = clamp01(plan.intensity ?? 0.55);
  const durationMs = Math.max(800, Math.min(4500, Number(plan.durationMs) || 2200));
  state.expressionActiveUntil = Date.now() + durationMs;

  const smile = clamp01(plan.smile) * intensity;
  setMorph(expressions.smileLeft || "Mouth_Corner_Pull_L", smile);
  setMorph(expressions.smileRight || "Mouth_Corner_Pull_R", smile);

  const browRaise = clamp01(plan.browRaise) * intensity;
  setMorph(expressions.browRaiseOuterLeft || "Brow_Raise_Outer_L", browRaise);
  setMorph(expressions.browRaiseOuterRight || "Brow_Raise_Outer_R", browRaise);

  const browDown = clamp01(plan.browDown) * intensity;
  setMorph(expressions.browDownLeft || "Brow_Down_L", browDown);
  setMorph(expressions.browDownRight || "Brow_Down_R", browDown);

  const eyeWide = clamp01(plan.eyeWide) * intensity;
  setMorph(expressions.eyeWideLeft || "Eye_Widen_L", eyeWide);
  setMorph(expressions.eyeWideRight || "Eye_Widen_R", eyeWide);

  const cheekRaise = clamp01(plan.cheekRaise) * intensity;
  setMorph("Eye_Cheek_Raise_L", cheekRaise);
  setMorph("Eye_Cheek_Raise_R", cheekRaise);

  const headNod = signedClamp(plan.headNod) * intensity;
  const headTurn = signedClamp(plan.headTurn) * intensity;
  const headTilt = signedClamp(plan.headTilt) * intensity;
  state.semanticHead = {
    nod: headNod,
    turn: headTurn,
    tilt: headTilt,
    until: Date.now() + durationMs,
  };
  updateHeadMotion();

  state.expressionTimeouts.push(window.setTimeout(() => {
    resetSemanticExpression();
    resetListeningIdle();
  }, durationMs));
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function clampRange(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function gainValue(value, gain) {
  return clamp01((Number(value) || 0) * gain);
}

function signedClamp(value) {
  return Math.max(-1, Math.min(1, Number(value) || 0));
}

function clearBlinkTimers() {
  window.clearTimeout(state.blinkTimer);
  state.blinkTimer = 0;
  state.blinkSequenceTimeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
  state.blinkSequenceTimeouts = [];
  state.blink = null;
  state.naturalBlinkLeft = 0;
  state.naturalBlinkRight = 0;
  const expressions = state.morphMap?.expressions || {};
  setMorph(expressions.blinkLeft || "Eye_Blink_L", 0);
  setMorph(expressions.blinkRight || "Eye_Blink_R", 0);
}

function blinkCurve(progress) {
  const p = clamp01(progress);
  if (p <= 0 || p >= 1) return 0;
  if (p < 0.34) {
    const close = p / 0.34;
    return 1 - Math.pow(1 - close, 3);
  }
  const open = (p - 0.34) / 0.66;
  return Math.pow(1 - open, 1.55);
}

function triggerNaturalBlink(options = {}) {
  if (state.avatarPaused) return;
  const baseMax = options.max ?? (0.82 + Math.random() * 0.17);
  state.blink = {
    startedAt: performance.now(),
    durationMs: options.durationMs ?? (165 + Math.random() * 80),
    leftDelayMs: options.leftDelayMs ?? Math.random() * 14,
    rightDelayMs: options.rightDelayMs ?? Math.random() * 14,
    leftMax: clampRange(options.leftMax ?? baseMax, 0.68, 1),
    rightMax: clampRange(options.rightMax ?? (baseMax + (Math.random() - 0.5) * 0.08), 0.68, 1),
    doublePending: !options.skipDouble && Math.random() < 0.14,
  };
}

function queueNaturalBlink(delayMs) {
  window.clearTimeout(state.blinkTimer);
  state.blinkTimer = window.setTimeout(() => {
    triggerNaturalBlink();
    const speaking = state.playbackSources.size > 0 || state.directAudio2Face;
    queueNaturalBlink(speaking ? 1400 + Math.random() * 2600 : 2400 + Math.random() * 5200);
  }, delayMs);
}

function startIdleBlink() {
  clearBlinkTimers();
  queueNaturalBlink(900 + Math.random() * 1800);
}

function updateNaturalBlink(now = performance.now()) {
  if (state.avatarPaused || !state.blink) return;
  const expressions = state.morphMap?.expressions || {};
  const leftName = expressions.blinkLeft || "Eye_Blink_L";
  const rightName = expressions.blinkRight || "Eye_Blink_R";
  const blink = state.blink;
  const leftProgress = (now - blink.startedAt - blink.leftDelayMs) / blink.durationMs;
  const rightProgress = (now - blink.startedAt - blink.rightDelayMs) / blink.durationMs;
  state.naturalBlinkLeft = blinkCurve(leftProgress) * blink.leftMax;
  state.naturalBlinkRight = blinkCurve(rightProgress) * blink.rightMax;
  const a2fLeft = state.lipSyncSource === "audio2face" ? state.a2fBlinkLeft : 0;
  const a2fRight = state.lipSyncSource === "audio2face" ? state.a2fBlinkRight : 0;
  setMorph(leftName, Math.max(a2fLeft, state.naturalBlinkLeft));
  setMorph(rightName, Math.max(a2fRight, state.naturalBlinkRight));

  if (leftProgress < 1 || rightProgress < 1) return;

  const shouldDoubleBlink = blink.doublePending;
  state.blink = null;
  state.naturalBlinkLeft = 0;
  state.naturalBlinkRight = 0;
  setMorph(leftName, a2fLeft);
  setMorph(rightName, a2fRight);

  if (shouldDoubleBlink) {
    const timeoutId = window.setTimeout(() => {
      state.blinkSequenceTimeouts = state.blinkSequenceTimeouts.filter((id) => id !== timeoutId);
      triggerNaturalBlink({
        durationMs: 125 + Math.random() * 55,
        max: 0.72 + Math.random() * 0.18,
        skipDouble: true,
      });
    }, 85 + Math.random() * 130);
    state.blinkSequenceTimeouts.push(timeoutId);
  }
}

function updateMouthFromAudio() {
  if (state.avatarPaused) {
    setLipSyncSource("paused");
    return;
  }
  const audio2FaceBlendShapes = getScheduledAudio2FaceBlendShapes();
  if (audio2FaceBlendShapes) {
    setLipSyncSource("audio2face");
    markMetric(state.metrics.a2fApply);
    applyAudio2FaceBlendShapes(audio2FaceBlendShapes);
    return;
  }

  if (state.directAudio2Face && state.micStream) {
    setLipSyncSource("fallback", "direct_mic_no_a2f");
    markMetric(state.metrics.localFallback);
    setMouthLevel(state.micLastLevel);
    return;
  }

  if (hasFreshOvrVisemes()) {
    setLipSyncSource("ovr");
    applyOvrVisemes();
    return;
  }

  if (!state.playbackAnalyser || state.playbackSources.size === 0) {
    setLipSyncSource("idle");
    setLipTargets({});
    applyLipTargets(0.35);
    return;
  }

  setLipSyncSource("fallback", "playback_no_a2f");
  markMetric(state.metrics.localFallback);
  const timeData = new Uint8Array(256);
  const freqData = new Uint8Array(state.playbackAnalyser.frequencyBinCount);
  state.playbackAnalyser.getByteTimeDomainData(timeData);
  state.playbackAnalyser.getByteFrequencyData(freqData);

  let sum = 0;
  let crossings = 0;
  let previous = 0;
  for (let i = 0; i < timeData.length; i += 1) {
    const centered = (timeData[i] - 128) / 128;
    sum += centered * centered;
    if (i > 0 && Math.sign(centered) !== Math.sign(previous)) crossings += 1;
    previous = centered;
  }

  const rms = Math.sqrt(sum / timeData.length);
  const volume = clamp01((rms - 0.012) * 12);
  const low = averageBand(freqData, 2, 10);
  const mid = averageBand(freqData, 11, 42);
  const high = averageBand(freqData, 43, 118);
  const noisy = clamp01((high * 1.25 - low * 0.45) * volume);
  const rounded = clamp01((low * 1.4 - high * 0.4) * volume);
  const wide = clamp01((mid * 0.85 + high * 0.45 - low * 0.28) * volume);
  const consonant = clamp01(((crossings / timeData.length) * 4.8 + high * 0.55) * volume);
  const open = clamp01(volume * (0.68 + low * 0.24 + mid * 0.2));
  const lipSync = state.morphMap?.lipSync || {};
  const mouthGain = state.mouthGain;

  setLipTargets({
    [lipSync.mouthOpen || "V_Open"]: gainValue(open, mouthGain),
    [lipSync.lipOpen || "V_Lip_Open"]: gainValue(open * 0.42, mouthGain),
    [lipSync.tightO || "V_Tight_O"]: gainValue(rounded * 0.72, mouthGain),
    [lipSync.tight || "V_Tight"]: gainValue(consonant * 0.22, mouthGain),
    [lipSync.wide || "V_Wide"]: gainValue(wide * 0.54, mouthGain),
    [lipSync.dentalLip || "V_Dental_Lip"]: gainValue(noisy * 0.36, mouthGain),
    [lipSync.affricate || "V_Affricate"]: gainValue(consonant * 0.32, mouthGain),
    [lipSync.explosive || "V_Explosive"]: gainValue(Math.max(0, consonant - open * 0.55) * 0.25, mouthGain),
  });
  applyLipTargets(0.31);
}

function averageBand(data, start, end) {
  const last = Math.min(data.length - 1, end);
  let sum = 0;
  let count = 0;
  for (let i = Math.max(0, start); i <= last; i += 1) {
    sum += data[i] / 255;
    count += 1;
  }
  return count ? sum / count : 0;
}

function hasFreshAudio2FaceBlendShapes() {
  return Boolean(getScheduledAudio2FaceBlendShapes());
}

function resetAudio2FacePlaybackSync() {
  state.audio2FaceFrameBuffer = [];
  state.audio2FacePlaybackStartAt = 0;
  state.audio2FaceSmoothedBlendShapes = {};
}

function queueAudio2FaceFrames(frames = []) {
  const nextFrames = frames
    .filter((frame) => frame?.blendShapes)
    .map((frame) => ({
      timeCode: Number(frame.timeCode) || 0,
      blendShapes: frame.blendShapes,
    }));
  if (!nextFrames.length) return;

  const lastFrame = state.audio2FaceFrameBuffer[state.audio2FaceFrameBuffer.length - 1];
  if (lastFrame && nextFrames[0].timeCode + 0.25 < lastFrame.timeCode) {
    state.audio2FaceFrameBuffer = [];
    state.audio2FaceSmoothedBlendShapes = {};
  }

  state.audio2FaceFrameBuffer.push(...nextFrames);
  if (state.audio2FaceFrameBuffer.length > 2400) {
    state.audio2FaceFrameBuffer.splice(0, state.audio2FaceFrameBuffer.length - 2400);
  }
}

function currentAudio2FacePlaybackTime() {
  if (!state.playbackContext || !state.audio2FacePlaybackStartAt) return null;
  return state.playbackContext.currentTime - state.audio2FacePlaybackStartAt + AUDIO2FACE_SYNC_OFFSET_MS / 1000;
}

function getScheduledAudio2FaceBlendShapes() {
  if (!state.audio2FaceReady) return null;

  if (state.directAudio2Face || !state.playbackContext || !state.audio2FacePlaybackStartAt) {
    return Date.now() - state.lastAudio2FaceAt < AUDIO2FACE_STALE_MS ? state.audio2FaceBlendShapes : null;
  }

  const playbackTime = currentAudio2FacePlaybackTime();
  if (!Number.isFinite(playbackTime)) return null;
  const frames = state.audio2FaceFrameBuffer;
  if (!frames.length) return null;

  while (frames.length > 2 && frames[1].timeCode < playbackTime - 1.0) {
    frames.shift();
  }

  if (playbackTime < frames[0].timeCode) {
    return frames[0].timeCode - playbackTime <= AUDIO2FACE_FRAME_HOLD_MS / 1000 ? frames[0].blendShapes : null;
  }

  for (let i = 0; i < frames.length - 1; i += 1) {
    const current = frames[i];
    const next = frames[i + 1];
    if (playbackTime >= current.timeCode && playbackTime <= next.timeCode) {
      return interpolateBlendShapes(current.blendShapes, next.blendShapes, (playbackTime - current.timeCode) / Math.max(0.001, next.timeCode - current.timeCode));
    }
  }

  const last = frames[frames.length - 1];
  return playbackTime - last.timeCode <= AUDIO2FACE_FRAME_HOLD_MS / 1000 ? last.blendShapes : null;
}

function interpolateBlendShapes(a = {}, b = {}, amount = 0) {
  const t = clamp01(amount);
  const out = {};
  const names = new Set([...Object.keys(a), ...Object.keys(b)]);
  names.forEach((name) => {
    out[name] = clamp01(a[name] || 0) + (clamp01(b[name] || 0) - clamp01(a[name] || 0)) * t;
  });
  return out;
}

function smoothAudio2FaceBlendShapes(next = {}) {
  const speed = clampRange(state.a2fSmoothing, 0.15, 0.8);
  const previous = state.audio2FaceSmoothedBlendShapes || {};
  const smoothed = {};
  const names = new Set([...Object.keys(previous), ...Object.keys(next)]);
  names.forEach((name) => {
    const current = clamp01(previous[name] || 0);
    const target = clamp01(next[name] || 0);
    const value = current + (target - current) * speed;
    if (value > 0.001 || target > 0.001) {
      smoothed[name] = value;
    }
  });
  state.audio2FaceSmoothedBlendShapes = smoothed;
  return smoothed;
}

function setA2FMorphPair(leftName, rightName, leftValue, rightValue = leftValue) {
  setMorph(leftName, clamp01(leftValue));
  setMorph(rightName, clamp01(rightValue));
}

function setA2FMorphQuad(upperLeft, upperRight, lowerLeft, lowerRight, upperValue, lowerValue = upperValue) {
  setMorph(upperLeft, clamp01(upperValue));
  setMorph(upperRight, clamp01(upperValue));
  setMorph(lowerLeft, clamp01(lowerValue));
  setMorph(lowerRight, clamp01(lowerValue));
}

function applyAudio2FaceBlendShapes(blendShapes = state.audio2FaceBlendShapes) {
  const bs = smoothAudio2FaceBlendShapes(blendShapes || {});
  const get = (name) => clamp01(bs[name] || 0);
  const maxOf = (...names) => Math.max(...names.map(get));
  const mouth = (value) => gainValue(value, state.mouthGain);
  const lower = (value) => gainValue(value, state.lowerFaceGain);
  const maxMouth = (...names) => mouth(maxOf(...names));
  const lipSync = state.morphMap?.lipSync || {};
  const expressions = state.morphMap?.expressions || {};
  const jawOpen = mouth(get("JawOpen"));
  const jawLeft = lower(get("JawLeft"));
  const jawRight = lower(get("JawRight"));
  const jawForward = lower(get("JawForward"));
  const mouthClose = mouth(get("MouthClose"));
  const mouthFunnel = mouth(get("MouthFunnel"));
  const mouthPucker = mouth(get("MouthPucker"));
  const mouthRollUpper = lower(get("MouthRollUpper"));
  const mouthRollLower = lower(get("MouthRollLower"));
  const mouthShrugUpper = lower(get("MouthShrugUpper"));
  const mouthShrugLower = lower(get("MouthShrugLower"));
  const mouthPress = maxMouth("MouthPressLeft", "MouthPressRight");
  const mouthFrownLeft = lower(get("MouthFrownLeft"));
  const mouthFrownRight = lower(get("MouthFrownRight"));
  const mouthSmileLeft = lower(get("MouthSmileLeft"));
  const mouthSmileRight = lower(get("MouthSmileRight"));
  const mouthDimpleLeft = lower(get("MouthDimpleLeft"));
  const mouthDimpleRight = lower(get("MouthDimpleRight"));
  const mouthStretchLeft = lower(get("MouthStretchLeft"));
  const mouthStretchRight = lower(get("MouthStretchRight"));
  const mouthLeft = lower(get("MouthLeft"));
  const mouthRight = lower(get("MouthRight"));
  const mouthLowerDownLeft = lower(get("MouthLowerDownLeft"));
  const mouthLowerDownRight = lower(get("MouthLowerDownRight"));
  const mouthUpperUpLeft = lower(get("MouthUpperUpLeft"));
  const mouthUpperUpRight = lower(get("MouthUpperUpRight"));
  const mouthPressLeft = mouth(get("MouthPressLeft"));
  const mouthPressRight = mouth(get("MouthPressRight"));
  const noseSneerLeft = lower(get("NoseSneerLeft"));
  const noseSneerRight = lower(get("NoseSneerRight"));
  const cheekPuff = lower(get("CheekPuff"));
  const eyeLookUp = maxOf("EyeLookUpLeft", "EyeLookUpRight");
  const eyeLookDown = maxOf("EyeLookDownLeft", "EyeLookDownRight");
  const eyeLookLeft = Math.max(get("EyeLookOutLeft"), get("EyeLookInRight"));
  const eyeLookRight = Math.max(get("EyeLookInLeft"), get("EyeLookOutRight"));
  const eyeLookSide = Math.max(eyeLookLeft, eyeLookRight);
  const tongueTipUp = maxOf("TongueTipUp", "TongueRollUp");
  const tongueTipDown = maxOf("TongueTipDown", "TongueRollDown");
  const tongueTipLeft = maxOf("TongueTipLeft", "TongueRollLeft");
  const tongueTipRight = maxOf("TongueTipRight", "TongueRollRight");
  const tongueOut = Math.max(get("TongueOut"), get("TongueStretch") * 0.72);
  const tongueUp = maxOf("TongueUp", "TongueTipUp", "TongueRollUp");
  const tongueDown = maxOf("TongueDown", "TongueTipDown", "TongueRollDown");
  const tongueLeft = maxOf("TongueLeft", "TongueTipLeft", "TongueRollLeft");
  const tongueRight = maxOf("TongueRight", "TongueTipRight", "TongueRollRight");
  const tongueNarrow = Math.max(get("TongueNarrow"), get("TongueIn") * 0.42);
  const tongueWide = Math.max(get("TongueWide"), get("TongueStretch") * 0.36);

  setLipTargets({
    [lipSync.silence || "V_None"]: mouthClose * 0.35,
    [lipSync.mouthOpen || "V_Open"]: jawOpen * 0.95,
    [lipSync.lipOpen || "V_Lip_Open"]: Math.max(jawOpen * 0.38, mouthClose * 0.12),
    [lipSync.tightO || "V_Tight_O"]: Math.max(mouthFunnel, mouthPucker) * 0.84,
    [lipSync.tight || "V_Tight"]: Math.max(mouthClose, mouthPress) * 0.52,
    [lipSync.wide || "V_Wide"]: Math.max(mouthStretchLeft, mouthStretchRight) * 0.78,
    [lipSync.dentalLip || "V_Dental_Lip"]: Math.max(mouthLowerDownLeft, mouthLowerDownRight) * 0.42,
    [lipSync.affricate || "V_Affricate"]: Math.max(mouthShrugUpper, mouthPress) * 0.46,
    [lipSync.explosive || "V_Explosive"]: mouthClose * 0.55,
    [lipSync.tongueOut || "V_Tongue_Out"]: tongueOut,
    [lipSync.tongueUp || "V_Tongue_up"]: Math.max(tongueUp, tongueTipUp) * 0.7,
  });
  applyLipTargets(0.62);

  setMorph("Jaw_Open", jawOpen);
  setMorph("Jaw_Open_Extreme", Math.max(0, jawOpen - 0.65) * 0.8);
  setMorph("Jaw_Left", jawLeft);
  setMorph("Jaw_Right", jawRight);
  setMorph("Jaw_Fwd", jawForward);
  setMorph("Jaw_Chin_Raise_DL", mouthClose * 0.25);
  setMorph("Jaw_Chin_Raise_DR", mouthClose * 0.25);
  setMorph("Jaw_Clench_L", mouthPress * 0.25);
  setMorph("Jaw_Clench_R", mouthPress * 0.25);

  state.a2fBlinkLeft = Math.max(get("EyeBlinkLeft"), eyeLookDown * 0.12);
  state.a2fBlinkRight = Math.max(get("EyeBlinkRight"), eyeLookDown * 0.12);
  setMorph(expressions.blinkLeft || "Eye_Blink_L", Math.max(state.a2fBlinkLeft, state.naturalBlinkLeft));
  setMorph(expressions.blinkRight || "Eye_Blink_R", Math.max(state.a2fBlinkRight, state.naturalBlinkRight));
  setMorph(expressions.eyeWideLeft || "Eye_Widen_L", Math.max(get("EyeWideLeft"), eyeLookUp * 0.16, eyeLookRight * 0.04));
  setMorph(expressions.eyeWideRight || "Eye_Widen_R", Math.max(get("EyeWideRight"), eyeLookUp * 0.16, eyeLookLeft * 0.04));
  setMorph("Eye_Squint_Inner_L", Math.max(get("EyeSquintLeft") * 0.85, eyeLookDown * 0.14, eyeLookLeft * 0.05));
  setMorph("Eye_Squint_Inner_R", Math.max(get("EyeSquintRight") * 0.85, eyeLookDown * 0.14, eyeLookRight * 0.05));
  setMorph("Eye_Squint_L", get("EyeSquintLeft") * 0.55);
  setMorph("Eye_Squint_R", get("EyeSquintRight") * 0.55);
  setMorph("Eye_Cheek_Raise_L", get("CheekSquintLeft") * 0.7);
  setMorph("Eye_Cheek_Raise_R", get("CheekSquintRight") * 0.7);

  setMorph(expressions.browDownLeft || "Brow_Down_L", get("BrowDownLeft"));
  setMorph(expressions.browDownRight || "Brow_Down_R", get("BrowDownRight"));
  setMorph("Brow_Raise_In_L", Math.max(get("BrowInnerUp"), eyeLookUp * 0.1));
  setMorph("Brow_Raise_In_R", Math.max(get("BrowInnerUp"), eyeLookUp * 0.1));
  setMorph(expressions.browRaiseOuterLeft || "Brow_Raise_Outer_L", Math.max(get("BrowOuterUpLeft"), eyeLookUp * 0.08, eyeLookSide * 0.03));
  setMorph(expressions.browRaiseOuterRight || "Brow_Raise_Outer_R", Math.max(get("BrowOuterUpRight"), eyeLookUp * 0.08, eyeLookSide * 0.03));

  setMorph(expressions.smileLeft || "Mouth_Corner_Pull_L", mouthSmileLeft);
  setMorph(expressions.smileRight || "Mouth_Corner_Pull_R", mouthSmileRight);
  setMorph("Mouth_Dimple_L", mouthDimpleLeft);
  setMorph("Mouth_Dimple_R", mouthDimpleRight);
  setMorph("Mouth_Stretch_L", mouthStretchLeft);
  setMorph("Mouth_Stretch_R", mouthStretchRight);
  setMorph("Mouth_Corner_Depress_L", mouthFrownLeft);
  setMorph("Mouth_Corner_Depress_R", mouthFrownRight);
  setMorph("Mouth_Left", mouthLeft);
  setMorph("Mouth_Right", mouthRight);
  setMorph("Mouth_LowerLip_Depress_L", mouthLowerDownLeft);
  setMorph("Mouth_LowerLip_Depress_R", mouthLowerDownRight);
  setMorph("Mouth_UpperLip_Raise_L", mouthUpperUpLeft);
  setMorph("Mouth_UpperLip_Raise_R", mouthUpperUpRight);
  setMorph("Mouth_Lips_Press_L", mouthPressLeft);
  setMorph("Mouth_Lips_Press_R", mouthPressRight);
  setMorph("Mouth_LowerLip_RollIn_L", mouthRollLower);
  setMorph("Mouth_LowerLip_RollIn_R", mouthRollLower);
  setMorph("Mouth_UpperLip_RollIn_L", mouthRollUpper);
  setMorph("Mouth_UpperLip_RollIn_R", mouthRollUpper);
  setMorph("Mouth_LowerLip_Towards_Teeth_L", mouthRollLower * 0.75);
  setMorph("Mouth_LowerLip_Towards_Teeth_R", mouthRollLower * 0.75);
  setMorph("Mouth_UpperLip_Towards_Teeth_L", mouthRollUpper * 0.75);
  setMorph("Mouth_UpperLip_Towards_Teeth_R", mouthRollUpper * 0.75);
  setMorph("Mouth_Lips_Tighten_UL", mouthClose * 0.35);
  setMorph("Mouth_Lips_Tighten_UR", mouthClose * 0.35);
  setMorph("Mouth_Lips_Tighten_DL", mouthClose * 0.28);
  setMorph("Mouth_Lips_Tighten_DR", mouthClose * 0.28);
  setMorph("Mouth_Lips_Thin_UL", mouthPress * 0.42);
  setMorph("Mouth_Lips_Thin_UR", mouthPress * 0.42);
  setMorph("Mouth_Lips_Thin_DL", mouthPress * 0.36);
  setMorph("Mouth_Lips_Thin_DR", mouthPress * 0.36);
  setMorph("Mouth_Lips_Towards_UL", mouthShrugUpper * 0.55);
  setMorph("Mouth_Lips_Towards_UR", mouthShrugUpper * 0.55);
  setMorph("Mouth_Lips_Towards_DL", mouthShrugLower * 0.55);
  setMorph("Mouth_Lips_Towards_DR", mouthShrugLower * 0.55);
  setMorph("Mouth_UpperLip_Shift_Left", mouthLeft * 0.55);
  setMorph("Mouth_UpperLip_Shift_Right", mouthRight * 0.55);
  setMorph("Mouth_LowerLip_Shift_Left", mouthLeft * 0.55);
  setMorph("Mouth_LowerLip_Shift_Right", mouthRight * 0.55);

  setA2FMorphQuad("Mouth_Funnel_UL", "Mouth_Funnel_UR", "Mouth_Funnel_DL", "Mouth_Funnel_DR", mouthFunnel * 0.82, mouthFunnel * 0.66);
  setA2FMorphQuad("Mouth_Lips_Purse_UL", "Mouth_Lips_Purse_UR", "Mouth_Lips_Purse_DL", "Mouth_Lips_Purse_DR", mouthPucker * 0.82, mouthPucker * 0.66);
  setA2FMorphPair("Mouth_Cheek_Blow_L", "Mouth_Cheek_Blow_R", cheekPuff * 0.75);
  setA2FMorphPair("Mouth_Cheek_Suck_L", "Mouth_Cheek_Suck_R", Math.max(mouthFrownLeft, mouthFrownRight) * 0.25);

  setMorph("Nose_Wrinkle_L", noseSneerLeft);
  setMorph("Nose_Wrinkle_R", noseSneerRight);
  setMorph("Nose_Wrinkle_Upper_L", noseSneerLeft * 0.7);
  setMorph("Nose_Wrinkle_Upper_R", noseSneerRight * 0.7);
  setMorph("Nose_Nasolabial_Deepen_L", mouthSmileLeft * 0.36);
  setMorph("Nose_Nasolabial_Deepen_R", mouthSmileRight * 0.36);
  setMorph("Nose_Nostril_Dilate_L", cheekPuff * 0.2);
  setMorph("Nose_Nostril_Dilate_R", cheekPuff * 0.2);

  setMorph("Tongue_Out", tongueOut);
  setMorph("Tongue_Up", Math.max(tongueUp, tongueTipUp));
  setMorph("Tongue_Down", Math.max(tongueDown, tongueTipDown));
  setMorph("Tongue_Left", Math.max(tongueLeft, tongueTipLeft));
  setMorph("Tongue_Right", Math.max(tongueRight, tongueTipRight));
  setMorph("Tongue_Narrow", tongueNarrow);
  setMorph("Tongue_Wide", tongueWide);
}

function resetAudio2FaceMorphs() {
  const expressions = state.morphMap?.expressions || {};
  state.a2fBlinkLeft = 0;
  state.a2fBlinkRight = 0;
  setMorph(expressions.blinkLeft || "Eye_Blink_L", state.naturalBlinkLeft);
  setMorph(expressions.blinkRight || "Eye_Blink_R", state.naturalBlinkRight);
  [
    "Jaw_Open", "Jaw_Open_Extreme", "Jaw_Left", "Jaw_Right", "Jaw_Fwd",
    "Jaw_Chin_Raise_DL", "Jaw_Chin_Raise_DR", "Jaw_Clench_L", "Jaw_Clench_R",
    "Eye_Squint_Inner_L", "Eye_Squint_Inner_R", "Eye_Squint_L", "Eye_Squint_R",
    "Eye_Cheek_Raise_L", "Eye_Cheek_Raise_R",
    "Mouth_Dimple_L", "Mouth_Dimple_R", "Mouth_Stretch_L", "Mouth_Stretch_R",
    "Mouth_Corner_Depress_L", "Mouth_Corner_Depress_R",
    "Mouth_LowerLip_Depress_L", "Mouth_LowerLip_Depress_R",
    "Mouth_UpperLip_Raise_L", "Mouth_UpperLip_Raise_R",
    "Mouth_Lips_Press_L", "Mouth_Lips_Press_R",
    "Mouth_LowerLip_RollIn_L", "Mouth_LowerLip_RollIn_R",
    "Mouth_UpperLip_RollIn_L", "Mouth_UpperLip_RollIn_R",
    "Mouth_LowerLip_Towards_Teeth_L", "Mouth_LowerLip_Towards_Teeth_R",
    "Mouth_UpperLip_Towards_Teeth_L", "Mouth_UpperLip_Towards_Teeth_R",
    "Mouth_Lips_Tighten_UL", "Mouth_Lips_Tighten_UR", "Mouth_Lips_Tighten_DL", "Mouth_Lips_Tighten_DR",
    "Mouth_Lips_Thin_UL", "Mouth_Lips_Thin_UR", "Mouth_Lips_Thin_DL", "Mouth_Lips_Thin_DR",
    "Mouth_Lips_Towards_UL", "Mouth_Lips_Towards_UR", "Mouth_Lips_Towards_DL", "Mouth_Lips_Towards_DR",
    "Mouth_UpperLip_Shift_Left", "Mouth_UpperLip_Shift_Right",
    "Mouth_LowerLip_Shift_Left", "Mouth_LowerLip_Shift_Right",
    "Mouth_Funnel_UL", "Mouth_Funnel_UR", "Mouth_Funnel_DL", "Mouth_Funnel_DR",
    "Mouth_Lips_Purse_UL", "Mouth_Lips_Purse_UR", "Mouth_Lips_Purse_DL", "Mouth_Lips_Purse_DR",
    "Mouth_Cheek_Blow_L", "Mouth_Cheek_Blow_R", "Mouth_Cheek_Suck_L", "Mouth_Cheek_Suck_R",
    "Nose_Wrinkle_L", "Nose_Wrinkle_R", "Nose_Wrinkle_Upper_L", "Nose_Wrinkle_Upper_R",
    "Nose_Nasolabial_Deepen_L", "Nose_Nasolabial_Deepen_R",
    "Nose_Nostril_Dilate_L", "Nose_Nostril_Dilate_R",
    "Tongue_Out", "Tongue_Up", "Tongue_Down", "Tongue_Left", "Tongue_Right", "Tongue_Narrow", "Tongue_Wide",
  ].forEach((morphName) => setMorph(morphName, 0));
}

function hasFreshOvrVisemes() {
  return state.lipsyncReady && Date.now() - state.lastOvrVisemeAt < 260;
}

function applyOvrVisemes() {
  const lipSync = state.morphMap?.lipSync || {};
  const visemes = state.ovrVisemes || {};
  const get = (name) => clamp01(visemes[name] || 0);
  const rounded = Math.max(get("oh"), get("ou"));
  const wide = Math.max(get("E"), get("ih"));
  const dental = Math.max(get("FF"), get("TH"));
  const affricate = Math.max(get("CH"), get("SS"));
  const tight = Math.max(get("DD"), get("kk"), get("nn"), get("RR"));
  const open = Math.max(get("aa"), rounded * 0.45, wide * 0.18);
  const mouthGain = state.mouthGain;

  setLipTargets({
    [lipSync.mouthOpen || "V_Open"]: gainValue(open, mouthGain),
    [lipSync.lipOpen || "V_Lip_Open"]: gainValue(open * 0.42, mouthGain),
    [lipSync.tightO || "V_Tight_O"]: gainValue(rounded * 0.82, mouthGain),
    [lipSync.tight || "V_Tight"]: gainValue(tight * 0.46, mouthGain),
    [lipSync.wide || "V_Wide"]: gainValue(wide * 0.72, mouthGain),
    [lipSync.dentalLip || "V_Dental_Lip"]: gainValue(dental * 0.66, mouthGain),
    [lipSync.affricate || "V_Affricate"]: gainValue(affricate * 0.68, mouthGain),
    [lipSync.explosive || "V_Explosive"]: gainValue(get("PP") * 0.74, mouthGain),
  });
  applyLipTargets(0.44);
}

function buildGeminiSystemPrompt() {
  const basePrompt = elements.promptInput.value.trim();
  const toolRules = state.geminiToolsEnabled
    ? [
        "Regla obligatoria de herramienta:",
        `- Para avanzar la simulacion bancaria, llama silenciosamente ${BANKING_TOOL_NAME}.`,
        "- La herramienta no necesita argumentos; el frontend usara el ultimo texto del usuario y el estado del flujo.",
        "- La herramienta devuelve un objeto con respuesta, form y buttons.",
        "- Tu audio debe decir solo la respuesta de la herramienta, reescrita natural si hace falta.",
        "- No inventes botones en el texto hablado. No nombres la herramienta.",
        "- En audio nunca digas: consultar_flujo_bancario, herramienta, tool, function call, JSON, form, buttons, label ni value.",
      ]
    : [
        "Regla de flujo sin herramienta:",
        "- Si necesitas avanzar la simulacion bancaria, responde con una pregunta breve y natural.",
        "- No nombres herramientas, JSON, form, buttons, label ni value.",
      ];
  return [
    basePrompt,
    "",
    ...toolRules,
  ].filter(Boolean).join("\n");
}

function bankingToolDeclaration() {
  return {
    functionDeclarations: [
      {
        name: BANKING_TOOL_NAME,
        description: "Consulta silenciosa del flujo de simulacion bancaria. No requiere parametros. Devuelve texto para hablar y UI estructurada con form/buttons para renderizar en la pagina.",
      },
    ],
  };
}

function buildGeminiSetup() {
  const setup = {
    setup: {
      model: `models/${state.geminiModel}`,
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: elements.voiceSelect.value || "Charon",
            },
          },
        },
      },
      systemInstruction: {
        parts: [{ text: buildGeminiSystemPrompt() }],
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      realtimeInputConfig: {
        automaticActivityDetection: {
          startOfSpeechSensitivity: "START_SENSITIVITY_HIGH",
          endOfSpeechSensitivity: "END_SENSITIVITY_HIGH",
          silenceDurationMs: 650,
        },
        turnCoverage: "TURN_INCLUDES_AUDIO_ACTIVITY_AND_ALL_VIDEO",
      },
    },
  };
  if (state.geminiToolsEnabled) {
    setup.setup.tools = [bankingToolDeclaration()];
  }
  return setup;
}

function geminiEndpoint() {
  const key = elements.apiKeyInput.value.trim();
  if (!key) throw new Error("Falta configurar Gemini API key.");
  localStorage.setItem(STORAGE_KEY, key);
  return `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(key)}`;
}

function sendClientText(text) {
  const value = String(text || "").trim();
  if (!value || !state.socket || state.socket.readyState !== WebSocket.OPEN) return;
  state.lastUserText = value;
  state.socket.send(JSON.stringify({
    realtimeInput: {
      text: value,
    },
  }));
}

function connectOvrLipSync() {
  if (state.lipsyncSocket && state.lipsyncSocket.readyState <= WebSocket.OPEN) return;

  try {
    const socket = new WebSocket(OVR_LIPSYNC_URL);
    state.lipsyncSocket = socket;
    state.lipsyncReady = false;

    socket.onopen = () => {
      state.metrics.a2fSocketOpenCount += 1;
      updateMetricsStatus();
      socket.send(JSON.stringify({ type: "ping" }));
    };
    socket.onmessage = async (event) => {
      const text = typeof event.data === "string" ? event.data : await event.data.text();
      const message = JSON.parse(text);
      if (message.type === "ready") {
        state.lipsyncReady = true;
        state.lipsyncEngine = message.engine || "ovr";
        setGestureStatus(`Lip-sync: ${state.lipsyncEngine}`);
        return;
      }
      if (message.type === "visemes") {
        state.lipsyncReady = true;
        state.lipsyncEngine = message.engine || state.lipsyncEngine;
        state.ovrVisemes = message.visemes || {};
        state.lastOvrVisemeAt = Date.now();
        return;
      }
      if (message.type === "error") {
        console.warn("OVR lip-sync bridge:", message.message);
      }
    };
    socket.onclose = () => {
      if (state.lipsyncSocket === socket) {
        state.lipsyncSocket = null;
        state.lipsyncReady = false;
        state.lipsyncEngine = "";
        state.ovrVisemes = {};
      }
    };
    socket.onerror = () => {
      state.lipsyncReady = false;
      state.lipsyncEngine = "";
    };
  } catch (error) {
    console.warn("Could not connect OVR lip-sync bridge:", error);
  }
}

function sendToOvrLipSync(bytes, sampleRate) {
  const socket = state.lipsyncSocket;
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({
    type: "audio",
    sampleRate,
    data: bytesToBase64(bytes),
  }));
}

function connectAudio2Face() {
  if (state.audio2FaceSocket && state.audio2FaceSocket.readyState <= WebSocket.OPEN) return;

  try {
    const socket = new WebSocket(AUDIO2FACE_URL);
    state.audio2FaceSocket = socket;
    state.audio2FaceReady = false;

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: "ping" }));
    };
    socket.onmessage = async (event) => {
      const text = typeof event.data === "string" ? event.data : await event.data.text();
      const message = JSON.parse(text);
      if (message.type === "ready") {
        state.audio2FaceReady = true;
        resetAudio2FacePlaybackSync();
        setGestureStatus("Lip-sync: audio2face");
        return;
      }
      if (message.type === "blendshapes") {
        state.audio2FaceFramesReceived += message.frames?.length || 0;
        updateAudio2FaceFrameMetrics(message.frames || []);
        queueAudio2FaceFrames(message.frames || []);
        const frame = message.frames?.[message.frames.length - 1];
        if (frame?.blendShapes) {
          state.audio2FaceBlendShapes = frame.blendShapes;
          state.audio2FaceMaxJawOpen = Math.max(state.audio2FaceMaxJawOpen, frame.blendShapes.JawOpen || 0);
          state.lastAudio2FaceAt = Date.now();
        }
        return;
      }
      if (message.type === "status") {
        console.info("Audio2Face status:", message);
        return;
      }
      if (message.type === "error") {
        console.warn("Audio2Face bridge:", message.message);
      }
    };
    socket.onclose = (event) => {
      state.metrics.a2fSocketCloseCount += 1;
      state.metrics.a2fLastCloseCode = event?.code || "";
      state.metrics.a2fLastCloseReason = event?.reason || "";
      if (state.audio2FaceSocket === socket) {
        state.audio2FaceSocket = null;
        state.audio2FaceReady = false;
        state.audio2FaceBlendShapes = {};
        state.lastAudio2FaceAt = 0;
      }
      updateMetricsStatus();
    };
    socket.onerror = () => {
      state.audio2FaceReady = false;
      state.metrics.a2fLastCloseReason = "websocket error";
      updateMetricsStatus();
    };
  } catch (error) {
    console.warn("Could not connect Audio2Face bridge:", error);
  }
}

function sendToAudio2Face(bytes, sampleRate) {
  connectAudio2Face();
  const socket = state.audio2FaceSocket;
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    state.metrics.a2fAudioChunksDropped += 1;
    markMetric(state.metrics.a2fAudioDrop);
    return;
  }
  socket.send(JSON.stringify({
    type: "audio",
    sampleRate,
    data: bytesToBase64(bytes),
  }));
  state.metrics.a2fAudioChunksSent += 1;
  markMetric(state.metrics.a2fAudioSend);
  markMetric(state.metrics.a2fAudioBytes, bytes.byteLength || bytes.length || 0);
}

function endAudio2FaceTurn() {
  const socket = state.audio2FaceSocket;
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: "end" }));
  window.clearTimeout(state.audio2FaceResetTimer);
  const playbackRemainingMs = state.playbackContext
    ? Math.max(0, (state.playbackCursor - state.playbackContext.currentTime) * 1000)
    : 0;
  const resetDelayMs = Math.max(2200, playbackRemainingMs + 1500);
  state.audio2FaceResetTimer = window.setTimeout(() => {
    stopAudio2Face();
  }, resetDelayMs);
}

async function startSession() {
  if (state.starting || state.ready) return;
  state.starting = true;
  state.closingManually = false;
  setButtons();
  setStatus("Activando microfono");
  resetAudio2FaceMetrics();
  resetBankingFlow();
  state.lastUserText = "";
  state.geminiModel = DEFAULT_MODEL;
  state.geminiToolsEnabled = ENABLE_GEMINI_TOOLS;

  try {
    const endpoint = geminiEndpoint();
    await startMicCapture();
    setStatus(`Conectando Gemini (${state.geminiModel}${state.geminiToolsEnabled ? " + tools" : ""})`);

    const socket = new WebSocket(endpoint);
    state.socket = socket;

    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = () => reject(new Error("No se pudo abrir la conexion con Gemini Live."));
    });

    socket.onmessage = handleGeminiMessage;
    socket.onerror = () => {
      if (socket.__setupReject) {
        socket.__setupReject(new Error("Gemini Live rechazo la conexion."));
      }
      setStatus("Error de conexion", "error");
    };
    socket.onclose = (event) => {
      const closeMessage = buildCloseMessage(event);
      if (!state.ready && socket.__setupReject) {
        socket.__setupReject(new Error(closeMessage));
        socket.__setupResolve = null;
        socket.__setupReject = null;
      }
      state.ready = false;
      if (state.socket === socket) {
        state.socket = null;
      }
      stopMicCapture();
      stopQueuedPlayback();
      clearActionPanel();
      setStatus(state.closingManually ? "Sesion cerrada" : closeMessage, state.closingManually ? "idle" : "error");
      state.closingManually = false;
      setButtons();
    };

    const setupReady = new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("Timeout esperando setupComplete.")), 45000);
      socket.__setupResolve = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      socket.__setupReject = reject;
    });

    socket.send(JSON.stringify(buildGeminiSetup()));
    await setupReady;
    connectOvrLipSync();
    connectAudio2Face();
    setStatus("Escuchando", "ready");
    updateMicStatus();
  } catch (error) {
    await stopSession();
    setStatus(error.message || "Error iniciando demo", "error");
  } finally {
    state.starting = false;
    setButtons();
  }
}

async function stopSession() {
  state.ready = false;
  state.directAudio2Face = false;
  state.responseTranscript = "";
  state.lastUserText = "";
  clearActionPanel();
  if (state.gestureAbort) {
    state.gestureAbort.abort();
    state.gestureAbort = null;
  }
  clearExpressionTimeouts();
  resetSemanticExpression();
  stopMicCapture();
  stopQueuedPlayback();
  stopOvrLipSync();
  stopAudio2Face();
  if (state.socket) {
    const socket = state.socket;
    state.socket = null;
    state.closingManually = true;
    try {
      socket.close();
    } catch {
      // Ignore close errors.
    }
  }
  setButtons();
}

async function startDirectAudio2Face() {
  if (state.starting || state.ready) return;
  if (state.directAudio2Face) {
    await stopSession();
    return;
  }

  state.starting = true;
  state.directAudio2Face = true;
  resetAudio2FaceMetrics();
  setButtons();
  setStatus("Microfono moviendo avatar", "ready");
  connectAudio2Face();

  try {
    await startMicCapture();
    setMicStatus("Microfono: moviendo avatar");
  } catch (error) {
    await stopSession();
    setStatus(error.message || "No se pudo iniciar mic -> Audio2Face", "error");
  } finally {
    state.starting = false;
    setButtons();
  }
}

function buildCloseMessage(event) {
  const code = event?.code ? `codigo ${event.code}` : "sin codigo";
  const reason = event?.reason ? `: ${event.reason}` : "";
  return `Gemini cerro la sesion (${code}${reason})`;
}

function gestureEndpoint() {
  const key = elements.apiKeyInput.value.trim();
  if (!key) throw new Error("Falta configurar Gemini API key.");
  return `https://generativelanguage.googleapis.com/v1beta/models/${GESTURE_MODEL}:generateContent?key=${encodeURIComponent(key)}`;
}

function shouldSkipRemoteGestures() {
  return Date.now() < state.gestureBackoffUntil;
}

function setGestureBackoff(ms) {
  state.gestureBackoffUntil = Date.now() + ms;
}

function maybeRequestEarlyGesture(force = false) {
  const transcript = state.responseTranscript.trim();
  if (!transcript) return;

  const now = Date.now();
  const newChars = transcript.length - state.lastGestureTextLength;
  if (!force && (newChars < 32 || now - state.lastGestureRequestAt < 1200)) return;

  state.lastGestureTextLength = transcript.length;
  state.lastGestureRequestAt = now;
  requestGesturePlan(transcript, { partial: !force });
}

function maybeApplyLocalGestureHint(text) {
  const now = Date.now();
  if (now - state.lastLocalGestureAt < 900) return;
  state.lastLocalGestureAt = now;
  applyGesturePlan({
    ...buildFallbackGesture(text),
    durationMs: 1100,
  });
}

function functionCallsFromToolCall(toolCall) {
  return toolCall?.functionCalls || toolCall?.function_calls || [];
}

function functionCallsFromParts(parts = []) {
  return parts
    .map((part) => part?.functionCall || part?.function_call)
    .filter(Boolean);
}

function looksLikeSpokenToolCall(text) {
  const value = String(text || "").toLowerCase();
  return (
    value.includes(BANKING_TOOL_NAME.toLowerCase()) ||
    value.includes("function call") ||
    value.includes("tool call") ||
    value.includes('"buttons"') ||
    value.includes('"label"') ||
    value.includes('"value"')
  );
}

function argsFromFunctionCall(functionCall) {
  const args = functionCall?.args || functionCall?.arguments || {};
  if (typeof args === "string") {
    return tryParseStructuredJson(args) || { form: args, buttons: [] };
  }
  return args || {};
}

function normalizeActionPayload(args = {}) {
  const parsedArgs = tryParseStructuredJson(args);
  const data = parsedArgs !== null ? parsedArgs : args || {};
  return {
    text: String(data.respuesta || data.response || data.answer || data.text || data.message || data.mensaje || "").trim(),
    form: String(data.form || data.title || data.titulo || data.pregunta || "").trim(),
    buttons: normalizeActionButtons(data.buttons || data.button || data.options || data.opciones || data.actions || data.acciones || data.choices),
  };
}

function selectedAccountType(text) {
  const normalized = normalizeUiText(text);
  if (normalized.includes("corriente")) return "cuenta corriente";
  if (normalized.includes("vista")) return "cuenta vista";
  if (normalized.includes("ahorro")) return "cuenta de ahorro";
  return "";
}

function bankingResult(respuesta, form = "", buttons = []) {
  return {
    respuesta,
    text: respuesta,
    form,
    buttons: normalizeActionButtons(buttons),
  };
}

function consultBankingFlow(message) {
  const normalized = normalizeUiText(message);
  const flow = state.bankingFlow;
  const accountType = selectedAccountType(normalized);

  if (normalized.includes("reiniciar") || normalized.includes("empezar de nuevo")) {
    resetBankingFlow();
    return bankingResult(
      "Perfecto, partamos de nuevo. Primero revisemos que tipo de cuenta quieres simular.",
      "Que tipo de cuenta te interesa?",
      [
        { label: "Cuenta corriente", value: "Quiero abrir una cuenta corriente" },
        { label: "Cuenta vista", value: "Quiero abrir una cuenta vista" },
        { label: "Cuenta de ahorro", value: "Quiero abrir una cuenta de ahorro" },
      ],
    );
  }

  if (accountType) {
    flow.accountType = accountType;
    return bankingResult(
      `Super, revisemos una ${accountType}. Para esta simulacion necesito confirmar solo si eres mayor de edad, usando datos ficticios.`,
      "Eres mayor de 18?",
      [
        { label: "Si, soy mayor de 18", value: "Si, soy mayor de 18" },
        { label: "No, necesito ayuda", value: "No soy mayor de 18 y necesito ayuda" },
      ],
    );
  }

  if (normalized.includes("mayor de 18") || normalized.includes("mayor de edad") || normalized.includes("si soy mayor")) {
    flow.ageConfirmed = true;
    return bankingResult(
      "Perfecto. Para cuidar tus datos, sigamos con informacion ficticia de prueba. Ahora puedo simular el ingreso de datos personales.",
      "Continuamos con datos ficticios?",
      [
        { label: "Continuar", value: "Continuemos con datos ficticios" },
        { label: "Volver atras", value: "Quiero volver al tipo de cuenta" },
      ],
    );
  }

  if (normalized.includes("no soy mayor") || normalized.includes("necesito ayuda")) {
    return bankingResult(
      "Claro, en ese caso la apertura real normalmente requiere apoyo de un representante legal. Para esta demo podemos seguir solo como simulacion.",
      "Quieres continuar como simulacion?",
      [
        { label: "Continuar simulacion", value: "Continuar simulacion con datos ficticios" },
        { label: "Volver al inicio", value: "Reiniciar flujo bancario" },
      ],
    );
  }

  if (normalized.includes("volver")) {
    flow.accountType = "";
    flow.ageConfirmed = false;
    return bankingResult(
      "No hay problema, volvamos un paso. Elige nuevamente el tipo de cuenta que quieres revisar.",
      "Que tipo de cuenta te interesa?",
      [
        { label: "Cuenta corriente", value: "Quiero abrir una cuenta corriente" },
        { label: "Cuenta vista", value: "Quiero abrir una cuenta vista" },
        { label: "Cuenta de ahorro", value: "Quiero abrir una cuenta de ahorro" },
      ],
    );
  }

  if (normalized.includes("continuar") || normalized.includes("continuemos") || normalized.includes("seguir")) {
    flow.usingMockData = true;
    const account = flow.accountType || "cuenta bancaria";
    return bankingResult(
      `Listo, para la ${account} vamos a usar datos ficticios. En una apertura real se validaria identidad, domicilio, actividad y contacto, pero aca no ingresaremos informacion sensible.`,
      "Que hacemos ahora?",
      [
        { label: "Confirmar simulacion", value: "Confirmo la simulacion de apertura" },
        { label: "Cambiar tipo de cuenta", value: "Quiero volver al tipo de cuenta" },
      ],
    );
  }

  if (normalized.includes("confirmo") || normalized.includes("confirmar")) {
    return bankingResult(
      "Perfecto, la simulacion queda confirmada. Quedaria pendiente la validacion de identidad y firma en un flujo real, pero no vamos a pedir ningun dato real en esta demo.",
      "Flujo simulado terminado",
      [
        { label: "Empezar de nuevo", value: "Reiniciar flujo bancario" },
      ],
    );
  }

  return bankingResult(
    "Mira, para partir necesito que elijas que tipo de cuenta quieres simular.",
    "Que tipo de cuenta te interesa?",
    [
      { label: "Cuenta corriente", value: "Quiero abrir una cuenta corriente" },
      { label: "Cuenta vista", value: "Quiero abrir una cuenta vista" },
      { label: "Cuenta de ahorro", value: "Quiero abrir una cuenta de ahorro" },
    ],
  );
}

async function executeFunctionCall(functionCall) {
  if (functionCall.name !== BANKING_TOOL_NAME) {
    return {
      id: functionCall.id,
      name: functionCall.name,
      response: {
        error: "Funcion no disponible en este avatar.",
      },
    };
  }

  const args = argsFromFunctionCall(functionCall);
  const payload = normalizeActionPayload(consultBankingFlow(args.message || state.lastUserText || state.responseTranscript || "Inicio del flujo"));
  renderActionPanel(payload);
  return {
    id: functionCall.id,
    name: functionCall.name,
    response: {
      result: {
        respuesta: payload.text,
        form: payload.form,
        buttons: payload.buttons,
      },
    },
  };
}

async function handleToolCall(toolCall) {
  const calls = functionCallsFromToolCall(toolCall);
  if (!calls.length || !state.socket || state.socket.readyState !== WebSocket.OPEN) return;

  setGestureStatus(`UI: tool call ${calls.length}`);
  const functionResponses = [];
  for (const call of calls) {
    functionResponses.push(await executeFunctionCall(call));
  }

  state.socket.send(JSON.stringify({
    toolResponse: {
      functionResponses,
    },
  }));
}

async function handleGeminiMessage(rawEvent) {
  const rawText = typeof rawEvent.data === "string" ? rawEvent.data : await rawEvent.data.text();
  const message = JSON.parse(rawText);

  if (message.setupComplete) {
    state.ready = true;
    if (state.socket?.__setupResolve) {
      state.socket.__setupResolve();
      state.socket.__setupResolve = null;
      state.socket.__setupReject = null;
    }
    setButtons();
    return;
  }

  const toolCall = message.toolCall || message.tool_call;
  if (toolCall) {
    await handleToolCall(toolCall);
  }

  const toolCallCancellation = message.toolCallCancellation || message.tool_call_cancellation;
  if (toolCallCancellation) {
    console.debug("Gemini tool call cancelled:", toolCallCancellation);
  }

  const content = message.serverContent;
  if (content) {
    if (content.interrupted) {
      stopQueuedPlayback();
    }
    const inputTranscript = content.inputTranscription || content.input_transcription;
    if (inputTranscript?.text) {
      state.lastUserText = [state.lastUserText, inputTranscript.text].filter(Boolean).join(" ").trim();
      clearActionPanel();
    }
    const parts = content.modelTurn?.parts || [];
    const partFunctionCalls = functionCallsFromParts(parts);
    if (partFunctionCalls.length) {
      await handleToolCall({ functionCalls: partFunctionCalls });
    }
    const outputTranscript = content.outputTranscription || content.output_transcription;
    const leakedToolSpeech = looksLikeSpokenToolCall(outputTranscript?.text);
    if (leakedToolSpeech) {
      stopQueuedPlayback();
      setGestureStatus("UI: tool hablada bloqueada");
    }
    parts.forEach((part) => {
      const inlineData = part.inlineData || part.inline_data;
      if (!leakedToolSpeech && inlineData?.data) {
        playPcm16Audio(inlineData.data, inlineData.mimeType || inlineData.mime_type);
      }
    });
    if (outputTranscript?.text && !leakedToolSpeech) {
      state.responseTranscript += outputTranscript.text;
      maybeRenderActionPanelFromText(state.responseTranscript);
      maybeApplyLocalGestureHint(state.responseTranscript);
      maybeRequestEarlyGesture(false);
    }
    if (content.turnComplete && state.ready) {
      const transcript = state.responseTranscript.trim();
      if (transcript) {
        maybeRequestEarlyGesture(true);
      }
      endAudio2FaceTurn();
      state.responseTranscript = "";
      state.lastGestureTextLength = 0;
      setStatus(state.muted ? "Microfono muteado" : "Escuchando", "ready");
    }
  }

  if (message.error) {
    console.error("Gemini Live error:", message.error);
    const detail = message.error.message || message.error.status || "Error de Gemini";
    if (state.socket?.__setupReject) {
      state.socket.__setupReject(new Error(detail));
    }
    setStatus(detail, "error");
  }
}

async function requestGesturePlan(responseText, options = {}) {
  if (shouldSkipRemoteGestures()) {
    if (!options.partial) {
      setGestureStatus("Gestos: fallback local (backoff)");
      applyGesturePlan(buildFallbackGesture(responseText));
    }
    return;
  }

  if (state.gestureAbort) {
    if (options.partial) return;
    state.gestureAbort.abort();
  }

  const controller = new AbortController();
  state.gestureAbort = controller;
  setGestureStatus(`Gestos: ${GESTURE_MODEL}`);

  try {
    const response = await fetch(gestureEndpoint(), {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [{
            text: [
              "Devuelve SOLO JSON valido para animar un avatar 3D.",
              "No repitas el texto. No expliques nada.",
              "Los valores numericos van de 0 a 1 salvo headNod/headTurn/headTilt, que van de -1 a 1.",
              "Usa gestos sutiles y humanos, no caricatura.",
              options.partial ? "Es texto parcial de una respuesta en curso: anticipa el gesto general." : "Es el texto final o casi final de una respuesta.",
              "",
              "Texto que esta diciendo el avatar:",
              responseText.slice(0, 900),
            ].join("\n"),
          }],
        }],
        generationConfig: {
          temperature: 0.25,
          maxOutputTokens: 220,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              emotion: { type: "STRING" },
              intensity: { type: "NUMBER" },
              smile: { type: "NUMBER" },
              browRaise: { type: "NUMBER" },
              browDown: { type: "NUMBER" },
              eyeWide: { type: "NUMBER" },
              cheekRaise: { type: "NUMBER" },
              headNod: { type: "NUMBER" },
              headTurn: { type: "NUMBER" },
              headTilt: { type: "NUMBER" },
              durationMs: { type: "NUMBER" },
            },
            required: ["emotion", "intensity", "smile", "browRaise", "browDown", "eyeWide", "cheekRaise", "headNod", "headTurn", "headTilt", "durationMs"],
          },
        },
      }),
    });

    if (!response.ok) {
      if ([429, 500, 502, 503, 504].includes(response.status)) {
        setGestureBackoff(60000);
      }
      throw new Error(`Gestos HTTP ${response.status}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Gemini no devolvio gesto.");
    const plan = JSON.parse(text);
    applyGesturePlan(plan);
    setGestureStatus(`Gestos: ${plan.emotion || "ok"}`);
  } catch (error) {
    if (error.name === "AbortError") return;
    console.warn("Gesture plan error:", error);
    setGestureStatus("Gestos: fallback local");
    applyGesturePlan(buildFallbackGesture(responseText));
  } finally {
    if (state.gestureAbort === controller) {
      state.gestureAbort = null;
    }
  }
}

function buildFallbackGesture(text) {
  const lower = text.toLowerCase();
  const question = lower.includes("?") || lower.includes("como") || lower.includes("que ");
  const positive = /claro|perfecto|bien|excelente|gracias|puedo ayudarte|listo/.test(lower);
  const serious = /error|problema|no puedo|disculpa|lamentablemente|riesgo/.test(lower);
  return {
    emotion: serious ? "serious" : positive ? "friendly" : question ? "attentive" : "neutral",
    intensity: serious ? 0.42 : 0.55,
    smile: positive ? 0.52 : serious ? 0.05 : 0.22,
    browRaise: question ? 0.36 : positive ? 0.18 : 0.12,
    browDown: serious ? 0.28 : 0.02,
    eyeWide: question ? 0.22 : 0.08,
    cheekRaise: positive ? 0.28 : 0.08,
    headNod: positive ? 0.26 : 0.08,
    headTurn: 0,
    headTilt: question ? -0.16 : 0.06,
    durationMs: 2200,
  };
}

function buildMicConstraints() {
  const deviceId = elements.micSelect?.value;
  return {
    deviceId: deviceId ? { exact: deviceId } : undefined,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
}

async function refreshMicDevices() {
  if (!elements.micSelect || !navigator.mediaDevices?.enumerateDevices) return;
  const selected = elements.micSelect.value;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const microphones = devices.filter((device) => device.kind === "audioinput");

  elements.micSelect.innerHTML = "";
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "Predeterminado del sistema";
  elements.micSelect.appendChild(defaultOption);

  microphones.forEach((device, index) => {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label || `Microfono ${index + 1}`;
    elements.micSelect.appendChild(option);
  });

  if ([...elements.micSelect.options].some((option) => option.value === selected)) {
    elements.micSelect.value = selected;
  }
}

function describeMicError(error) {
  const name = error?.name || "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "El navegador bloqueo el microfono. Revisá el permiso del sitio y Windows > Privacidad > Microfono.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No encontre ningun microfono disponible.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "El microfono esta ocupado por otra app o Windows no lo deja abrir.";
  }
  if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
    return "No pude abrir ese microfono. Proba con 'Predeterminado del sistema'.";
  }
  return error?.message || "No se pudo iniciar el microfono.";
}

async function startMicCapture() {
  if (state.micStream) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("El navegador no expone getUserMedia. Abri la demo en http://127.0.0.1 o https.");
  }

  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error("Este navegador no soporta Web Audio API.");
  }

  setMicStatus("Microfono: pidiendo permiso");
  state.micContext = new AudioContextCtor();
  await state.micContext.resume().catch(() => {});

  try {
    state.micStream = await navigator.mediaDevices.getUserMedia({
      audio: buildMicConstraints(),
    });
  } catch (error) {
    if (state.micContext) {
      await state.micContext.close().catch(() => {});
      state.micContext = null;
    }
    throw new Error(describeMicError(error));
  }

  await refreshMicDevices().catch(() => {});
  if (state.micContext.state === "suspended") {
    await state.micContext.resume().catch(() => {});
  }

  state.micSource = state.micContext.createMediaStreamSource(state.micStream);
  state.micProcessor = state.micContext.createScriptProcessor(4096, 1, 1);
  state.micMonitorGain = state.micContext.createGain();
  state.micMonitorGain.gain.value = 0;
  state.micProcessor.onaudioprocess = (event) => {
    sendAudioFrame(event.inputBuffer.getChannelData(0), state.micContext.sampleRate);
  };
  state.micSource.connect(state.micProcessor);
  state.micProcessor.connect(state.micMonitorGain);
  state.micMonitorGain.connect(state.micContext.destination);
  state.micFramesCaptured = 0;
  state.micFramesSent = 0;
  state.micLastLevel = 0;
  window.clearInterval(state.micStatusTimer);
  window.clearInterval(state.metricsTimer);
  state.micStatusTimer = window.setInterval(updateMicStatus, 700);
  state.metricsTimer = window.setInterval(updateMetricsStatus, 700);
  updateMicStatus();
}

function stopMicCapture() {
  window.clearInterval(state.micStatusTimer);
  window.clearInterval(state.metricsTimer);
  state.micStatusTimer = 0;
  state.metricsTimer = 0;
  if (state.micProcessor) state.micProcessor.disconnect();
  if (state.micMonitorGain) state.micMonitorGain.disconnect();
  if (state.micSource) state.micSource.disconnect();
  if (state.micContext) state.micContext.close().catch(() => {});
  if (state.micStream) state.micStream.getTracks().forEach((track) => track.stop());
  state.micProcessor = null;
  state.micMonitorGain = null;
  state.micSource = null;
  state.micContext = null;
  state.micStream = null;
  state.micRemainder = new Float32Array(0);
  state.micFramesCaptured = 0;
  state.micFramesSent = 0;
  state.micLastLevel = 0;
  updateMetricsStatus();
}

function updateMicStatus() {
  if (!state.micStream) return;
  const percent = Math.round(state.micLastLevel * 100);
  const captured = state.micFramesCaptured;
  const sent = state.micFramesSent;
  const mode = state.muted
    ? "muteado"
    : state.ready
      ? "enviando"
      : state.directAudio2Face
        ? "moviendo avatar"
        : "capturando";
  const contextState = state.micContext?.state === "suspended" ? " (audio suspendido)" : "";
  setMicStatus(`Microfono: ${mode} ${percent}% (captura ${captured}, envio ${sent})${contextState}`);
}

function resumeMicContext() {
  if (state.micContext?.state !== "suspended") return;
  state.micContext.resume()
    .then(updateMicStatus)
    .catch(() => {});
}

function sendAudioFrame(inputData, inputRate) {
  state.micLastLevel = getAudioLevel(inputData);
  state.micFramesCaptured += 1;
  markMetric(state.metrics.micCapture);
  if (state.directAudio2Face) {
    if (state.muted) return;
    const pcm16 = floatToPcm16(inputData);
    sendToAudio2Face(pcm16, inputRate);
    state.micFramesSent += 1;
    markMetric(state.metrics.micSend);
    return;
  }

  if (!state.ready || !state.socket || state.socket.readyState !== WebSocket.OPEN || state.muted) {
    state.micRemainder = new Float32Array(0);
    return;
  }

  const merged = new Float32Array(state.micRemainder.length + inputData.length);
  merged.set(state.micRemainder, 0);
  merged.set(inputData, state.micRemainder.length);

  const samplesPerMessage = Math.floor(inputRate * 0.1);
  const usableLength = Math.floor(merged.length / samplesPerMessage) * samplesPerMessage;
  if (usableLength === 0) {
    state.micRemainder = merged;
    return;
  }

  const usable = merged.subarray(0, usableLength);
  state.micRemainder = merged.subarray(usableLength);
  const downsampled = downsampleTo16k(usable, inputRate);
  const pcm16 = floatToPcm16(downsampled);

  state.socket.send(JSON.stringify({
    realtimeInput: {
      audio: {
        data: bytesToBase64(pcm16),
        mimeType: "audio/pcm;rate=16000",
      },
    },
  }));
  state.micFramesSent += 1;
  markMetric(state.metrics.micSend);
}

function getAudioLevel(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    sum += samples[i] * samples[i];
  }
  return clamp01((Math.sqrt(sum / Math.max(1, samples.length)) - 0.01) * 18);
}

function downsampleTo16k(input, sourceRate) {
  const targetRate = 16000;
  if (sourceRate === targetRate) return input;
  const ratio = sourceRate / targetRate;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += input[j];
    output[i] = sum / Math.max(1, end - start);
  }
  return output;
}

function floatToPcm16(float32) {
  const pcm = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, float32[i]));
    pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return new Uint8Array(pcm.buffer);
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function audioRateFromMime(mimeType) {
  const match = String(mimeType || "").match(/rate=(\d+)/i);
  return match ? Number(match[1]) : 24000;
}

function ensurePlaybackContext() {
  if (!state.playbackContext) {
    state.playbackContext = new AudioContext();
    state.playbackGain = state.playbackContext.createGain();
    state.playbackAnalyser = state.playbackContext.createAnalyser();
    state.playbackAnalyser.fftSize = 256;
    state.playbackGain.connect(state.playbackAnalyser);
    state.playbackAnalyser.connect(state.playbackContext.destination);
    state.playbackCursor = state.playbackContext.currentTime;
  }
  return state.playbackContext;
}

function playPcm16Audio(base64, mimeType) {
  const bytes = base64ToBytes(base64);
  const samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
  const rate = audioRateFromMime(mimeType);
  const context = ensurePlaybackContext();
  const buffer = context.createBuffer(1, samples.length, rate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i += 1) {
    channel[i] = samples[i] / 32768;
  }

  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(state.playbackGain);
  const startAt = Math.max(context.currentTime + 0.02, state.playbackCursor);
  if (!state.audio2FacePlaybackStartAt || state.playbackSources.size === 0) {
    state.audio2FacePlaybackStartAt = startAt;
  }
  sendToAudio2Face(bytes, rate);
  sendToOvrLipSync(bytes, rate);
  source.start(startAt);
  state.playbackCursor = startAt + buffer.duration;
  state.playbackSources.add(source);
  source.onended = () => {
    state.playbackSources.delete(source);
    if (state.playbackSources.size === 0) {
      setMouthLevel(0);
    }
  };
}

function stopQueuedPlayback() {
  state.playbackSources.forEach((source) => {
    try {
      source.stop();
    } catch {
      // Ignore stale sources.
    }
  });
  state.playbackSources.clear();
  if (state.playbackContext) {
    state.playbackCursor = state.playbackContext.currentTime;
  }
  resetAudio2FacePlaybackSync();
  setLipSyncSource("idle");
  setMouthLevel(0);
}

function stopOvrLipSync() {
  if (state.lipsyncSocket) {
    try {
      state.lipsyncSocket.close();
    } catch {
      // Ignore close errors.
    }
  }
  state.lipsyncSocket = null;
  state.lipsyncReady = false;
  state.lipsyncEngine = "";
  state.ovrVisemes = {};
  state.lastOvrVisemeAt = 0;
}

function stopAudio2Face() {
  window.clearTimeout(state.audio2FaceResetTimer);
  state.audio2FaceResetTimer = 0;
  if (state.audio2FaceSocket) {
    try {
      state.audio2FaceSocket.close();
    } catch {
      // Ignore close errors.
    }
  }
  state.audio2FaceSocket = null;
  state.audio2FaceReady = false;
  state.audio2FaceBlendShapes = {};
  resetAudio2FacePlaybackSync();
  state.lastAudio2FaceAt = 0;
  resetAudio2FaceMorphs();
  if (!state.playbackSources.size && !state.directAudio2Face) {
    setLipSyncSource("idle");
  }
}

function setAvatarPaused(paused) {
  state.avatarPaused = paused;
  elements.stage.classList.toggle("is-paused", paused);
  clearExpressionTimeouts();
  resetSemanticExpression();
  setMouthLevel(0);

  if (paused) {
    setLipSyncSource("paused");
    clearBlinkTimers();
    stopRenderLoop();
    setGestureStatus("Avatar pausado: render detenido");
  } else {
    setLipSyncSource("idle");
    resize();
    startRenderLoop();
    startIdleBlink();
    setGestureStatus("Gestos: esperando audio");
  }

  setButtons();
}

function restoreSettings() {
  const savedKey = localStorage.getItem(STORAGE_KEY);
  if (savedKey) elements.apiKeyInput.value = savedKey;
  if (elements.avatarSelect) {
    elements.avatarSelect.value = state.avatarPreset;
  }
  if (elements.renderQualitySelect) {
    elements.renderQualitySelect.value = state.renderQuality;
  }
  try {
    const savedExpressiveness = JSON.parse(localStorage.getItem(EXPRESSIVENESS_STORAGE_KEY) || "{}");
    if (!PARAMS.has("a2fMouthGain") && !PARAMS.has("mouthGain") && savedExpressiveness.mouthGain !== undefined) {
      state.mouthGain = clampRange(savedExpressiveness.mouthGain, 0.5, 2.5);
    }
    if (!PARAMS.has("a2fLowerFaceGain") && !PARAMS.has("lowerFaceGain") && savedExpressiveness.lowerFaceGain !== undefined) {
      state.lowerFaceGain = clampRange(savedExpressiveness.lowerFaceGain, 0.5, 2.5);
    }
    if (!PARAMS.has("a2fSmoothing") && savedExpressiveness.a2fSmoothing !== undefined) {
      state.a2fSmoothing = clampRange(savedExpressiveness.a2fSmoothing, 0.15, 0.8);
    }
    if (!PARAMS.has("headMotionGain") && !PARAMS.has("headGain") && savedExpressiveness.headMotionGain !== undefined) {
      state.headMotionGain = clampRange(savedExpressiveness.headMotionGain, 0, 1.5);
    }
  } catch {
    // Ignore invalid stored tuning.
  }
  updateExpressivenessControls();
}

function changeAvatarPreset(preset) {
  if (!AVATAR_PRESETS[preset] || preset === state.avatarPreset) return;
  localStorage.setItem(AVATAR_STORAGE_KEY, preset);
  const url = new URL(window.location.href);
  url.searchParams.set("avatar", preset);
  url.searchParams.delete("avatarUrl");
  window.location.href = url.toString();
}

function changeRenderQuality(quality) {
  if (!RENDER_QUALITY_PRESETS[quality] || quality === state.renderQuality) return;
  localStorage.setItem(RENDER_QUALITY_STORAGE_KEY, quality);
  const url = new URL(window.location.href);
  url.searchParams.set("quality", quality);
  window.location.href = url.toString();
}

elements.startButton.addEventListener("click", startSession);
elements.stopButton.addEventListener("click", stopSession);
elements.micA2FButton.addEventListener("click", startDirectAudio2Face);
elements.pauseAvatarButton.addEventListener("click", () => {
  setAvatarPaused(!state.avatarPaused);
});
elements.avatarSelect?.addEventListener("change", (event) => {
  changeAvatarPreset(event.target.value);
});
elements.renderQualitySelect?.addEventListener("change", (event) => {
  changeRenderQuality(event.target.value);
});
elements.mouthGainInput?.addEventListener("input", (event) => {
  setExpressivenessSetting("mouthGain", event.target.value);
});
elements.lowerFaceGainInput?.addEventListener("input", (event) => {
  setExpressivenessSetting("lowerFaceGain", event.target.value);
});
elements.a2fSmoothingInput?.addEventListener("input", (event) => {
  setExpressivenessSetting("a2fSmoothing", event.target.value);
});
elements.headMotionGainInput?.addEventListener("input", (event) => {
  setExpressivenessSetting("headMotionGain", event.target.value);
});
if (elements.micSelect) {
  elements.micSelect.addEventListener("change", async () => {
    if (!state.micStream) return;
    try {
      stopMicCapture();
      await startMicCapture();
    } catch (error) {
      await stopSession();
      setStatus(error.message || "No se pudo cambiar el microfono", "error");
    }
  });
}
elements.downloadMetricsCsvButton?.addEventListener("click", downloadMetricsCsv);
elements.downloadMetricsJsonButton?.addEventListener("click", downloadMetricsJson);
elements.clearMetricsButton?.addEventListener("click", () => {
  resetAudio2FaceMetrics();
  setGestureStatus("Metricas limpiadas");
});
elements.muteButton.addEventListener("click", () => {
  state.muted = !state.muted;
  setStatus(state.muted ? "Microfono muteado" : "Escuchando", "ready");
  setButtons();
});

if (navigator.mediaDevices?.addEventListener) {
  navigator.mediaDevices.addEventListener("devicechange", () => {
    refreshMicDevices().catch(() => {});
  });
}

window.addEventListener("pointerdown", resumeMicContext);
window.addEventListener("keydown", resumeMicContext);

window.addEventListener("beforeunload", () => {
  stopSession();
  clearBlinkTimers();
  stopOvrLipSync();
  stopAudio2Face();
  if (state.animationFrame) cancelAnimationFrame(state.animationFrame);
  if (state.renderer) state.renderer.dispose();
});

restoreSettings();
refreshMicDevices().catch(() => {});
setButtons();
updateMetricsButtons();
initThree();
loadAvatar().catch((error) => {
  console.error(error);
  setStatus(error.message || "No se pudo cargar el avatar", "error");
});
