(function () {
  "use strict";

  var DEFAULT_MODEL = "gemini-3.1-flash-live-preview";
  var DEFAULT_ANAM_SDK_URL = "https://esm.sh/@anam-ai/js-sdk@latest";
  var DEFAULT_TALKING_HEAD_MODULE = "talkinghead";
  var DEFAULT_TALKING_HEAD_AVATAR_URL = "https://cdn.jsdelivr.net/gh/met4citizen/TalkingHead@1.7/avatars/brunette.glb";
  var TOOL_NAME = "consultar_journey_builder";
  var TOOL_WAIT_PHRASE = "Esperame un momento, por favor.";
  var MAX_SCREEN_WIDTH = 960;
  var SCREEN_FRAME_INTERVAL_MS = 1200;
  var DEFAULT_ANAM_SAMPLE_RATE = 16000;

  var state = {
    socket: null,
    ready: false,
    open: false,
    muted: false,
    starting: false,
    speaking: false,
    pendingMicAfterGreeting: false,
    micStream: null,
    micContext: null,
    micSource: null,
    micProcessor: null,
    micRemainder: new Float32Array(0),
    playbackContext: null,
    playbackGain: null,
    playbackAnalyser: null,
    playbackCursor: 0,
    playbackSources: new Set(),
    localMouthActive: false,
    localMouthTimer: null,
    localMouthTimeout: null,
    lastToolAnnouncementAt: 0,
    anamClient: null,
    anamAudioStream: null,
    anamReady: false,
    anamStarting: false,
    talkingHead: null,
    talkingHeadReady: false,
    talkingHeadStarting: false,
    deerReady: false,
    portraitReady: false,
    visualLoadId: 0,
    screenStream: null,
    screenVideo: null,
    screenCanvas: null,
    screenTimer: null,
    animationFrame: null,
    setupTimer: null,
    greetingMicFallbackTimer: null,
    inputTranscript: "",
    outputTranscript: "",
    actionPayload: null,
    sessionId: "",
  };

  var elements = {};

  function queryParams() {
    var raw = window.__JB_AVATAR_QUERY__ || window.location.search || "";
    return new URLSearchParams(raw.charAt(0) === "?" ? raw.slice(1) : raw);
  }

  var params = queryParams();

  function firstParam(names, fallback) {
    for (var i = 0; i < names.length; i += 1) {
      var value = params.get(names[i]);
      if (value !== null && value !== "") {
        return value;
      }
    }
    return fallback || "";
  }

  function parseBoolean(value, fallback) {
    if (value === null || value === undefined || value === "") {
      return Boolean(fallback);
    }
    return ["1", "true", "yes", "si", "on"].indexOf(String(value).toLowerCase()) >= 0;
  }

  function normalizeHostUrl(hostUrl) {
    return String(hostUrl || "").trim().replace(/\/$/, "");
  }

  var config = {
    flowId: firstParam(["flowId", "flow_id"], ""),
    hostUrl: normalizeHostUrl(firstParam(["hostUrl", "host_url"], "")),
    apiKey: firstParam(["apiKey", "api_key"], ""),
    geminiApiKey: firstParam(["geminiApiKey", "gemini_api_key"], ""),
    geminiTokenUrl: firstParam(["geminiTokenUrl", "gemini_token_url"], ""),
    geminiTokenMethod: firstParam(["geminiTokenMethod", "gemini_token_method"], "POST").toUpperCase(),
    anamSessionToken: firstParam(["anamSessionToken", "anam_session_token"], ""),
    anamTokenUrl: firstParam(["anamTokenUrl", "anam_token_url"], ""),
    anamTokenMethod: firstParam(["anamTokenMethod", "anam_token_method"], "POST").toUpperCase(),
    anamSdkUrl: firstParam(["anamSdkUrl", "anam_sdk_url"], DEFAULT_ANAM_SDK_URL),
    anamAudioSampleRate: Number(firstParam(["anamAudioSampleRate", "anam_audio_sample_rate"], DEFAULT_ANAM_SAMPLE_RATE)),
    avatarMode: firstParam(["avatarMode", "avatar_mode"], ""),
    talkingHeadModuleUrl: firstParam(["talkingHeadModuleUrl", "talking_head_module_url"], DEFAULT_TALKING_HEAD_MODULE),
    talkingHeadAvatarUrl: firstParam(["talkingHeadAvatarUrl", "talking_head_avatar_url"], DEFAULT_TALKING_HEAD_AVATAR_URL),
    talkingHeadBody: firstParam(["talkingHeadBody", "talking_head_body"], "F"),
    talkingHeadView: firstParam(["talkingHeadView", "talking_head_view"], "head"),
    talkingHeadLipsyncLang: firstParam(["talkingHeadLipsyncLang", "talking_head_lipsync_lang"], "en"),
    model: firstParam(["geminiModel", "gemini_model"], DEFAULT_MODEL),
    view: firstParam(["view"], ""),
    autoStart: parseBoolean(firstParam(["autoStart", "auto_start"], ""), false),
    greetOnStart: parseBoolean(firstParam(["greetOnStart", "greet_on_start"], ""), false),
    shareScreenOnStart: parseBoolean(firstParam(["shareScreen", "share_screen"], ""), false),
    hideTranscripts: parseBoolean(firstParam(["hideTranscripts", "hide_transcripts"], ""), false) ||
      !parseBoolean(firstParam(["showTranscripts", "show_transcripts"], ""), true),
    showButtons: parseBoolean(firstParam(["showButtons", "show_buttons"], ""), true),
    systemPrompt: firstParam(["systemPrompt", "system_prompt", "prompt"], ""),
  };

  function buildSystemPrompt() {
    var customPrompt = config.systemPrompt.trim();
    var basePrompt = [
      "Eres ChileAtiende, un avatar de voz de NUMIA embebido en una pagina web.",
      "Responde en espanol claro, breve y operativo.",
      "Usa siempre espanol chileno natural de atencion ciudadana. Habla como una persona de Chile: puedes decir \"cuentame\", \"te puedo ayudar\", \"si te parece\", \"revisemos\", \"de todas maneras\", \"perfecto\" y \"un momento por favor\". Usa tuteo chileno respetuoso con formas como \"puedes\", \"necesitas\", \"tienes\" y \"quieres\". Evita voseo argentino, expresiones como \"vos\", \"tenes\", \"queres\", \"aguarda\" o \"dale\", y evita sonar neutro internacional. No exageres modismos ni uses garabatos.",
      "No inventes datos, identificadores, horarios, requisitos ni disponibilidades.",
      "Antes de llamar la funcion " + TOOL_NAME + ", siempre avisa al usuario diciendo exactamente: \"" + TOOL_WAIT_PHRASE + "\". Luego llama la funcion. No dejes silencios largos antes de consultar herramientas.",
      "Cuando necesites informacion del flujo Journey Builder configurado, llama la funcion " + TOOL_NAME + " con un resumen preciso del pedido del usuario.",
      "Despues de recibir el resultado de esa funcion, responde al usuario con una sintesis oral natural.",
      "Si el usuario comparte pantalla, usa lo visible solo como contexto de navegacion y no asumas datos que no se vean claramente.",
    ].join("\n");

    if (!customPrompt) {
      return basePrompt;
    }

    return basePrompt + "\n\nInstrucciones adicionales del flujo:\n" + customPrompt;
  }

  function isMissingGeminiAuth() {
    var key = config.geminiApiKey.trim();
    if (config.geminiTokenUrl.trim()) {
      return false;
    }
    return (
      !key ||
      key.indexOf("REEMPLAZAR") === 0 ||
      key.indexOf("YOUR_") === 0 ||
      key === "{gemini_api_key}"
    );
  }

  function hasAnamConfig() {
    var sessionToken = config.anamSessionToken.trim();
    var tokenUrl = config.anamTokenUrl.trim();
    return Boolean(
      (sessionToken && sessionToken.indexOf("REEMPLAZAR") !== 0 && sessionToken.indexOf("YOUR_") !== 0) ||
      (tokenUrl && tokenUrl.indexOf("REEMPLAZAR") !== 0 && tokenUrl.indexOf("YOUR_") !== 0)
    );
  }

  function normalizedAvatarMode() {
    return String(config.avatarMode || "").trim().toLowerCase().replace(/-/g, "_");
  }

  function shouldUseTalkingHead() {
    return normalizedAvatarMode() === "talkinghead" || normalizedAvatarMode() === "talking_head";
  }

  function shouldUseDeerAvatar() {
    var mode = normalizedAvatarMode();
    return (
      mode === "" ||
      mode === "deer" ||
      mode === "deer2d" ||
      mode === "deer_2d" ||
      mode === "squirrel" ||
      mode === "squirrel2d" ||
      mode === "squirrel_2d"
    );
  }

  function shouldUsePortraitAvatar() {
    var mode = normalizedAvatarMode();
    return (
      mode === "portrait" ||
      mode === "portrait2d" ||
      mode === "portrait_2d" ||
      mode === "human" ||
      mode === "human2d" ||
      mode === "human_2d"
    );
  }

  function shouldUseAnam() {
    return normalizedAvatarMode() === "anam" && hasAnamConfig();
  }

  function setStatus(text, isError) {
    if (elements.statusText) {
      elements.statusText.textContent = text;
    }
    if (elements.statusDot) {
      elements.statusDot.classList.toggle("is-error", Boolean(isError));
    }
  }

  function setOpen(open) {
    state.open = open;
    if (elements.widget) {
      elements.widget.setAttribute("aria-hidden", open ? "false" : "true");
    }
    if (elements.fab) {
      elements.fab.setAttribute("aria-expanded", open ? "true" : "false");
      elements.fab.hidden = open;
    }
    syncIframeFrame(open);
  }

  function postIframeFrameState(open) {
    if (!window.parent || window.parent === window) {
      return;
    }

    try {
      window.parent.postMessage({
        type: "journey-builder-avatar:frame",
        open: Boolean(open),
      }, "*");
    } catch (error) {
      console.debug("Unable to post Gemini avatar frame state:", error);
    }
  }

  function syncIframeFrame(open) {
    if (config.view !== "widget") {
      return;
    }

    postIframeFrameState(open);

    var frame = window.frameElement;
    if (!frame || frame.tagName !== "IFRAME") {
      return;
    }

    try {
      frame.style.position = "fixed";
      frame.style.left = "";
      frame.style.top = "";
      frame.style.right = "max(12px, 2vw)";
      frame.style.bottom = "max(12px, 2vw)";
      frame.style.border = "0";
      frame.style.background = "transparent";
      frame.style.overflow = "hidden";

      if (!open) {
        frame.width = "84";
        frame.height = "84";
        frame.style.width = "84px";
        frame.style.height = "84px";
        frame.style.maxWidth = "84px";
        frame.style.maxHeight = "84px";
        frame.style.borderRadius = "0";
        frame.style.boxShadow = "none";
        return;
      }

      frame.width = "380";
      frame.height = "560";
      frame.style.width = "min(380px, calc(100vw - 24px))";
      frame.style.height = "min(560px, calc(100vh - 24px))";
      frame.style.maxWidth = "380px";
      frame.style.maxHeight = "560px";
      frame.style.borderRadius = "18px";
      frame.style.boxShadow = "0 22px 48px rgba(15, 23, 42, 0.28)";
    } catch (error) {
      console.debug("Unable to sync Gemini avatar iframe frame:", error);
    }
  }

  function updateButtons() {
    if (elements.startButton) {
      elements.startButton.disabled = state.starting;
      elements.startButton.textContent = state.ready ? "Reiniciar" : state.starting ? "Conectando" : "Iniciar";
    }
    if (elements.muteButton) {
      elements.muteButton.disabled = !state.ready && !state.micStream;
      elements.muteButton.textContent = state.muted ? "Activar mic" : "Mutear";
    }
    if (elements.screenButton) {
      elements.screenButton.disabled = !state.ready || !navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia;
      elements.screenButton.textContent = state.screenStream ? "Dejar pantalla" : "Compartir pantalla";
    }
  }

  function mergeText(previous, incoming) {
    var base = String(previous || "");
    var text = String(incoming || "").trim();
    if (!text) {
      return base;
    }
    if (!base) {
      return text;
    }
    if (base.endsWith(text)) {
      return base;
    }
    if (text.indexOf(base) === 0) {
      return text;
    }

    var maxOverlap = Math.min(base.length, text.length);
    for (var size = maxOverlap; size >= 8; size -= 1) {
      if (base.slice(-size) === text.slice(0, size)) {
        return base + text.slice(size);
      }
    }

    return base + " " + text;
  }

  function updateTranscript(role, text) {
    if (!text) {
      return;
    }

    if (role === "user") {
      state.inputTranscript = mergeText(state.inputTranscript, text);
      if (elements.inputTranscript) {
        elements.inputTranscript.textContent = state.inputTranscript;
      }
      return;
    }

    state.outputTranscript = mergeText(state.outputTranscript, text);
    if (elements.outputTranscript) {
      elements.outputTranscript.textContent = state.outputTranscript;
    }
  }

  function clearActionPanel() {
    state.actionPayload = null;
    document.body.classList.remove("gemini-has-actions");
    if (elements.actionPanel) {
      elements.actionPanel.hidden = true;
      elements.actionPanel.innerHTML = "";
    }
  }

  function normalizeActionButtons(buttons) {
    if (!Array.isArray(buttons)) {
      return [];
    }

    return buttons
      .map(function (button) {
        if (typeof button === "string") {
          return { label: button, value: button };
        }
        if (!button || typeof button !== "object") {
          return null;
        }
        var label = String(button.label || button.text || button.title || button.value || "").trim();
        var value = String(button.value || button.label || button.text || button.title || "").trim();
        if (!label || !value) {
          return null;
        }
        return { label: label, value: value };
      })
      .filter(Boolean);
  }

  function handleActionButtonClick(button) {
    if (!button || !button.value || !state.ready) {
      return;
    }
    clearActionPanel();
    updateTranscript("user", button.label);
    setStatus("Consultando", false);
    sendClientText(button.value);
  }

  function renderActionPanel(payload) {
    if (!elements.actionPanel || !config.showButtons) {
      return;
    }

    clearActionPanel();
    var buttons = normalizeActionButtons(payload && payload.buttons);
    var form = String((payload && payload.form) || "").trim();
    if (!buttons.length && !form) {
      return;
    }

    state.actionPayload = {
      form: form,
      buttons: buttons,
    };

    if (form) {
      var formLabel = document.createElement("p");
      formLabel.className = "gemini-action-form";
      formLabel.textContent = form;
      elements.actionPanel.appendChild(formLabel);
    }

    if (buttons.length) {
      var buttonsWrapper = document.createElement("div");
      buttonsWrapper.className = "gemini-action-buttons";
      buttons.forEach(function (button) {
        var buttonElement = document.createElement("button");
        buttonElement.className = "gemini-action-button";
        buttonElement.type = "button";
        buttonElement.textContent = button.label;
        buttonElement.addEventListener("click", function () {
          handleActionButtonClick(button);
        });
        buttonsWrapper.appendChild(buttonElement);
      });
      elements.actionPanel.appendChild(buttonsWrapper);
    }

    elements.actionPanel.hidden = false;
    document.body.classList.add("gemini-has-actions");
  }

  function resetTranscripts() {
    state.inputTranscript = "";
    state.outputTranscript = "";
    if (elements.inputTranscript) {
      elements.inputTranscript.textContent = "";
    }
    if (elements.outputTranscript) {
      elements.outputTranscript.textContent = "";
    }
    clearActionPanel();
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, ms);
    });
  }

  function normalizeTextForMatch(text) {
    return String(text || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function normalizeSampleRate(value, fallback) {
    var sampleRate = Number(value);
    if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 48000) {
      return fallback;
    }
    return Math.round(sampleRate);
  }

  function bytesToBase64(bytes) {
    var binary = "";
    var size = 0x8000;
    for (var i = 0; i < bytes.length; i += size) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + size));
    }
    return btoa(binary);
  }

  function base64ToBytes(base64) {
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function downsampleTo16k(input, inputRate) {
    if (inputRate === 16000) {
      return input;
    }

    var ratio = inputRate / 16000;
    var outputLength = Math.floor(input.length / ratio);
    var output = new Float32Array(outputLength);
    for (var i = 0; i < outputLength; i += 1) {
      var start = Math.floor(i * ratio);
      var end = Math.min(Math.floor((i + 1) * ratio), input.length);
      var sum = 0;
      for (var j = start; j < end; j += 1) {
        sum += input[j];
      }
      output[i] = sum / Math.max(1, end - start);
    }
    return output;
  }

  function floatToPcm16(samples) {
    var bytes = new Uint8Array(samples.length * 2);
    var view = new DataView(bytes.buffer);
    for (var i = 0; i < samples.length; i += 1) {
      var sample = Math.max(-1, Math.min(1, samples[i]));
      var value = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(i * 2, value, true);
    }
    return bytes;
  }

  function pcm16ToFloat32(bytes) {
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var samples = new Float32Array(Math.floor(bytes.byteLength / 2));
    for (var i = 0; i < samples.length; i += 1) {
      samples[i] = view.getInt16(i * 2, true) / 0x8000;
    }
    return samples;
  }

  function extractSampleRate(mimeType, fallback) {
    var match = String(mimeType || "").match(/rate=(\d+)/i);
    return match ? Number(match[1]) : fallback;
  }

  function ensurePlaybackGraph() {
    if (state.playbackContext) {
      if (state.playbackContext.state === "suspended") {
        state.playbackContext.resume().catch(function () {});
      }
      return;
    }

    var AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    state.playbackContext = new AudioContextCtor();
    state.playbackGain = state.playbackContext.createGain();
    state.playbackAnalyser = state.playbackContext.createAnalyser();
    state.playbackAnalyser.fftSize = 256;
    state.playbackGain.connect(state.playbackAnalyser);
    state.playbackAnalyser.connect(state.playbackContext.destination);
    state.playbackCursor = state.playbackContext.currentTime;
    startMouthAnimation();
  }

  function playPcm16Audio(base64Audio, mimeType) {
    if (!base64Audio) {
      return;
    }

    sendAudioToAnam(base64Audio, mimeType);
    ensurePlaybackGraph();
    var sampleRate = extractSampleRate(mimeType, 24000);
    var samples = pcm16ToFloat32(base64ToBytes(base64Audio));
    if (!samples.length) {
      return;
    }

    var buffer = state.playbackContext.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);

    var source = state.playbackContext.createBufferSource();
    source.buffer = buffer;
    source.connect(state.playbackGain);

    var startAt = Math.max(state.playbackContext.currentTime + 0.03, state.playbackCursor);
    source.start(startAt);
    state.playbackCursor = startAt + buffer.duration;
    state.playbackSources.add(source);
    setSpeaking(true);

    source.onended = function () {
      state.playbackSources.delete(source);
      if (!state.playbackSources.size) {
        window.setTimeout(function () {
          if (!state.playbackSources.size) {
            setSpeaking(false);
          }
        }, 120);
      }
    };
  }

  function stopQueuedPlayback() {
    stopLocalMouthPulse();
    state.playbackSources.forEach(function (source) {
      try {
        source.stop();
      } catch (error) {
        // Already stopped.
      }
    });
    state.playbackSources.clear();
    if (state.playbackContext) {
      state.playbackCursor = state.playbackContext.currentTime;
    }
    setSpeaking(false);
    interruptAnamAvatar();
  }

  function setSpeaking(speaking) {
    state.speaking = speaking;
    document.body.classList.toggle("gemini-avatar-speaking", speaking);
    if (!speaking) {
      setVisualMouthLevel(0);
    }
  }

  function setVisualMouthLevel(level) {
    var value = Math.max(0, Math.min(1, Number(level) || 0));
    document.documentElement.style.setProperty("--mouth-open", value.toFixed(3));
    document.documentElement.style.setProperty("--speech-level", value.toFixed(3));
    setTalkingHeadMouth(value);
  }

  function stopLocalMouthPulse() {
    state.localMouthActive = false;
    if (state.localMouthTimer !== null) {
      window.clearInterval(state.localMouthTimer);
      state.localMouthTimer = null;
    }
    if (state.localMouthTimeout !== null) {
      window.clearTimeout(state.localMouthTimeout);
      state.localMouthTimeout = null;
    }
    if (!state.playbackSources.size) {
      setSpeaking(false);
    }
  }

  function startLocalMouthPulse(durationMs) {
    stopLocalMouthPulse();
    state.localMouthActive = true;
    setSpeaking(true);
    state.localMouthTimer = window.setInterval(function () {
      var level = 0.18 + Math.random() * 0.32;
      setVisualMouthLevel(level);
    }, 80);
    state.localMouthTimeout = window.setTimeout(stopLocalMouthPulse, durationMs);
  }

  function startMouthAnimation() {
    if (state.animationFrame !== null) {
      return;
    }

    var data = new Uint8Array(128);
    var loop = function () {
      state.animationFrame = window.requestAnimationFrame(loop);
      if (!state.playbackAnalyser || !state.speaking) {
        if (!state.localMouthActive) {
          setVisualMouthLevel(0);
        }
        return;
      }
      if (state.localMouthActive) {
        return;
      }

      state.playbackAnalyser.getByteTimeDomainData(data);
      var sum = 0;
      for (var i = 0; i < data.length; i += 1) {
        var centered = (data[i] - 128) / 128;
        sum += centered * centered;
      }
      var rms = Math.sqrt(sum / data.length);
      var mouthOpen = Math.max(0, Math.min(1, (rms - 0.015) * 9));
      setVisualMouthLevel(mouthOpen);
    };

    loop();
  }

  function stopMouthAnimation() {
    if (state.animationFrame !== null) {
      window.cancelAnimationFrame(state.animationFrame);
      state.animationFrame = null;
    }
    stopLocalMouthPulse();
    setVisualMouthLevel(0);
  }

  async function resolveAnamSessionToken() {
    var sessionToken = config.anamSessionToken.trim();
    if (sessionToken) {
      return sessionToken;
    }

    var tokenUrl = config.anamTokenUrl.trim();
    if (!tokenUrl) {
      return "";
    }

    var init = {
      method: config.anamTokenMethod === "GET" ? "GET" : "POST",
      headers: { "Content-Type": "application/json" },
    };

    if (init.method !== "GET") {
      init.body = JSON.stringify({
        clientLabel: "chileatiende-gemini-avatar",
        flow_id: config.flowId,
        enableAudioPassthrough: true,
      });
    }

    var response = await fetch(tokenUrl, init);
    if (!response.ok) {
      throw new Error("No se pudo obtener el token de sesion de Anam.");
    }

    var payload = await response.json();
    var token = payload.sessionToken || payload.session_token || payload.token;
    if (!token) {
      throw new Error("El token de Anam no tiene formato valido.");
    }
    return token;
  }

  async function startAnamAvatarIfConfigured() {
    if (!hasAnamConfig() || state.anamReady || state.anamStarting) {
      return;
    }

    state.anamStarting = true;
    setStatus("Conectando avatar", false);
    try {
      var sdk = await import(config.anamSdkUrl);
      if (!sdk || typeof sdk.createClient !== "function") {
        throw new Error("El SDK de Anam no expuso createClient.");
      }

      var sessionToken = await resolveAnamSessionToken();
      if (!sessionToken) {
        return;
      }

      state.anamClient = sdk.createClient(sessionToken, {
        disableInputAudio: true,
      });
      await state.anamClient.streamToVideoElement("anamVideo");

      var sampleRate = normalizeSampleRate(config.anamAudioSampleRate, DEFAULT_ANAM_SAMPLE_RATE);
      state.anamAudioStream = state.anamClient.createAgentAudioInputStream({
        encoding: "pcm_s16le",
        sampleRate: sampleRate,
        channels: 1,
      });
      state.anamReady = true;
      document.body.classList.add("gemini-anam-active");
      if (elements.anamVideo) {
        elements.anamVideo.hidden = false;
        elements.anamVideo.muted = true;
      }
      setStatus("Avatar conectado", false);
    } catch (error) {
      console.warn("Anam avatar unavailable; using static fallback:", error);
      state.anamReady = false;
      state.anamAudioStream = null;
      state.anamClient = null;
      document.body.classList.remove("gemini-anam-active");
      if (elements.anamVideo) {
        elements.anamVideo.hidden = true;
      }
      setStatus("Avatar no disponible", true);
    } finally {
      state.anamStarting = false;
    }
  }

  function stopAnamAvatar() {
    if (state.anamAudioStream && typeof state.anamAudioStream.endSequence === "function") {
      try {
        state.anamAudioStream.endSequence();
      } catch (error) {
        console.debug("Unable to end Anam audio sequence:", error);
      }
    }

    if (state.anamClient && typeof state.anamClient.stopStreaming === "function") {
      try {
        state.anamClient.stopStreaming();
      } catch (error) {
        console.debug("Unable to stop Anam streaming:", error);
      }
    }

    state.anamReady = false;
    state.anamStarting = false;
    state.anamAudioStream = null;
    state.anamClient = null;
    document.body.classList.remove("gemini-anam-active");
    if (elements.anamVideo) {
      elements.anamVideo.hidden = true;
      elements.anamVideo.removeAttribute("src");
      elements.anamVideo.srcObject = null;
    }
  }

  function interruptAnamAvatar() {
    if (state.anamClient && typeof state.anamClient.interruptPersona === "function") {
      try {
        state.anamClient.interruptPersona();
      } catch (error) {
        console.debug("Unable to interrupt Anam persona:", error);
      }
    }
    finishAnamAudioSequence();
  }

  function finishAnamAudioSequence() {
    if (!state.anamAudioStream || typeof state.anamAudioStream.endSequence !== "function") {
      return;
    }
    try {
      state.anamAudioStream.endSequence();
    } catch (error) {
      console.debug("Unable to finish Anam audio sequence:", error);
    }
  }

  function resamplePcm16Base64(base64Audio, mimeType, targetRate) {
    var sourceRate = extractSampleRate(mimeType, 24000);
    if (sourceRate === targetRate) {
      return base64Audio;
    }
    var samples = pcm16ToFloat32(base64ToBytes(base64Audio));
    var resampled = downsampleToRate(samples, sourceRate, targetRate);
    return bytesToBase64(floatToPcm16(resampled));
  }

  function downsampleToRate(input, inputRate, outputRate) {
    if (inputRate === outputRate) {
      return input;
    }

    var ratio = inputRate / outputRate;
    var outputLength = Math.floor(input.length / ratio);
    var output = new Float32Array(outputLength);
    for (var i = 0; i < outputLength; i += 1) {
      var start = Math.floor(i * ratio);
      var end = Math.min(Math.floor((i + 1) * ratio), input.length);
      var sum = 0;
      for (var j = start; j < end; j += 1) {
        sum += input[j];
      }
      output[i] = sum / Math.max(1, end - start);
    }
    return output;
  }

  function sendAudioToAnam(base64Audio, mimeType) {
    if (!state.anamReady || !state.anamAudioStream || typeof state.anamAudioStream.sendAudioChunk !== "function") {
      return;
    }

    try {
      var sampleRate = normalizeSampleRate(config.anamAudioSampleRate, DEFAULT_ANAM_SAMPLE_RATE);
      var audioForAnam = resamplePcm16Base64(base64Audio, mimeType, sampleRate);
      state.anamAudioStream.sendAudioChunk(audioForAnam);
    } catch (error) {
      console.warn("Unable to send audio to Anam:", error);
    }
  }

  async function startVisualAvatarIfConfigured() {
    if (shouldUsePortraitAvatar()) {
      startPortraitAvatar();
      return;
    }

    if (shouldUseDeerAvatar()) {
      startDeerAvatar();
      return;
    }

    if (shouldUseTalkingHead()) {
      await startTalkingHeadAvatar();
      return;
    }

    if (shouldUseAnam()) {
      await startAnamAvatarIfConfigured();
    }
  }

  function startPortraitAvatar() {
    if (!elements.portraitAvatarStage || state.portraitReady) {
      return;
    }

    state.portraitReady = true;
    document.body.classList.add("gemini-portrait-active");
    elements.portraitAvatarStage.hidden = false;
    setStatus("Avatar listo", false);
  }

  function stopPortraitAvatar() {
    state.portraitReady = false;
    document.body.classList.remove("gemini-portrait-active");
    if (elements.portraitAvatarStage) {
      elements.portraitAvatarStage.hidden = true;
    }
  }

  function startDeerAvatar() {
    if (!elements.deerAvatarStage || state.deerReady) {
      return;
    }

    state.deerReady = true;
    document.body.classList.add("gemini-deer-active");
    elements.deerAvatarStage.hidden = false;
    setStatus("Avatar listo", false);
  }

  function stopDeerAvatar() {
    state.deerReady = false;
    document.body.classList.remove("gemini-deer-active");
    if (elements.deerAvatarStage) {
      elements.deerAvatarStage.hidden = true;
    }
  }

  async function startTalkingHeadAvatar() {
    if (!shouldUseTalkingHead() || state.talkingHeadReady || state.talkingHeadStarting) {
      return;
    }
    if (!elements.talkingHeadStage) {
      return;
    }

    state.talkingHeadStarting = true;
    state.visualLoadId += 1;
    var loadId = state.visualLoadId;
    setStatus("Cargando avatar 3D", false);

    try {
      elements.talkingHeadStage.hidden = false;
      elements.talkingHeadStage.innerHTML = "";

      var moduleUrl = config.talkingHeadModuleUrl.trim() || DEFAULT_TALKING_HEAD_MODULE;
      var module = await import(moduleUrl);
      var TalkingHead = module.TalkingHead || module.default;
      if (typeof TalkingHead !== "function") {
        throw new Error("TalkingHead no expuso una clase valida.");
      }

      var lipsyncLang = config.talkingHeadLipsyncLang.trim() || "en";
      var head = new TalkingHead(elements.talkingHeadStage, {
        lipsyncModules: [],
        lipsyncLang: lipsyncLang,
        modelPixelRatio: Math.min(2, window.devicePixelRatio || 1),
        modelFPS: 30,
        cameraView: config.talkingHeadView || "head",
        cameraRotateEnable: false,
        cameraPanEnable: false,
        cameraZoomEnable: false,
        lightAmbientIntensity: 2.2,
        lightDirectIntensity: 22,
        lightDirectTheta: 1.8,
        avatarIdleEyeContact: 0.65,
        avatarIdleHeadMove: 0.25,
        avatarSpeakingEyeContact: 0.9,
        avatarSpeakingHeadMove: 0.45,
      });

      state.talkingHead = head;
      await head.showAvatar({
        url: config.talkingHeadAvatarUrl.trim() || DEFAULT_TALKING_HEAD_AVATAR_URL,
        body: config.talkingHeadBody.trim().toUpperCase() === "M" ? "M" : "F",
        avatarMood: "neutral",
        lipsyncLang: lipsyncLang,
        baseline: {
          headRotateX: -0.03,
          eyeBlinkLeft: 0.08,
          eyeBlinkRight: 0.08,
        },
      });

      if (loadId !== state.visualLoadId) {
        try {
          if (typeof head.stop === "function") {
            head.stop();
          }
        } catch (error) {
          console.debug("Unable to stop stale TalkingHead:", error);
        }
        return;
      }

      if (typeof head.setView === "function") {
        head.setView(config.talkingHeadView || "head", {
          cameraDistance: 0.05,
          cameraY: 0.03,
        });
      }

      state.talkingHeadReady = true;
      document.body.classList.add("gemini-talkinghead-active");
      setStatus("Avatar 3D listo", false);
    } catch (error) {
      console.warn("TalkingHead avatar unavailable; using static fallback:", error);
      stopTalkingHeadAvatar();
      setStatus("Avatar 3D no disponible", true);
    } finally {
      state.talkingHeadStarting = false;
    }
  }

  function stopTalkingHeadAvatar() {
    state.visualLoadId += 1;
    if (state.talkingHead) {
      try {
        if (typeof state.talkingHead.streamStop === "function") {
          state.talkingHead.streamStop();
        }
        if (typeof state.talkingHead.stop === "function") {
          state.talkingHead.stop();
        }
      } catch (error) {
        console.debug("Unable to stop TalkingHead:", error);
      }
    }

    state.talkingHead = null;
    state.talkingHeadReady = false;
    state.talkingHeadStarting = false;
    document.body.classList.remove("gemini-talkinghead-active");
    if (elements.talkingHeadStage) {
      elements.talkingHeadStage.hidden = true;
      elements.talkingHeadStage.innerHTML = "";
    }
  }

  function setTalkingHeadMouth(level) {
    if (!state.talkingHeadReady || !state.talkingHead || !state.talkingHead.mtAvatar) {
      return;
    }

    var value = Math.max(0, Math.min(0.82, Math.pow(Math.max(0, level), 0.72) * 0.9));
    var keys = ["jawOpen", "mouthOpen", "viseme_aa"];
    for (var i = 0; i < keys.length; i += 1) {
      var target = state.talkingHead.mtAvatar[keys[i]];
      if (!target) {
        continue;
      }
      target.realtime = value;
      target.needsUpdate = true;
    }
  }

  function buildGeminiSetup() {
    return {
      setup: {
        model: "models/" + config.model,
        generationConfig: {
          responseModalities: ["AUDIO"],
        },
        systemInstruction: {
          parts: [{ text: buildSystemPrompt() }],
        },
        tools: [
          {
            functionDeclarations: [
              {
                name: TOOL_NAME,
                description: "Consulta el flujo Journey Builder configurado para obtener una respuesta operativa. Antes de invocarla, avisa al usuario: \"" + TOOL_WAIT_PHRASE + "\".",
                parameters: {
                  type: "OBJECT",
                  properties: {
                    message: {
                      type: "STRING",
                      description: "Pedido del usuario resumido en espanol claro.",
                    },
                  },
                  required: ["message"],
                },
              },
            ],
          },
        ],
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
  }

  async function resolveGeminiEndpoint() {
    if (config.geminiTokenUrl.trim()) {
      var headers = {
        "Content-Type": "application/json",
      };
      if (config.apiKey) {
        headers["x-api-key"] = config.apiKey;
      }

      var init = {
        method: config.geminiTokenMethod === "GET" ? "GET" : "POST",
        headers: headers,
      };

      if (init.method !== "GET") {
        init.body = JSON.stringify({
          model: config.model,
          flow_id: config.flowId,
        });
      }

      var response = await fetch(config.geminiTokenUrl, init);
      if (!response.ok) {
        throw new Error("No se pudieron obtener las credenciales de Gemini.");
      }
      var tokenPayload = await response.json();
      var apiKey = tokenPayload.api_key || tokenPayload.apiKey || tokenPayload.gemini_api_key || tokenPayload.geminiApiKey;
      if (apiKey) {
        return "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=" + encodeURIComponent(String(apiKey).trim());
      }

      var token = tokenPayload.access_token || tokenPayload.accessToken || tokenPayload.token || tokenPayload.name;
      if (token) {
        return "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=" + encodeURIComponent(String(token).trim());
      }

      throw new Error("La respuesta de credenciales de Gemini no tiene formato valido.");
    }

    if (isMissingGeminiAuth()) {
      throw new Error("Falta configurar gemini_api_key o gemini_token_url.");
    }

    return "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=" + encodeURIComponent(config.geminiApiKey.trim());
  }

  async function startSession() {
    if (state.starting) {
      return;
    }

    if (state.ready || state.socket) {
      await stopSession();
    }

    state.starting = true;
    state.ready = false;
    state.muted = false;
    state.micRemainder = new Float32Array(0);
    state.sessionId = "gemini-avatar-" + (config.flowId || "flow") + "-" + Date.now();
    resetTranscripts();
    setOpen(true);
    setStatus("Conectando", false);
    updateButtons();

    try {
      var visualAvatarPromise = shouldUseTalkingHead()
        ? startVisualAvatarIfConfigured().catch(function (error) {
          console.warn("Unable to preload visual avatar:", error);
        })
        : null;
      var endpoint = await resolveGeminiEndpoint();
      var socket = new WebSocket(endpoint);
      state.socket = socket;

      await new Promise(function (resolve, reject) {
        socket.onopen = resolve;
        socket.onerror = function () {
          reject(new Error("No se pudo abrir la conexion con Gemini Live."));
        };
      });

      socket.onerror = function () {
        setStatus("Error de conexion", true);
        if (!state.ready && socket.__setupReject) {
          socket.__setupReject(new Error("Gemini Live rechazo la conexion."));
          socket.__setupResolve = null;
          socket.__setupReject = null;
        }
      };
      socket.onmessage = handleGeminiMessage;
      socket.onclose = function () {
        if (!state.ready && socket.__setupReject) {
          socket.__setupReject(new Error("Gemini Live cerro la conexion antes de setupComplete."));
          socket.__setupResolve = null;
          socket.__setupReject = null;
        }
        if (state.socket === socket) {
          state.ready = false;
          state.socket = null;
          stopMicCapture();
          stopScreenShare();
          stopQueuedPlayback();
          setStatus("Sesion cerrada", false);
          updateButtons();
        }
      };

      var setupReady = new Promise(function (resolve, reject) {
        state.setupTimer = window.setTimeout(function () {
          reject(new Error("Timeout esperando setupComplete de Gemini."));
        }, 45000);

        socket.__setupResolve = resolve;
        socket.__setupReject = reject;
      });

      socket.send(JSON.stringify(buildGeminiSetup()));
      await setupReady;
      if (visualAvatarPromise) {
        await visualAvatarPromise;
      } else {
        await startVisualAvatarIfConfigured();
      }

      if (config.shareScreenOnStart) {
        startScreenShare().catch(function (error) {
          console.warn("Screen share did not start:", error);
        });
      }

      if (config.greetOnStart) {
        state.pendingMicAfterGreeting = true;
        setStatus("Saludando", false);
        sendClientText("Saluda brevemente al usuario e invita a realizar una consulta.");
        scheduleGreetingMicFallback();
      } else {
        await startMicCapture();
      }
    } catch (error) {
      await stopSession();
      setOpen(true);
      setStatus(error.message || "No se pudo iniciar", true);
    } finally {
      state.starting = false;
      updateButtons();
    }
  }

  async function stopSession() {
    state.ready = false;
    state.pendingMicAfterGreeting = false;
    if (state.setupTimer !== null) {
      window.clearTimeout(state.setupTimer);
      state.setupTimer = null;
    }
    clearGreetingMicFallback();

    stopMicCapture();
    stopScreenShare();
    stopQueuedPlayback();
    stopAnamAvatar();
    stopTalkingHeadAvatar();
    stopDeerAvatar();
    stopPortraitAvatar();

    if (state.socket) {
      var socket = state.socket;
      state.socket = null;
      try {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
          socket.close();
        }
      } catch (error) {
        console.debug("Unable to close Gemini socket cleanly:", error);
      }
    }

    updateButtons();
  }

  function sendClientText(text) {
    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    state.socket.send(JSON.stringify({
      realtimeInput: {
        text: text,
      },
    }));
  }

  async function startMicCapture() {
    if (state.micStream || !state.ready) {
      return;
    }

    state.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: 1,
      },
    });

    var AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    state.micContext = new AudioContextCtor();
    state.micSource = state.micContext.createMediaStreamSource(state.micStream);
    state.micProcessor = state.micContext.createScriptProcessor(4096, 1, 1);
    state.micProcessor.onaudioprocess = function (event) {
      sendAudioFrame(event.inputBuffer.getChannelData(0), state.micContext.sampleRate);
    };
    state.micSource.connect(state.micProcessor);
    state.micProcessor.connect(state.micContext.destination);
    setStatus("Escuchando", false);
    updateButtons();
  }

  function stopMicCapture() {
    if (state.socket && state.socket.readyState === WebSocket.OPEN && state.ready) {
      try {
        state.socket.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
      } catch (error) {
        console.debug("Unable to notify audio stream end:", error);
      }
    }

    if (state.micProcessor) {
      state.micProcessor.disconnect();
      state.micProcessor = null;
    }
    if (state.micSource) {
      state.micSource.disconnect();
      state.micSource = null;
    }
    if (state.micContext) {
      state.micContext.close().catch(function () {});
      state.micContext = null;
    }
    if (state.micStream) {
      state.micStream.getTracks().forEach(function (track) {
        track.stop();
      });
      state.micStream = null;
    }
    state.micRemainder = new Float32Array(0);
  }

  function sendAudioFrame(inputData, inputRate) {
    if (!state.ready || !state.socket || state.socket.readyState !== WebSocket.OPEN || state.muted) {
      state.micRemainder = new Float32Array(0);
      return;
    }

    var merged = new Float32Array(state.micRemainder.length + inputData.length);
    merged.set(state.micRemainder, 0);
    merged.set(inputData, state.micRemainder.length);

    var samplesPerMessage = Math.floor(inputRate * 0.1);
    var usableLength = Math.floor(merged.length / samplesPerMessage) * samplesPerMessage;
    if (usableLength === 0) {
      state.micRemainder = merged;
      return;
    }

    var usable = merged.subarray(0, usableLength);
    state.micRemainder = merged.subarray(usableLength);
    var downsampled = downsampleTo16k(usable, inputRate);
    var pcm16 = floatToPcm16(downsampled);

    state.socket.send(JSON.stringify({
      realtimeInput: {
        audio: {
          data: bytesToBase64(pcm16),
          mimeType: "audio/pcm;rate=16000",
        },
      },
    }));
  }

  function startMicAfterPlayback() {
    clearGreetingMicFallback();
    var delayMs = 160;
    if (state.playbackContext) {
      delayMs = Math.max(160, Math.ceil((state.playbackCursor - state.playbackContext.currentTime) * 1000) + 160);
    }
    window.setTimeout(function () {
      if (state.pendingMicAfterGreeting && state.ready) {
        state.pendingMicAfterGreeting = false;
        startMicCapture().catch(function (error) {
          setStatus(error.message || "No se pudo activar el microfono", true);
          updateButtons();
        });
      }
    }, delayMs);
  }

  function clearGreetingMicFallback() {
    if (state.greetingMicFallbackTimer !== null) {
      window.clearTimeout(state.greetingMicFallbackTimer);
      state.greetingMicFallbackTimer = null;
    }
  }

  function scheduleGreetingMicFallback() {
    clearGreetingMicFallback();
    state.greetingMicFallbackTimer = window.setTimeout(function () {
      state.greetingMicFallbackTimer = null;
      if (!state.pendingMicAfterGreeting || !state.ready) {
        return;
      }
      startMicAfterPlayback();
    }, 6000);
  }

  async function startScreenShare() {
    if (state.screenStream) {
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      throw new Error("El navegador no permite compartir pantalla.");
    }

    state.screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    });
    state.screenVideo = document.createElement("video");
    state.screenVideo.muted = true;
    state.screenVideo.playsInline = true;
    state.screenVideo.srcObject = state.screenStream;
    await state.screenVideo.play();

    state.screenCanvas = document.createElement("canvas");
    var track = state.screenStream.getVideoTracks()[0];
    if (track) {
      track.onended = stopScreenShare;
    }

    if (elements.screenBadge) {
      elements.screenBadge.hidden = false;
    }
    state.screenTimer = window.setInterval(sendScreenFrame, SCREEN_FRAME_INTERVAL_MS);
    sendScreenFrame();
    updateButtons();
  }

  function stopScreenShare() {
    if (state.screenTimer !== null) {
      window.clearInterval(state.screenTimer);
      state.screenTimer = null;
    }
    if (state.screenStream) {
      state.screenStream.getTracks().forEach(function (track) {
        track.stop();
      });
      state.screenStream = null;
    }
    state.screenVideo = null;
    state.screenCanvas = null;
    if (elements.screenBadge) {
      elements.screenBadge.hidden = true;
    }
    updateButtons();
  }

  function sendScreenFrame() {
    if (!state.ready || !state.socket || state.socket.readyState !== WebSocket.OPEN || !state.screenVideo || !state.screenCanvas) {
      return;
    }

    var sourceWidth = state.screenVideo.videoWidth;
    var sourceHeight = state.screenVideo.videoHeight;
    if (!sourceWidth || !sourceHeight) {
      return;
    }

    var scale = Math.min(1, MAX_SCREEN_WIDTH / sourceWidth);
    var width = Math.max(1, Math.round(sourceWidth * scale));
    var height = Math.max(1, Math.round(sourceHeight * scale));
    state.screenCanvas.width = width;
    state.screenCanvas.height = height;
    var context = state.screenCanvas.getContext("2d", { alpha: false });
    context.drawImage(state.screenVideo, 0, 0, width, height);
    state.screenCanvas.toBlob(function (blob) {
      if (!blob || !state.socket || state.socket.readyState !== WebSocket.OPEN) {
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        var result = String(reader.result || "");
        var base64 = result.indexOf(",") >= 0 ? result.split(",").pop() : result;
        state.socket.send(JSON.stringify({
          realtimeInput: {
            video: {
              data: base64,
              mimeType: "image/jpeg",
            },
          },
        }));
      };
      reader.readAsDataURL(blob);
    }, "image/jpeg", 0.62);
  }

  async function handleGeminiMessage(rawEvent) {
    var rawText = typeof rawEvent.data === "string" ? rawEvent.data : await rawEvent.data.text();
    var message;
    try {
      message = JSON.parse(rawText);
    } catch (error) {
      console.warn("Gemini message is not JSON:", rawText.slice(0, 300));
      return;
    }

    if (message.setupComplete) {
      state.ready = true;
      if (state.setupTimer !== null) {
        window.clearTimeout(state.setupTimer);
        state.setupTimer = null;
      }
      if (state.socket && state.socket.__setupResolve) {
        state.socket.__setupResolve();
        state.socket.__setupResolve = null;
        state.socket.__setupReject = null;
      }
      setStatus("Conectado", false);
      updateButtons();
      return;
    }

    if (message.toolCall) {
      handleToolCall(message.toolCall);
    }

    if (message.toolCallCancellation) {
      console.debug("Gemini tool call cancelled:", message.toolCallCancellation);
    }

    var serverContent = message.serverContent;
    if (serverContent) {
      if (serverContent.interrupted) {
        stopQueuedPlayback();
      }

      if (serverContent.inputTranscription && serverContent.inputTranscription.text) {
        clearActionPanel();
        updateTranscript("user", serverContent.inputTranscription.text);
      }

      if (serverContent.outputTranscription && serverContent.outputTranscription.text) {
        updateTranscript("model", serverContent.outputTranscription.text);
      }

      var parts = (serverContent.modelTurn && serverContent.modelTurn.parts) || [];
      parts.forEach(function (part) {
        if (part.text) {
          updateTranscript("model", part.text);
        }
        var inlineData = part.inlineData || part.inline_data;
        if (inlineData && inlineData.data) {
          playPcm16Audio(inlineData.data, inlineData.mimeType || inlineData.mime_type);
        }
      });

      if (serverContent.generationComplete || serverContent.turnComplete) {
        finishAnamAudioSequence();
      }

      if (serverContent.turnComplete) {
        if (state.pendingMicAfterGreeting) {
          startMicAfterPlayback();
        } else if (state.ready && state.micStream) {
          setStatus(state.muted ? "Microfono muteado" : "Escuchando", false);
        }
      }
    }

    if (message.error) {
      setStatus("Error de Gemini", true);
      console.error("Gemini Live error:", message.error);
    }

    if (message.goAway) {
      setStatus("Gemini cerrara la sesion", false);
    }
  }

  function functionCallsFromToolCall(toolCall) {
    return toolCall.functionCalls || toolCall.function_calls || [];
  }

  function recentlyAnnouncedToolWait() {
    var recent = normalizeTextForMatch(state.outputTranscript).slice(-260);
    return recent.indexOf("esperame un momento") >= 0 || recent.indexOf("un momento por favor") >= 0;
  }

  function chooseSpanishSpeechVoice() {
    if (!window.speechSynthesis || typeof window.speechSynthesis.getVoices !== "function") {
      return null;
    }
    var voices = window.speechSynthesis.getVoices() || [];
    return (
      voices.find(function (voice) { return String(voice.lang || "").toLowerCase() === "es-cl"; }) ||
      voices.find(function (voice) { return String(voice.lang || "").toLowerCase().indexOf("es-") === 0; }) ||
      voices.find(function (voice) { return String(voice.lang || "").toLowerCase().indexOf("es") === 0; }) ||
      null
    );
  }

  async function announceToolWaitBeforeToolCall() {
    if (recentlyAnnouncedToolWait()) {
      return;
    }

    var now = Date.now();
    if (now - state.lastToolAnnouncementAt < 1800) {
      return;
    }
    state.lastToolAnnouncementAt = now;

    updateTranscript("model", TOOL_WAIT_PHRASE);
    setStatus("Consultando", false);
    startLocalMouthPulse(1400);

    if (!window.speechSynthesis || typeof window.SpeechSynthesisUtterance !== "function") {
      await delay(650);
      stopLocalMouthPulse();
      return;
    }

    await new Promise(function (resolve) {
      var resolved = false;
      var utterance = new SpeechSynthesisUtterance(TOOL_WAIT_PHRASE);
      var voice = chooseSpanishSpeechVoice();

      utterance.lang = "es-CL";
      utterance.rate = 1.04;
      utterance.pitch = 1;
      if (voice) {
        utterance.voice = voice;
      }

      function finish() {
        if (resolved) {
          return;
        }
        resolved = true;
        window.setTimeout(function () {
          stopLocalMouthPulse();
          resolve();
        }, 120);
      }

      utterance.onend = finish;
      utterance.onerror = finish;

      try {
        window.speechSynthesis.speak(utterance);
        window.setTimeout(finish, 1900);
      } catch (error) {
        finish();
      }
    });
  }

  function argsFromFunctionCall(functionCall) {
    var args = functionCall.args || functionCall.arguments || {};
    if (typeof args === "string") {
      try {
        return JSON.parse(args);
      } catch (error) {
        return { message: args };
      }
    }
    return args || {};
  }

  async function handleToolCall(toolCall) {
    var calls = functionCallsFromToolCall(toolCall);
    if (!calls.length || !state.socket || state.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    await announceToolWaitBeforeToolCall();
    setStatus("Consultando JB", false);
    var functionResponses = [];
    for (var i = 0; i < calls.length; i += 1) {
      functionResponses.push(await executeFunctionCall(calls[i]));
    }

    state.socket.send(JSON.stringify({
      toolResponse: {
        functionResponses: functionResponses,
      },
    }));
  }

  async function executeFunctionCall(functionCall) {
    var args = argsFromFunctionCall(functionCall);
    if (functionCall.name !== TOOL_NAME) {
      return {
        id: functionCall.id,
        name: functionCall.name,
        response: {
          error: "Funcion no disponible en este avatar.",
        },
      };
    }

    try {
      var result = await consultJourneyBuilder(args.message || state.inputTranscript || "Consulta del usuario");
      return {
        id: functionCall.id,
        name: functionCall.name,
        response: {
          result: result,
        },
      };
    } catch (error) {
      return {
        id: functionCall.id,
        name: functionCall.name,
        response: {
          error: error.message || "No se pudo consultar Journey Builder.",
        },
      };
    }
  }

  function buildJourneyBuilderRunEndpoint(hostUrl, flowId) {
    if (hostUrl.indexOf("/api/v1/run/") >= 0) {
      if (/([?&])stream=/.test(hostUrl)) {
        return hostUrl.replace(/([?&])stream=[^&]*/g, "$1stream=false");
      }
      return hostUrl.indexOf("?") >= 0 ? hostUrl + "&stream=false" : hostUrl + "?stream=false";
    }

    if (hostUrl.slice(-7) === "/api/v1") {
      return hostUrl + "/run/" + encodeURIComponent(flowId) + "?stream=false";
    }

    return hostUrl + "/api/v1/run/" + encodeURIComponent(flowId) + "?stream=false";
  }

  async function consultJourneyBuilder(message) {
    if (!config.hostUrl || !config.flowId) {
      throw new Error("Falta host_url o flow_id para consultar Journey Builder.");
    }

    var headers = {
      "Content-Type": "application/json",
    };
    if (config.apiKey) {
      headers["x-api-key"] = config.apiKey;
    }

    var response = await fetch(buildJourneyBuilderRunEndpoint(config.hostUrl, config.flowId), {
      method: "POST",
      headers: headers,
      body: JSON.stringify({
        input_value: message,
        input_type: "chat",
        output_type: "chat",
        session_id: state.sessionId,
      }),
    });

    if (!response.ok) {
      throw new Error("Journey Builder respondio con estado " + response.status + ".");
    }

    var contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (contentType.indexOf("json") >= 0) {
      var jsonResult = normalizeJourneyBuilderResponse(await response.json());
      renderActionPanel(jsonResult);
      return jsonResult.text || "Journey Builder no devolvio texto.";
    }

    var rawText = await response.text();
    var parsed = tryParseJsonString(rawText);
    if (parsed !== null) {
      var parsedResult = normalizeJourneyBuilderResponse(parsed);
      renderActionPanel(parsedResult);
      return parsedResult.text || rawText;
    }
    clearActionPanel();
    return rawText || "Journey Builder no devolvio texto.";
  }

  function tryParseJsonString(value) {
    if (typeof value !== "string") {
      return null;
    }
    var trimmed = value.trim();
    if (!trimmed || (trimmed.charAt(0) !== "{" && trimmed.charAt(0) !== "[")) {
      return null;
    }
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      return null;
    }
  }

  function normalizeJourneyBuilderResponse(value) {
    var structured = findStructuredJourneyBuilderResponse(value, 0);
    if (structured) {
      return structured;
    }

    return {
      text: extractTextFromJourneyBuilderResponse(value) || "",
      form: "",
      buttons: [],
    };
  }

  function findStructuredJourneyBuilderResponse(value, depth) {
    var currentDepth = depth || 0;
    if (value === null || value === undefined || currentDepth > 8) {
      return null;
    }

    if (typeof value === "string") {
      var parsed = tryParseJsonString(value);
      if (parsed !== null) {
        return findStructuredJourneyBuilderResponse(parsed, currentDepth + 1);
      }
      return null;
    }

    if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i += 1) {
        var itemResult = findStructuredJourneyBuilderResponse(value[i], currentDepth + 1);
        if (itemResult) {
          return itemResult;
        }
      }
      return null;
    }

    if (typeof value !== "object") {
      return null;
    }

    var buttons = normalizeActionButtons(value.buttons);
    var form = typeof value.form === "string" ? value.form.trim() : "";
    var text = "";
    var directKeys = ["respuesta", "response", "answer", "texto", "text", "message", "mensaje"];
    for (var d = 0; d < directKeys.length; d += 1) {
      var directValue = value[directKeys[d]];
      if (typeof directValue === "string" && directValue.trim()) {
        var parsedDirectValue = tryParseJsonString(directValue);
        if (parsedDirectValue !== null) {
          var directStructured = findStructuredJourneyBuilderResponse(parsedDirectValue, currentDepth + 1);
          if (directStructured) {
            return directStructured;
          }
        }
        text = directValue.trim();
        break;
      }
    }

    if (text || form || buttons.length) {
      return {
        text: text || extractTextFromJourneyBuilderResponse(value),
        form: form,
        buttons: buttons,
      };
    }

    var priorityKeys = ["result", "results", "outputs", "output", "data"];
    for (var p = 0; p < priorityKeys.length; p += 1) {
      if (priorityKeys[p] in value) {
        var priorityResult = findStructuredJourneyBuilderResponse(value[priorityKeys[p]], currentDepth + 1);
        if (priorityResult) {
          return priorityResult;
        }
      }
    }

    var values = Object.values(value);
    for (var v = 0; v < values.length; v += 1) {
      var nestedResult = findStructuredJourneyBuilderResponse(values[v], currentDepth + 1);
      if (nestedResult) {
        return nestedResult;
      }
    }

    return null;
  }

  function extractTextFromJourneyBuilderResponse(value, depth) {
    var currentDepth = depth || 0;
    if (value === null || value === undefined || currentDepth > 8) {
      return "";
    }
    if (typeof value === "string") {
      var parsed = tryParseJsonString(value);
      if (parsed !== null) {
        return extractTextFromJourneyBuilderResponse(parsed, currentDepth + 1) || value;
      }
      return value;
    }
    if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i += 1) {
        var itemText = extractTextFromJourneyBuilderResponse(value[i], currentDepth + 1);
        if (itemText) {
          return itemText;
        }
      }
      return "";
    }
    if (typeof value === "object") {
      var directKeys = ["respuesta", "response", "answer", "texto", "text", "message", "mensaje"];
      for (var d = 0; d < directKeys.length; d += 1) {
        if (typeof value[directKeys[d]] === "string" && value[directKeys[d]].trim()) {
          return value[directKeys[d]];
        }
      }

      var priorityKeys = ["result", "results", "outputs", "output", "data"];
      for (var p = 0; p < priorityKeys.length; p += 1) {
        if (priorityKeys[p] in value) {
          var priorityText = extractTextFromJourneyBuilderResponse(value[priorityKeys[p]], currentDepth + 1);
          if (priorityText) {
            return priorityText;
          }
        }
      }

      var values = Object.values(value);
      for (var v = 0; v < values.length; v += 1) {
        var nestedText = extractTextFromJourneyBuilderResponse(values[v], currentDepth + 1);
        if (nestedText) {
          return nestedText;
        }
      }
    }
    return "";
  }

  function toggleMute() {
    state.muted = !state.muted;
    setStatus(state.muted ? "Microfono muteado" : "Escuchando", false);
    updateButtons();
  }

  function toggleScreenShare() {
    if (state.screenStream) {
      stopScreenShare();
      return;
    }
    startScreenShare().catch(function (error) {
      setStatus(error.message || "No se pudo compartir pantalla", true);
      updateButtons();
    });
  }

  async function endAndMinimize() {
    await stopSession();
    setOpen(false);
  }

  function bindElements() {
    elements = {
      widget: document.getElementById("geminiAvatarWidget"),
      fab: document.getElementById("geminiAvatarFab"),
      statusDot: document.getElementById("geminiStatusDot"),
      statusText: document.getElementById("geminiStatusText"),
      startButton: document.getElementById("geminiStartButton"),
      muteButton: document.getElementById("geminiMuteButton"),
      screenButton: document.getElementById("geminiScreenButton"),
      minimizeButton: document.getElementById("geminiMinimizeButton"),
      endButton: document.getElementById("geminiEndButton"),
      transcriptPanel: document.getElementById("geminiTranscriptPanel"),
      actionPanel: document.getElementById("geminiActionPanel"),
      inputTranscript: document.getElementById("geminiInputTranscript"),
      outputTranscript: document.getElementById("geminiOutputTranscript"),
      screenBadge: document.getElementById("geminiScreenBadge"),
      anamVideo: document.getElementById("anamVideo"),
      talkingHeadStage: document.getElementById("talkingHeadStage"),
      deerAvatarStage: document.getElementById("deerAvatarStage"),
      portraitAvatarStage: document.getElementById("portraitAvatarStage"),
    };

    elements.fab.addEventListener("click", function () {
      setOpen(true);
      if (!state.ready && !state.starting) {
        startSession();
      }
    });
    elements.startButton.addEventListener("click", startSession);
    elements.muteButton.addEventListener("click", toggleMute);
    elements.screenButton.addEventListener("click", toggleScreenShare);
    elements.minimizeButton.addEventListener("click", function () {
      setOpen(false);
    });
    elements.endButton.addEventListener("click", endAndMinimize);
  }

  function init() {
    bindElements();
    document.body.classList.toggle("gemini-transcripts-hidden", config.hideTranscripts);
    setOpen(config.view !== "widget" || config.autoStart);
    if (shouldUsePortraitAvatar()) {
      startPortraitAvatar();
    } else if (shouldUseDeerAvatar()) {
      startDeerAvatar();
    }
    if (isMissingGeminiAuth()) {
      setStatus("Configurar Gemini", true);
    }
    updateButtons();

    if (config.autoStart) {
      startSession();
    }

    window.addEventListener("beforeunload", function () {
      stopSession();
      stopMouthAnimation();
      if (state.playbackContext) {
        state.playbackContext.close().catch(function () {});
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
