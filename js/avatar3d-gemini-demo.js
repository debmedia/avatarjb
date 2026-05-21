const PARAMS = new URLSearchParams(window.location.search);
const DEFAULT_MODEL = PARAMS.get("model")
  || PARAMS.get("geminiModel")
  || "gemini-2.5-flash-native-audio-preview-12-2025";
const STORAGE_KEY = "avatar_live_gemini_api_key";
const LIVEAVATAR_ID_STORAGE_KEY = "avatar_live_liveavatar_id";
const LIVEAVATAR_SCOPE_STORAGE_KEY = "avatar_live_liveavatar_scope";
const LIVEAVATAR_BRIDGE_URL = PARAMS.get("liveAvatarBridgeUrl") || "ws://127.0.0.1:8788/liveavatar";
const LIVEAVATAR_SCOPES = new Set(["public", "user"]);
const DEFAULT_LIVEAVATAR_SCOPE = LIVEAVATAR_SCOPES.has(PARAMS.get("liveAvatarScope"))
  ? PARAMS.get("liveAvatarScope")
  : "public";
const DEFAULT_LIVEAVATAR_ID = PARAMS.get("liveAvatarId") || localStorage.getItem(LIVEAVATAR_ID_STORAGE_KEY) || "";
const BANKING_TOOL_NAME = "consultar_flujo_bancario";
const ENABLE_GEMINI_TOOLS = PARAMS.get("tools") !== "0" && PARAMS.get("useTools") !== "0";
const SHOW_ACTION_BUTTONS = PARAMS.get("showButtons") !== "0";
const AUTO_START_LIVEAVATAR = ["1", "true"].includes(String(PARAMS.get("autoLiveAvatar") || "").toLowerCase());
const GEMINI_AUTH_MODE = PARAMS.get("geminiAuth") || "ephemeral";

const elements = {
  liveAvatarStage: document.getElementById("liveAvatarStage"),
  liveAvatarVideo: document.getElementById("liveAvatarVideo"),
  liveAvatarPlaceholder: document.getElementById("liveAvatarPlaceholder"),
  liveAvatarScopeSelect: document.getElementById("liveAvatarScopeSelect"),
  liveAvatarSelect: document.getElementById("liveAvatarSelect"),
  refreshLiveAvatarsButton: document.getElementById("refreshLiveAvatarsButton"),
  connectAvatarButton: document.getElementById("connectAvatarButton"),
  liveAvatarPickerStatus: document.getElementById("liveAvatarPickerStatus"),
  micSelect: document.getElementById("micSelect"),
  apiKeyInput: document.getElementById("apiKeyInput"),
  voiceSelect: document.getElementById("voiceSelect"),
  promptInput: document.getElementById("promptInput"),
  startButton: document.getElementById("startButton"),
  muteButton: document.getElementById("muteButton"),
  stopButton: document.getElementById("stopButton"),
  statusText: document.getElementById("statusText"),
  statusDot: document.getElementById("statusDot"),
  actionPanel: document.getElementById("actionPanel"),
  liveAvatarStatus: document.getElementById("liveAvatarStatus"),
  micStatus: document.getElementById("micStatus"),
  geminiStatus: document.getElementById("geminiStatus"),
};

const state = {
  geminiSocket: null,
  geminiReady: false,
  geminiEndpointWaiters: [],
  starting: false,
  muted: false,
  closingManually: false,
  bridgeSocket: null,
  bridgeReady: false,
  liveAvatarStarting: false,
  liveAvatarConnected: false,
  liveAvatarHasVideo: false,
  liveAvatarRoom: null,
  liveAvatarMediaStream: null,
  liveAvatarCommandSocket: null,
  liveAvatarCommandReady: false,
  liveAvatarCommandQueue: [],
  liveAvatarKeepAliveTimer: 0,
  liveAvatarAudioChunksSent: 0,
  liveAvatarTurn: 0,
  liveAvatarScope: DEFAULT_LIVEAVATAR_SCOPE,
  liveAvatarId: DEFAULT_LIVEAVATAR_ID,
  liveAvatarAvatars: [],
  liveAvatarAutoStart: AUTO_START_LIVEAVATAR,
  liveAvatarWaiters: [],
  autostartTimer: 0,
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
  responseTranscript: "",
  lastUserText: "",
  lastGeminiSend: "none",
  actionPayload: null,
  bankingFlow: {
    accountType: "",
    ageConfirmed: false,
    usingMockData: false,
  },
};

function setStatus(text, mode = "idle") {
  elements.statusText.textContent = text;
  elements.statusDot.classList.toggle("is-ready", mode === "ready");
  elements.statusDot.classList.toggle("is-error", mode === "error");
}

function setBridgeStatus(text, mode = "idle") {
  elements.liveAvatarStatus.textContent = `LiveAvatar: ${text}`;
  elements.liveAvatarStatus.classList.toggle("is-ready", mode === "ready");
  elements.liveAvatarStatus.classList.toggle("is-error", mode === "error");
}

function setGeminiStatus(text, mode = "idle") {
  elements.geminiStatus.textContent = `Gemini: ${text}`;
  elements.geminiStatus.classList.toggle("is-ready", mode === "ready");
  elements.geminiStatus.classList.toggle("is-error", mode === "error");
}

function setMicStatus(text, mode = "idle") {
  elements.micStatus.textContent = `Microfono: ${text}`;
  elements.micStatus.classList.toggle("is-ready", mode === "ready");
  elements.micStatus.classList.toggle("is-error", mode === "error");
}

function setPlaceholder(text) {
  if (elements.liveAvatarPlaceholder) {
    elements.liveAvatarPlaceholder.textContent = text;
  }
}

function setButtons() {
  elements.startButton.disabled = state.starting || state.geminiReady;
  elements.stopButton.disabled = !state.geminiSocket && !state.geminiReady && !state.liveAvatarConnected && !state.starting;
  elements.muteButton.disabled = !state.geminiReady;
  elements.muteButton.textContent = state.muted ? "Activar" : "Mutear";
  elements.connectAvatarButton.disabled = state.liveAvatarStarting || !state.bridgeReady || !state.liveAvatarId;
  elements.connectAvatarButton.textContent = state.liveAvatarStarting ? "Conectando..." : "Conectar avatar";
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

function clearActionPanel() {
  state.actionPayload = null;
  document.body.classList.remove("has-action-panel");
  elements.actionPanel.hidden = true;
  elements.actionPanel.innerHTML = "";
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
  setBridgeStatus(`UI con ${buttons.length} botones`, "ready");
}

function maybeRenderActionPanelFromText(text) {
  if (state.actionPayload) return;
  const payload = actionPayloadFromAssistantText(text);
  if (payload) renderActionPanel(payload);
}

function handleActionButtonClick(button) {
  if (!button?.value) return;
  clearActionPanel();
  setStatus("Opcion enviada", state.geminiReady ? "ready" : "idle");
  sendClientText(button.value);
}

function resetBankingFlow() {
  state.bankingFlow = {
    accountType: "",
    ageConfirmed: false,
    usingMockData: false,
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
      [{ label: "Empezar de nuevo", value: "Reiniciar flujo bancario" }],
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

function liveAvatarClient() {
  return window.LivekitClient || window.LiveKitClient || null;
}

function liveAvatarLabel(avatar = {}) {
  return String(
    avatar.name
      || avatar.display_name
      || avatar.displayName
      || avatar.avatar_name
      || avatar.title
      || avatar.id
      || avatar.avatar_id
      || "",
  ).trim();
}

function liveAvatarId(avatar = {}) {
  return String(avatar.id || avatar.avatar_id || avatar.avatarId || "").trim();
}

function setLiveAvatarPickerStatus(text) {
  elements.liveAvatarPickerStatus.textContent = text;
}

function updateLiveAvatarSelector(avatars = state.liveAvatarAvatars) {
  elements.liveAvatarSelect.innerHTML = "";
  if (!avatars.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No hay avatares para este filtro";
    elements.liveAvatarSelect.appendChild(option);
    state.liveAvatarId = "";
    setButtons();
    return;
  }

  avatars.forEach((avatar) => {
    const id = liveAvatarId(avatar);
    if (!id) return;
    const option = document.createElement("option");
    option.value = id;
    option.textContent = liveAvatarLabel(avatar) || id;
    if (id === state.liveAvatarId) option.selected = true;
    elements.liveAvatarSelect.appendChild(option);
  });

  if (!state.liveAvatarId || ![...elements.liveAvatarSelect.options].some((option) => option.value === state.liveAvatarId)) {
    selectLiveAvatar(elements.liveAvatarSelect.value, { notifyBridge: false });
  } else {
    elements.liveAvatarSelect.value = state.liveAvatarId;
  }
  setButtons();
}

function handleLiveAvatarList(message = {}) {
  const scope = LIVEAVATAR_SCOPES.has(message.scope) ? message.scope : state.liveAvatarScope;
  if (scope !== state.liveAvatarScope) return;
  state.liveAvatarAvatars = Array.isArray(message.avatars) ? message.avatars : [];
  updateLiveAvatarSelector();
  setLiveAvatarPickerStatus(`${state.liveAvatarAvatars.length} avatares`);
  queueLiveAvatarAutostart();
}

function liveAvatarCommandUrl(payload = {}) {
  return payload.ws_url || payload.wsUrl || payload.websocket_url || payload.websocketUrl || "";
}

function sendLiveAvatarCommand(payload = {}) {
  const socket = state.liveAvatarCommandSocket;
  if (!socket || socket.readyState !== WebSocket.OPEN || !state.liveAvatarCommandReady) {
    if (payload.type !== "session.keep_alive" && state.liveAvatarCommandQueue.length < 16) {
      state.liveAvatarCommandQueue.push(payload);
      return true;
    }
    return false;
  }
  socket.send(JSON.stringify(payload));
  return true;
}

function flushLiveAvatarCommandQueue() {
  if (!state.liveAvatarCommandQueue.length) return;
  const queued = state.liveAvatarCommandQueue.splice(0);
  queued.forEach((payload) => sendLiveAvatarCommand(payload));
}

function closeLiveAvatarCommandSocket() {
  window.clearInterval(state.liveAvatarKeepAliveTimer);
  state.liveAvatarKeepAliveTimer = 0;
  state.liveAvatarCommandQueue = [];
  state.liveAvatarCommandReady = false;
  if (state.liveAvatarCommandSocket) {
    try {
      state.liveAvatarCommandSocket.close();
    } catch {
      // Ignore close errors.
    }
  }
  state.liveAvatarCommandSocket = null;
}

function connectLiveAvatarCommandSocket(wsUrl) {
  closeLiveAvatarCommandSocket();
  if (!wsUrl) {
    setBridgeStatus("sesion sin ws_url de audio", "error");
    return;
  }

  const socket = new WebSocket(wsUrl);
  state.liveAvatarCommandSocket = socket;
  state.liveAvatarCommandReady = false;
  setBridgeStatus("conectando audio directo");

  socket.onopen = () => {
    // The provider may also emit session.state_updated=connected; open is enough
    // to avoid adding backend latency before the first Gemini audio chunks.
    state.liveAvatarCommandReady = true;
    setBridgeStatus("audio directo listo", "ready");
    flushLiveAvatarCommandQueue();
    state.liveAvatarKeepAliveTimer = window.setInterval(() => {
      sendLiveAvatarCommand({
        type: "session.keep_alive",
        event_id: `keepalive-${Date.now()}`,
      });
    }, 45000);
  };
  socket.onmessage = (event) => {
    try {
      handleProviderEvent(JSON.parse(event.data));
    } catch (error) {
      console.debug("LiveAvatar direct WS message ignored:", error);
    }
  };
  socket.onerror = () => {
    state.liveAvatarCommandReady = false;
    setBridgeStatus("audio directo con error", "error");
  };
  socket.onclose = () => {
    window.clearInterval(state.liveAvatarKeepAliveTimer);
    state.liveAvatarKeepAliveTimer = 0;
    state.liveAvatarCommandReady = false;
    state.liveAvatarCommandSocket = null;
    setBridgeStatus("audio directo cerrado");
  };
}

function connectLiveAvatarRoom(payload = {}) {
  const client = liveAvatarClient();
  if (!client) {
    throw new Error("No se cargo LiveKit client en el navegador.");
  }
  const url = payload.url || payload.livekitUrl || payload.livekit_url;
  const token = payload.access_token || payload.accessToken || payload.token;
  if (!url || !token) {
    throw new Error("El bridge no devolvio url/token LiveKit.");
  }

  if (state.liveAvatarRoom) {
    state.liveAvatarRoom.disconnect();
  }

  const room = new client.Room({ adaptiveStream: true, dynacast: true });
  const mediaStream = new MediaStream();
  state.liveAvatarRoom = room;
  state.liveAvatarMediaStream = mediaStream;
  state.liveAvatarConnected = false;
  state.liveAvatarHasVideo = false;
  connectLiveAvatarCommandSocket(liveAvatarCommandUrl(payload));
  elements.liveAvatarStage.classList.remove("has-stream");
  setPlaceholder("Conectando video LiveAvatar...");

  room.on(client.RoomEvent.TrackSubscribed, (track) => {
    if (track.kind !== "video" && track.kind !== "audio") return;
    mediaStream.addTrack(track.mediaStreamTrack);
    elements.liveAvatarVideo.srcObject = mediaStream;
    state.liveAvatarHasVideo = mediaStream.getVideoTracks().length > 0;
    elements.liveAvatarStage.classList.toggle("has-stream", state.liveAvatarHasVideo);
    elements.liveAvatarVideo.play().catch(() => {
      setPlaceholder("Toca Iniciar para habilitar audio/video del avatar");
    });
  });
  room.on(client.RoomEvent.TrackUnsubscribed, (track) => {
    if (track.mediaStreamTrack) mediaStream.removeTrack(track.mediaStreamTrack);
    state.liveAvatarHasVideo = mediaStream.getVideoTracks().length > 0;
    elements.liveAvatarStage.classList.toggle("has-stream", state.liveAvatarHasVideo);
  });
  room.on(client.RoomEvent.Disconnected, () => {
    state.liveAvatarConnected = false;
    state.liveAvatarHasVideo = false;
    elements.liveAvatarStage.classList.remove("has-stream");
    setBridgeStatus("WebRTC desconectado");
    setPlaceholder("LiveAvatar desconectado");
    rejectLiveAvatarWaiters(new Error("LiveAvatar WebRTC desconectado"));
    setButtons();
  });

  return room.connect(url, token).then(() => {
    state.liveAvatarConnected = true;
    state.liveAvatarStarting = false;
    if (payload.avatarId) {
      selectLiveAvatar(payload.avatarId, { notifyBridge: false });
    }
    setBridgeStatus(payload.fallback ? "conectado con avatar sandbox demo" : "video conectado", "ready");
    setStatus("LiveAvatar listo", "ready");
    setPlaceholder("Video conectado, esperando track...");
    resolveLiveAvatarWaiters();
    setButtons();
  });
}

function resolveLiveAvatarWaiters() {
  const waiters = state.liveAvatarWaiters.splice(0);
  waiters.forEach(({ resolve, timeout }) => {
    window.clearTimeout(timeout);
    resolve();
  });
}

function rejectLiveAvatarWaiters(error) {
  const waiters = state.liveAvatarWaiters.splice(0);
  waiters.forEach(({ reject, timeout }) => {
    window.clearTimeout(timeout);
    reject(error);
  });
}

function handleProviderEvent(event = {}) {
  if (event.type === "error") {
    const message = event.error?.message || event.message || "error LiveAvatar audio";
    setBridgeStatus(`audio directo error: ${message}`, "error");
    return;
  }
  if (event.type === "session.state_updated") {
    state.liveAvatarCommandReady = event.state === "connected" || state.liveAvatarCommandReady;
    if (state.liveAvatarCommandReady) flushLiveAvatarCommandQueue();
    setBridgeStatus(`estado ${event.state || "desconocido"}`, event.state === "connected" ? "ready" : "idle");
    return;
  }
  if (event.type === "agent.audio_buffer_appended") {
    setBridgeStatus(`audio recibido (${state.liveAvatarAudioChunksSent} chunks)`, "ready");
    return;
  }
  if (event.type === "agent.audio_buffer_committed") {
    setBridgeStatus("audio confirmado", "ready");
    return;
  }
  if (event.type === "agent.speak_started") {
    setBridgeStatus("hablando", "ready");
    return;
  }
  if (event.type === "agent.speak_ended") {
    setBridgeStatus("escuchando", "ready");
  }
}

function handleLiveAvatarBridgeMessage(message = {}) {
  if (message.config?.geminiApiKey) {
    const envKey = String(message.config.geminiApiKey).trim();
    const currentKey = elements.apiKeyInput.value.trim();
    if (envKey && currentKey !== envKey) {
      elements.apiKeyInput.value = envKey;
      localStorage.setItem(STORAGE_KEY, envKey);
      setLiveAvatarPickerStatus(currentKey ? "Gemini key actualizada desde .env" : "Gemini key cargada desde .env");
    }
  }
  if (message.config?.liveAvatarId && !state.liveAvatarId) {
    selectLiveAvatar(message.config.liveAvatarId, { notifyBridge: false });
  }
  if (typeof message.config?.autoStart === "boolean") {
    state.liveAvatarAutoStart = AUTO_START_LIVEAVATAR && message.config.autoStart;
  }

  if (message.type === "ready") {
    state.bridgeReady = true;
    setBridgeStatus(message.message || "bridge listo", "ready");
    requestLiveAvatarAvatars();
    setButtons();
    return;
  }
  if (message.type === "status") {
    setBridgeStatus(message.message || "estado bridge");
    return;
  }
  if (message.type === "error") {
    if (message.source === "gemini_token") {
      rejectGeminiEndpointWaiters(new Error(message.message || "No se pudo crear token Gemini."));
    }
    state.liveAvatarStarting = false;
    const error = new Error(message.message || "error bridge");
    setBridgeStatus(error.message, "error");
    setLiveAvatarPickerStatus(error.message);
    setPlaceholder(error.message);
    rejectLiveAvatarWaiters(error);
    setButtons();
    return;
  }
  if (message.type === "gemini_token") {
    const endpoint = String(message.endpoint || "").trim();
    if (!endpoint) {
      rejectGeminiEndpointWaiters(new Error("Bridge no devolvio endpoint Gemini."));
      return;
    }
    setGeminiStatus(message.message || "token efimero listo", "ready");
    resolveGeminiEndpointWaiters({ endpoint, auth: message.auth || "ephemeral" });
    return;
  }
  if (message.type === "avatars") {
    handleLiveAvatarList(message);
    return;
  }
  if (message.type === "provider_event") {
    handleProviderEvent(message.event || {});
    return;
  }
  if (message.type === "session" || message.type === "livekit") {
    connectLiveAvatarRoom(message).catch((error) => {
      state.liveAvatarStarting = false;
      setBridgeStatus(error.message || "no se pudo conectar WebRTC", "error");
      setPlaceholder(error.message || "No se pudo conectar LiveAvatar");
      rejectLiveAvatarWaiters(error);
      setButtons();
    });
  }
}

function connectLiveAvatarBridge() {
  if (state.bridgeSocket && state.bridgeSocket.readyState <= WebSocket.OPEN) return;
  const socket = new WebSocket(LIVEAVATAR_BRIDGE_URL);
  state.bridgeSocket = socket;
  state.bridgeReady = false;
  setBridgeStatus("conectando bridge");

  socket.onopen = () => {
    socket.send(JSON.stringify({
      type: "hello",
      mode: "liveavatar_lite",
      avatarId: state.liveAvatarId,
      avatarScope: state.liveAvatarScope,
      audio: { mimeType: "audio/pcm;rate=24000" },
    }));
  };
  socket.onmessage = (event) => {
    try {
      handleLiveAvatarBridgeMessage(JSON.parse(event.data));
    } catch (error) {
      console.debug("LiveAvatar bridge message ignored:", error);
    }
  };
  socket.onerror = () => {
    state.bridgeReady = false;
    const error = new Error("bridge local no disponible");
    setBridgeStatus(error.message, "error");
    rejectLiveAvatarWaiters(error);
    setButtons();
  };
  socket.onclose = () => {
    state.bridgeSocket = null;
    state.bridgeReady = false;
    state.liveAvatarConnected = false;
    state.liveAvatarStarting = false;
    rejectGeminiEndpointWaiters(new Error("Bridge local cerrado antes de entregar token Gemini."));
    setBridgeStatus("bridge cerrado");
    setButtons();
  };
}

function sendLiveAvatarBridgeMessage(payload = {}) {
  if (!state.bridgeSocket || state.bridgeSocket.readyState !== WebSocket.OPEN) return false;
  state.bridgeSocket.send(JSON.stringify(payload));
  return true;
}

function rejectGeminiEndpointWaiters(error) {
  const waiters = state.geminiEndpointWaiters.splice(0);
  waiters.forEach(({ reject, timeout }) => {
    window.clearTimeout(timeout);
    reject(error);
  });
}

function resolveGeminiEndpointWaiters(endpoint) {
  const waiters = state.geminiEndpointWaiters.splice(0);
  waiters.forEach(({ resolve, timeout }) => {
    window.clearTimeout(timeout);
    resolve(endpoint);
  });
}

function requestGeminiEndpoint(timeoutMs = 15000) {
  if (GEMINI_AUTH_MODE === "apiKey") {
    return Promise.resolve({
      auth: "api-key",
      endpoint: geminiEndpoint(),
    });
  }

  if (!state.bridgeSocket || state.bridgeSocket.readyState !== WebSocket.OPEN) {
    connectLiveAvatarBridge();
  }

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error("Timeout solicitando token efimero de Gemini."));
    }, timeoutMs);
    state.geminiEndpointWaiters.push({ resolve, reject, timeout });
    if (!sendLiveAvatarBridgeMessage({ type: "gemini_token" })) {
      window.clearTimeout(timeout);
      state.geminiEndpointWaiters = state.geminiEndpointWaiters.filter((waiter) => waiter.resolve !== resolve);
      reject(new Error("Bridge local no disponible para token Gemini."));
    }
  });
}

function requestLiveAvatarAvatars() {
  setLiveAvatarPickerStatus("Cargando...");
  if (!sendLiveAvatarBridgeMessage({ type: "list_avatars", scope: state.liveAvatarScope })) {
    connectLiveAvatarBridge();
  }
}

function queueLiveAvatarAutostart() {
  if (!state.liveAvatarAutoStart || !state.liveAvatarId || state.liveAvatarConnected || state.liveAvatarStarting) return;
  window.clearTimeout(state.autostartTimer);
  state.autostartTimer = window.setTimeout(() => {
    startLiveAvatarSession();
  }, 350);
}

function selectLiveAvatar(id, options = {}) {
  state.liveAvatarId = String(id || "").trim();
  if (elements.liveAvatarSelect.value !== state.liveAvatarId) {
    elements.liveAvatarSelect.value = state.liveAvatarId;
  }
  if (state.liveAvatarId) {
    localStorage.setItem(LIVEAVATAR_ID_STORAGE_KEY, state.liveAvatarId);
  }
  if (options.notifyBridge !== false) {
    sendLiveAvatarBridgeMessage({
      type: "select_avatar",
      avatarId: state.liveAvatarId,
      scope: state.liveAvatarScope,
    });
  }
  setButtons();
}

function startLiveAvatarSession(force = false) {
  if (state.liveAvatarStarting) return true;
  if (state.liveAvatarConnected && !force) return true;
  if (!state.liveAvatarId) {
    setBridgeStatus("selecciona un avatar", "error");
    return false;
  }
  if (!sendLiveAvatarBridgeMessage({
    type: "start_session",
    avatarId: state.liveAvatarId,
    scope: state.liveAvatarScope,
  })) {
    connectLiveAvatarBridge();
    return false;
  }
  state.liveAvatarStarting = true;
  state.liveAvatarConnected = false;
  state.liveAvatarHasVideo = false;
  elements.liveAvatarStage.classList.remove("has-stream");
  setBridgeStatus("creando sesion LiveAvatar");
  setPlaceholder("Creando sesion LiveAvatar...");
  setButtons();
  return true;
}

function waitForLiveAvatarSession(timeoutMs = 30000) {
  if (state.liveAvatarConnected) return Promise.resolve();
  startLiveAvatarSession();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error("Timeout esperando LiveAvatar."));
    }, timeoutMs);
    state.liveAvatarWaiters.push({ resolve, reject, timeout });
  });
}

function sendToLiveAvatar(base64) {
  const ok = sendLiveAvatarCommand({
    type: "agent.speak",
    event_id: `turn-${state.liveAvatarTurn + 1}`,
    audio: base64,
  });
  if (!ok) {
    setBridgeStatus("audio Gemini recibido pero LiveAvatar WS no esta listo", "error");
    return false;
  }
  state.liveAvatarAudioChunksSent += 1;
  return true;
}

function endLiveAvatarTurn() {
  sendLiveAvatarCommand({
    type: "agent.speak_end",
    event_id: `turn-${state.liveAvatarTurn + 1}`,
  });
  state.liveAvatarTurn += 1;
}

function stopLiveAvatarSession() {
  closeLiveAvatarCommandSocket();
  sendLiveAvatarBridgeMessage({ type: "stop_session" });
  if (state.liveAvatarRoom) {
    state.liveAvatarRoom.disconnect();
  }
  state.liveAvatarRoom = null;
  state.liveAvatarMediaStream = null;
  state.liveAvatarConnected = false;
  state.liveAvatarHasVideo = false;
  state.liveAvatarStarting = false;
  elements.liveAvatarVideo.srcObject = null;
  elements.liveAvatarStage.classList.remove("has-stream");
  setPlaceholder("LiveAvatar detenido");
  rejectLiveAvatarWaiters(new Error("LiveAvatar detenido"));
  setButtons();
}

function buildGeminiSystemPrompt() {
  const basePrompt = elements.promptInput.value.trim();
  const toolRules = state.geminiToolsEnabled
    ? [
        "Regla obligatoria de herramienta:",
        `- Para avanzar la simulacion bancaria, llama silenciosamente ${BANKING_TOOL_NAME}.`,
        "- La herramienta puede recibir un argumento message con el ultimo texto del usuario.",
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
  return [basePrompt, "", ...toolRules].filter(Boolean).join("\n");
}

function bankingToolDeclaration() {
  return {
    functionDeclarations: [
      {
        name: BANKING_TOOL_NAME,
        description: "Consulta silenciosa del flujo de simulacion bancaria. Devuelve texto para hablar y UI estructurada con form/buttons para renderizar en la pagina.",
        parameters: {
          type: "OBJECT",
          properties: {
            message: {
              type: "STRING",
              description: "Ultimo mensaje o intencion del usuario.",
            },
          },
        },
      },
    ],
  };
}

function buildGeminiSetup() {
  const setup = {
    setup: {
      model: `models/${DEFAULT_MODEL}`,
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

function sendGeminiMessage(payload, label) {
  if (!state.geminiSocket || state.geminiSocket.readyState !== WebSocket.OPEN) return false;
  state.lastGeminiSend = label;
  state.geminiSocket.send(JSON.stringify(payload));
  return true;
}

function sendClientText(text) {
  const value = String(text || "").trim();
  if (!value) return;
  state.lastUserText = value;
  sendGeminiMessage({
    clientContent: {
      turns: [
        {
          role: "user",
          parts: [{ text: value }],
        },
      ],
      turnComplete: true,
    },
  }, "clientContent.text");
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
    value.includes(BANKING_TOOL_NAME.toLowerCase())
    || value.includes("function call")
    || value.includes("tool call")
    || value.includes('"buttons"')
    || value.includes('"label"')
    || value.includes('"value"')
  );
}

function argsFromFunctionCall(functionCall) {
  const args = functionCall?.args || functionCall?.arguments || {};
  if (typeof args === "string") {
    return tryParseStructuredJson(args) || { message: args };
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

async function executeFunctionCall(functionCall) {
  if (functionCall.name !== BANKING_TOOL_NAME) {
    return {
      id: functionCall.id,
      name: functionCall.name,
      response: { error: "Funcion no disponible en este avatar." },
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
  if (!calls.length || !state.geminiSocket || state.geminiSocket.readyState !== WebSocket.OPEN) return;
  const functionResponses = [];
  for (const call of calls) {
    functionResponses.push(await executeFunctionCall(call));
  }
  sendGeminiMessage({
    toolResponse: { functionResponses },
  }, "toolResponse");
}

function handleGeminiClose(event) {
  const code = event?.code ? `codigo ${event.code}` : "sin codigo";
  const reason = event?.reason ? `: ${event.reason}` : "";
  const lastSend = state.lastGeminiSend ? ` ultimo envio: ${state.lastGeminiSend}` : "";
  const message = `Gemini cerro la sesion (${code}${reason}${lastSend})`;
  state.geminiReady = false;
  state.geminiSocket = null;
  stopMicCapture();
  clearActionPanel();
  setGeminiStatus(state.closingManually ? "sesion cerrada" : message, state.closingManually ? "idle" : "error");
  setStatus(state.closingManually ? "Sesion cerrada" : message, state.closingManually ? "idle" : "error");
  state.closingManually = false;
  setButtons();
}

async function handleGeminiMessage(rawEvent) {
  const rawText = typeof rawEvent.data === "string" ? rawEvent.data : await rawEvent.data.text();
  const message = JSON.parse(rawText);

  if (message.setupComplete) {
    state.geminiReady = true;
    if (state.geminiSocket?.__setupResolve) {
      state.geminiSocket.__setupResolve();
      state.geminiSocket.__setupResolve = null;
      state.geminiSocket.__setupReject = null;
    }
    setGeminiStatus("conectado", "ready");
    setButtons();
    return;
  }

  const toolCall = message.toolCall || message.tool_call;
  if (toolCall) {
    await handleToolCall(toolCall);
  }

  const content = message.serverContent;
  if (content) {
    if (content.interrupted) {
      sendLiveAvatarCommand({ type: "agent.interrupt" });
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
      sendLiveAvatarCommand({ type: "agent.interrupt" });
      setGeminiStatus("tool hablada bloqueada", "error");
    }
    parts.forEach((part) => {
      const inlineData = part.inlineData || part.inline_data;
      if (!leakedToolSpeech && inlineData?.data) {
        sendToLiveAvatar(inlineData.data);
      }
    });
    if (outputTranscript?.text && !leakedToolSpeech) {
      state.responseTranscript += outputTranscript.text;
      maybeRenderActionPanelFromText(state.responseTranscript);
    }
    if (content.turnComplete && state.geminiReady) {
      endLiveAvatarTurn();
      state.responseTranscript = "";
      setGeminiStatus(state.muted ? "microfono muteado" : "escuchando", "ready");
      setStatus(state.muted ? "Microfono muteado" : "Escuchando", "ready");
    }
  }

  if (message.error) {
    const detail = message.error.message || message.error.status || "Error de Gemini";
    if (state.geminiSocket?.__setupReject) {
      state.geminiSocket.__setupReject(new Error(detail));
    }
    setGeminiStatus(detail, "error");
    setStatus(detail, "error");
  }
}

async function startSession() {
  if (state.starting || state.geminiReady) return;
  state.starting = true;
  state.closingManually = false;
  state.responseTranscript = "";
  state.lastUserText = "";
  state.lastGeminiSend = "none";
  state.geminiToolsEnabled = ENABLE_GEMINI_TOOLS;
  resetBankingFlow();
  clearActionPanel();
  setButtons();

  try {
    connectLiveAvatarBridge();
    setStatus("Conectando LiveAvatar");
    await waitForLiveAvatarSession(35000);

    setStatus("Activando microfono");
    await startMicCapture();

    setStatus(`Solicitando token Gemini (${DEFAULT_MODEL}${state.geminiToolsEnabled ? " + tools" : ""})`);
    setGeminiStatus(GEMINI_AUTH_MODE === "apiKey" ? "conectando con API key" : "pidiendo token efimero");
    const geminiConnection = await requestGeminiEndpoint();
    setStatus(`Conectando Gemini (${geminiConnection.auth || "ephemeral"})`);
    setGeminiStatus("conectando");
    const socket = new WebSocket(geminiConnection.endpoint);
    state.geminiSocket = socket;

    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = () => reject(new Error("No se pudo abrir la conexion con Gemini Live."));
    });

    socket.onmessage = handleGeminiMessage;
    socket.onerror = () => {
      if (socket.__setupReject) {
        socket.__setupReject(new Error("Gemini Live rechazo la conexion."));
      }
      setGeminiStatus("error de conexion", "error");
      setStatus("Error de conexion", "error");
    };
    socket.onclose = handleGeminiClose;

    const setupReady = new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("Timeout esperando setupComplete.")), 45000);
      socket.__setupResolve = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      socket.__setupReject = reject;
    });

    sendGeminiMessage(buildGeminiSetup(), "setup");
    await setupReady;
    setStatus("Escuchando", "ready");
    setGeminiStatus("escuchando", "ready");
    updateMicStatus();
  } catch (error) {
    await stopSession({ keepAvatar: true });
    setStatus(error.message || "Error iniciando demo", "error");
    setGeminiStatus(error.message || "error", "error");
  } finally {
    state.starting = false;
    setButtons();
  }
}

async function stopSession(options = {}) {
  state.geminiReady = false;
  state.responseTranscript = "";
  state.lastUserText = "";
  clearActionPanel();
  stopMicCapture();

  if (state.geminiSocket) {
    const socket = state.geminiSocket;
    state.geminiSocket = null;
    state.closingManually = true;
    try {
      socket.close();
    } catch {
      // Ignore close errors.
    }
  }
  if (!options.keepAvatar) {
    stopLiveAvatarSession();
  }
  setButtons();
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
    return "El navegador bloqueo el microfono. Revisa el permiso del sitio y Windows > Privacidad > Microfono.";
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
  setMicStatus("pidiendo permiso");
  state.micContext = new AudioContextCtor();
  await state.micContext.resume().catch(() => {});
  try {
    state.micStream = await navigator.mediaDevices.getUserMedia({ audio: buildMicConstraints() });
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
  state.micStatusTimer = window.setInterval(updateMicStatus, 700);
  updateMicStatus();
}

function stopMicCapture() {
  window.clearInterval(state.micStatusTimer);
  state.micStatusTimer = 0;
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
  setMicStatus("detenido");
}

function updateMicStatus() {
  if (!state.micStream) return;
  const percent = Math.round(state.micLastLevel * 100);
  const mode = state.muted ? "muteado" : state.geminiReady ? "enviando" : "capturando";
  const contextState = state.micContext?.state === "suspended" ? " (audio suspendido)" : "";
  setMicStatus(`${mode} ${percent}% (captura ${state.micFramesCaptured}, envio ${state.micFramesSent})${contextState}`, state.geminiReady ? "ready" : "idle");
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
  if (!state.geminiReady || !state.geminiSocket || state.geminiSocket.readyState !== WebSocket.OPEN || state.muted) {
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
  sendGeminiMessage({
    realtimeInput: {
      audio: {
        data: bytesToBase64(pcm16),
        mimeType: "audio/pcm;rate=16000",
      },
    },
  }, "realtimeInput.audio");
  state.micFramesSent += 1;
}

function getAudioLevel(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    sum += samples[i] * samples[i];
  }
  return Math.max(0, Math.min(1, (Math.sqrt(sum / Math.max(1, samples.length)) - 0.01) * 18));
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

function restoreSettings() {
  const savedKey = localStorage.getItem(STORAGE_KEY);
  if (savedKey) elements.apiKeyInput.value = savedKey;
  elements.liveAvatarScopeSelect.value = state.liveAvatarScope;
  if (state.liveAvatarId) {
    const option = document.createElement("option");
    option.value = state.liveAvatarId;
    option.textContent = state.liveAvatarId;
    option.selected = true;
    elements.liveAvatarSelect.innerHTML = "";
    elements.liveAvatarSelect.appendChild(option);
  }
}

function changeLiveAvatarScope(scope) {
  if (!LIVEAVATAR_SCOPES.has(scope)) return;
  state.liveAvatarScope = scope;
  state.liveAvatarAvatars = [];
  localStorage.setItem(LIVEAVATAR_SCOPE_STORAGE_KEY, scope);
  updateLiveAvatarSelector([]);
  requestLiveAvatarAvatars();
}

elements.startButton.addEventListener("click", startSession);
elements.stopButton.addEventListener("click", () => stopSession());
elements.muteButton.addEventListener("click", () => {
  state.muted = !state.muted;
  setStatus(state.muted ? "Microfono muteado" : "Escuchando", "ready");
  updateMicStatus();
  setButtons();
});
elements.refreshLiveAvatarsButton.addEventListener("click", requestLiveAvatarAvatars);
elements.connectAvatarButton.addEventListener("click", () => startLiveAvatarSession(true));
elements.liveAvatarScopeSelect.addEventListener("change", (event) => {
  changeLiveAvatarScope(event.target.value);
});
elements.liveAvatarSelect.addEventListener("change", (event) => {
  selectLiveAvatar(event.target.value);
  startLiveAvatarSession(true);
});
if (elements.micSelect) {
  elements.micSelect.addEventListener("change", async () => {
    if (!state.micStream) return;
    try {
      stopMicCapture();
      await startMicCapture();
    } catch (error) {
      await stopSession({ keepAvatar: true });
      setStatus(error.message || "No se pudo cambiar el microfono", "error");
    }
  });
}

if (navigator.mediaDevices?.addEventListener) {
  navigator.mediaDevices.addEventListener("devicechange", () => {
    refreshMicDevices().catch(() => {});
  });
}

window.addEventListener("pointerdown", resumeMicContext);
window.addEventListener("keydown", resumeMicContext);
window.addEventListener("beforeunload", () => {
  stopSession();
  if (state.bridgeSocket) {
    try {
      state.bridgeSocket.close();
    } catch {
      // Ignore close errors.
    }
  }
});

restoreSettings();
setStatus("Listo para iniciar");
setButtons();
connectLiveAvatarBridge();
refreshMicDevices().catch(() => {});
