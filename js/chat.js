// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license.

// Global objects
var speechRecognizer
var avatarSynthesizer
var peerConnection
var peerConnectionDataChannel
var messages = []
var messageInitiated = false
var enableDisplayTextAlignmentWithSpeech = true
var journeyBuilderSessionId = ""
var isSpeaking = false
var isReconnecting = false
var speakingText = ""
var spokenTextQueue = []
var repeatSpeakingSentenceAfterReconnection = true
var sessionActive = false
var userClosedSession = false
var lastInteractionTime = new Date()
var lastSpeakTime
var imgUrl = ""
var connectionEstablishTimeoutId = null
var sessionActivationTimeoutId = null
var isConnecting = false
var isWidgetMode = false
var widgetOpen = false
var isMicrophoneListening = false
var autoMicStream = null
var autoMicAudioContext = null
var autoMicAnalyser = null
var autoMicDataArray = null
var autoMicIntervalId = null
var autoMicSoundDetectedAt = 0
var autoMicLastTriggerAt = 0
var autoMicStartCooldownMs = 2000
var autoMicMinActiveMs = 180
var autoMicThresholdRms = 0.024

function getMainVideoWidth() {
    return isWidgetMode ? '100%' : '960px'
}

function setRemoteVideoExpanded() {
    document.getElementById('remoteVideo').style.width = getMainVideoWidth()
}

function setRemoteVideoCollapsed() {
    document.getElementById('remoteVideo').style.width = '0.1px'
}

function setWidgetStatus(text, isError = false) {
    const textElement = document.getElementById('widgetStatusText')
    if (textElement !== null) {
        textElement.textContent = text
    }

    const statusDot = document.querySelector('.status-dot')
    if (statusDot !== null) {
        statusDot.style.background = isError ? '#d64f42' : '#25b665'
        statusDot.style.boxShadow = isError
            ? '0 0 0 4px rgba(214, 79, 66, 0.18)'
            : '0 0 0 4px rgba(37, 182, 101, 0.14)'
    }
}

function setSessionHint(text) {
    const sessionHint = document.getElementById('sessionHint')
    if (sessionHint !== null) {
        sessionHint.textContent = text
    }
}

function setAutoMicStatus(text, isError = false) {
    const autoMicStatus = document.getElementById('autoMicStatus')
    if (autoMicStatus !== null) {
        autoMicStatus.textContent = text
        autoMicStatus.classList.toggle('error', isError)
    }
}

function setMicrophoneUiState(listening, disabled) {
    const microphoneButton = document.getElementById('microphone')
    if (microphoneButton === null) {
        return
    }

    microphoneButton.innerHTML = listening ? 'Micrófono escuchando' : 'Micrófono automático'
    microphoneButton.disabled = disabled
}

function setConfigurationVisibility(visible) {
    const configuration = document.getElementById('configuration')
    if (configuration === null) {
        return
    }

    if (isWidgetMode) {
        configuration.hidden = true
        return
    }

    configuration.hidden = !visible
}

function syncWidgetIframeFrame(open) {
    if (!isWidgetMode) {
        return
    }

    const frame = window.frameElement
    if (frame === null || frame === undefined || frame.tagName !== 'IFRAME') {
        return
    }

    try {
        frame.style.border = '0'
        frame.style.background = 'transparent'
        frame.style.overflow = 'hidden'
        frame.style.right = 'max(8px, 2vw)'
        frame.style.bottom = 'max(8px, 2vw)'

        if (open) {
            frame.width = '360'
            frame.height = '640'
            frame.style.width = 'clamp(280px, calc(100vw - 16px), 360px)'
            frame.style.height = 'clamp(420px, calc(100vh - 16px), 560px)'
            frame.style.borderRadius = '16px'
            frame.style.boxShadow = '0 20px 40px rgba(0,0,0,0.22)'
            return
        }

        frame.width = '84'
        frame.height = '84'
        frame.style.width = '84px'
        frame.style.height = '84px'
        frame.style.borderRadius = '0'
        frame.style.boxShadow = 'none'
    } catch (error) {
        console.debug('Unable to sync avatar iframe frame:', error)
    }
}

function setWidgetOpenState(open) {
    widgetOpen = open
    document.body.classList.toggle('avatar-widget-open', open)
    syncWidgetIframeFrame(open)

    const shell = document.getElementById('avatarWidgetShell')
    if (shell !== null) {
        shell.setAttribute('aria-hidden', open ? 'false' : 'true')
    }

    const fab = document.getElementById('avatarFab')
    if (fab !== null) {
        fab.setAttribute('aria-expanded', open ? 'true' : 'false')
        fab.setAttribute('aria-label', open ? 'Cerrar avatar' : 'Abrir avatar')
        fab.title = open ? 'Cerrar avatar' : 'Abrir avatar'
    }
}

function clearConnectionEstablishTimeout() {
    if (connectionEstablishTimeoutId !== null) {
        clearTimeout(connectionEstablishTimeoutId)
        connectionEstablishTimeoutId = null
    }
}

function clearSessionActivationTimeout() {
    if (sessionActivationTimeoutId !== null) {
        clearTimeout(sessionActivationTimeoutId)
        sessionActivationTimeoutId = null
    }
}

function startConnectionEstablishTimeout() {
    clearConnectionEstablishTimeout()

    connectionEstablishTimeoutId = setTimeout(() => {
        if (sessionActive) {
            return
        }

        const state = peerConnection ? peerConnection.iceConnectionState : 'unknown'
        handleAvatarSessionError(
            `WebRTC connection timeout (state: ${state}). Please verify your network/VPN/firewall and try again.`,
            state
        )
    }, 15000)
}

function resetSessionUi() {
    clearConnectionEstablishTimeout()
    clearSessionActivationTimeout()
    isConnecting = false
    isMicrophoneListening = false
    document.getElementById('startSession').disabled = false
    setMicrophoneUiState(false, true)
    document.getElementById('stopSession').disabled = true
    setConfigurationVisibility(true)
    document.getElementById('chatHistory').hidden = true
    document.getElementById('showTypeMessage').checked = false
    document.getElementById('showTypeMessage').disabled = true
    document.getElementById('showTypeMessageCheckbox').hidden = isWidgetMode
    document.getElementById('userMessageBox').hidden = true
    document.getElementById('uploadImgIcon').hidden = true
    document.getElementById('subtitles').hidden = true
    setRemoteVideoExpanded()
    document.getElementById('localVideo').hidden = true
    isReconnecting = false
    stopAutoMicrophoneDetection()
    setSessionHint('Abrir avatar crea una sesión nueva. Cerrar avatar finaliza la sesión actual.')
    setAutoMicStatus('Micrófono automático en espera de voz.')
    setWidgetStatus('Listo para iniciar')
}

function releaseAvatarClients() {
    clearConnectionEstablishTimeout()
    clearSessionActivationTimeout()
    isConnecting = false
    isMicrophoneListening = false
    stopAutoMicrophoneDetection()
    setMicrophoneUiState(false, true)

    if (avatarSynthesizer !== undefined) {
        avatarSynthesizer.close()
        avatarSynthesizer = undefined
    }

    if (speechRecognizer !== undefined) {
        try {
            speechRecognizer.stopContinuousRecognitionAsync()
        } catch (error) {
            console.warn('Speech recognizer stop failed:', error)
        }
        speechRecognizer.close()
        speechRecognizer = undefined
    }

    if (peerConnectionDataChannel !== undefined && peerConnectionDataChannel !== null) {
        try {
            peerConnectionDataChannel.close()
        } catch (error) {
            console.warn('Data channel close failed:', error)
        }
        peerConnectionDataChannel = undefined
    }

    if (peerConnection !== undefined && peerConnection !== null) {
        try {
            peerConnection.close()
        } catch (error) {
            console.warn('Peer connection close failed:', error)
        }
        peerConnection = undefined
    }

    sessionActive = false
}

function handleAvatarSessionError(errorMessage, errorDetails) {
    if (errorDetails) {
        console.error(errorMessage, errorDetails)
    } else {
        console.error(errorMessage)
    }

    releaseAvatarClients()
    resetSessionUi()
    setSessionHint('No se pudo abrir la sesión del avatar. Reintentá con "Abrir avatar".')
    setAutoMicStatus('Micrófono automático inactivo por error de sesión.', true)
    setWidgetStatus('Error de conexión', true)

    if (!isReconnecting) {
        alert(errorMessage)
    }
}

function buildAvatarStartErrorMessage(rawErrorDetails) {
    const details = String(rawErrorDetails || '').trim()
    const lower = details.toLowerCase()

    if (
        lower.includes('error code: 4429') ||
        lower.includes('throttled') ||
        lower.includes('concurrent request limit')
    ) {
        return 'Azure Avatar reached its concurrent session limit (4429). Close other avatar sessions/tabs and retry in 1-2 minutes.'
    }

    if (!details) {
        return 'Unable to start avatar session.'
    }

    return `Unable to start avatar: ${details}`
}

function ensureLocalIdleVideoSource() {
    const localVideoPlayer = document.getElementById('localVideoPlayer')
    if (localVideoPlayer === null) {
        return
    }

    const character = document.getElementById('talkingAvatarCharacter').value.trim() || 'lisa'
    const style = document.getElementById('talkingAvatarStyle').value.trim() || 'casual-sitting'
    const desiredSource = `video/${character}-${style}-idle.mp4`

    if (localVideoPlayer.getAttribute('src') !== desiredSource) {
        localVideoPlayer.setAttribute('src', desiredSource)
    }
}

function stopAutoMicrophoneDetection() {
    if (autoMicIntervalId !== null) {
        clearInterval(autoMicIntervalId)
        autoMicIntervalId = null
    }

    if (autoMicStream !== null) {
        autoMicStream.getTracks().forEach((track) => track.stop())
        autoMicStream = null
    }

    if (autoMicAudioContext !== null) {
        autoMicAudioContext.close().catch(() => {})
        autoMicAudioContext = null
    }

    autoMicAnalyser = null
    autoMicDataArray = null
    autoMicSoundDetectedAt = 0
}

function getRmsFromByteData(byteArray) {
    if (byteArray === null || byteArray.length === 0) {
        return 0
    }

    let sumSquares = 0
    for (let i = 0; i < byteArray.length; i += 1) {
        const centered = (byteArray[i] - 128) / 128
        sumSquares += centered * centered
    }

    return Math.sqrt(sumSquares / byteArray.length)
}

async function startAutoMicrophoneDetection() {
    if (autoMicIntervalId !== null || !sessionActive) {
        return
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setAutoMicStatus('Micrófono automático no disponible en este navegador.', true)
        return
    }

    try {
        autoMicStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (error) {
        setAutoMicStatus('No se pudo acceder al micrófono automático.', true)
        console.error('Auto microphone permission denied:', error)
        return
    }

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext
    if (!AudioContextCtor) {
        setAutoMicStatus('Micrófono automático no disponible en este navegador.', true)
        stopAutoMicrophoneDetection()
        return
    }

    autoMicAudioContext = new AudioContextCtor()
    const source = autoMicAudioContext.createMediaStreamSource(autoMicStream)
    autoMicAnalyser = autoMicAudioContext.createAnalyser()
    autoMicAnalyser.fftSize = 1024
    autoMicDataArray = new Uint8Array(autoMicAnalyser.fftSize)
    source.connect(autoMicAnalyser)
    autoMicLastTriggerAt = Date.now() - autoMicStartCooldownMs
    setAutoMicStatus('Micrófono automático en espera de voz.')

    autoMicIntervalId = setInterval(() => {
        if (!sessionActive || isConnecting || isSpeaking || autoMicAnalyser === null || autoMicDataArray === null) {
            autoMicSoundDetectedAt = 0
            return
        }

        if (isMicrophoneListening) {
            autoMicSoundDetectedAt = 0
            return
        }

        autoMicAnalyser.getByteTimeDomainData(autoMicDataArray)
        const rms = getRmsFromByteData(autoMicDataArray)
        const now = Date.now()

        if (rms >= autoMicThresholdRms) {
            if (autoMicSoundDetectedAt === 0) {
                autoMicSoundDetectedAt = now
                return
            }

            const activeForMs = now - autoMicSoundDetectedAt
            const cooldownReady = now - autoMicLastTriggerAt >= autoMicStartCooldownMs
            if (activeForMs >= autoMicMinActiveMs && cooldownReady) {
                autoMicLastTriggerAt = now
                autoMicSoundDetectedAt = 0
                setAutoMicStatus('Voz detectada. Activando micrófono...')
                window.microphone(true)
            }
            return
        }

        autoMicSoundDetectedAt = 0
    }, 120)
}

function normalizeEndpointHost(rawValue) {
    const raw = String(rawValue || '').trim()
    if (raw === '') {
        return ''
    }

    const withScheme = raw.includes('://') ? raw : `https://${raw}`
    try {
        const parsed = new URL(withScheme)
        return parsed.host
    } catch (error) {
        return raw.replace(/^https?:\/\//i, '').replace(/\/+$/, '')
    }
}

function buildAvatarSpeechSessionEndpoint(hostUrl) {
    const normalizedHostUrl = String(hostUrl || '').trim().replace(/\/+$/, '')
    if (normalizedHostUrl === '') {
        return ''
    }

    if (normalizedHostUrl.includes('/api/v1/avatar/speech-session')) {
        return normalizedHostUrl
    }

    if (normalizedHostUrl.includes('/api/v1/run/')) {
        const runSegmentIndex = normalizedHostUrl.indexOf('/api/v1/run/')
        const baseUrl = normalizedHostUrl.slice(0, runSegmentIndex)
        return `${baseUrl}/api/v1/avatar/speech-session`
    }

    if (normalizedHostUrl.endsWith('/api/v1')) {
        return `${normalizedHostUrl}/avatar/speech-session`
    }

    return `${normalizedHostUrl}/api/v1/avatar/speech-session`
}

function buildAzureRelayTokenUrl(cogSvcRegion, privateEndpointHost) {
    if (privateEndpointHost) {
        return `https://${privateEndpointHost}/tts/cognitiveservices/avatar/relay/token/v1`
    }
    return `https://${cogSvcRegion}.tts.speech.microsoft.com/cognitiveservices/avatar/relay/token/v1`
}

function parseAndValidateRelayTokenPayload(relayPayload) {
    if (
        !relayPayload ||
        !Array.isArray(relayPayload.Urls) ||
        relayPayload.Urls.length === 0 ||
        !relayPayload.Username ||
        !relayPayload.Password
    ) {
        throw new Error('Avatar relay token response is incomplete.')
    }

    return {
        iceServerUrl: relayPayload.Urls[0],
        iceServerUsername: relayPayload.Username,
        iceServerCredential: relayPayload.Password,
    }
}

async function fetchAvatarSpeechSession(hostUrl, jbApiKey) {
    const endpoint = buildAvatarSpeechSessionEndpoint(hostUrl)
    if (endpoint === '') {
        throw new Error('JB API Base URL is required to request avatar speech session.')
    }

    const requestHeaders = {}
    if (jbApiKey && jbApiKey.trim() !== '') {
        requestHeaders['x-api-key'] = jbApiKey.trim()
    }

    const response = await fetch(endpoint, {
        method: 'GET',
        headers: requestHeaders,
    })
    if (!response.ok) {
        const responseText = await response.text()
        throw new Error(
            `Journey Builder avatar speech session request failed (HTTP ${response.status}). ${responseText}`
        )
    }

    return await response.json()
}

async function fetchAvatarRelayTokenFromAzure(cogSvcRegion, cogSvcSubKey, privateEndpointHost) {
    const relayTokenUrl = buildAzureRelayTokenUrl(cogSvcRegion, privateEndpointHost)
    const response = await fetch(relayTokenUrl, {
        method: 'GET',
        headers: {
            'Ocp-Apim-Subscription-Key': cogSvcSubKey,
        },
    })

    if (!response.ok) {
        const responseText = await response.text()
        throw new Error(
            `Unable to get avatar relay token (HTTP ${response.status}). ${responseText}`
        )
    }

    return await response.json()
}

// Connect to avatar service
async function connectAvatar() {
    if (isConnecting) {
        console.log('Avatar connection is already in progress.')
        return
    }

    const cogSvcRegion = document.getElementById('region').value.trim()
    const cogSvcSubKey = document.getElementById('APIKey').value.trim()
    const privateEndpointEnabled = document.getElementById('enablePrivateEndpoint').checked
    const privateEndpoint = normalizeEndpointHost(document.getElementById('privateEndpoint').value)
    if (privateEndpointEnabled && privateEndpoint === '') {
        setSessionHint('Falta configurar el endpoint privado de Azure Speech.')
        alert('Please fill in the Azure Speech endpoint.')
        return
    }

    const journeyBuilderConfig = getJourneyBuilderConfig()
    if (journeyBuilderConfig.hostUrl === '' || journeyBuilderConfig.flowId === '') {
        releaseAvatarClients()
        setSessionHint('Faltan parámetros del flujo de Journey Builder.')
        alert('Please fill in JB API Base URL and Flow ID.')
        return
    }

    if (journeyBuilderSessionId === '') {
        journeyBuilderSessionId = `avatar-${journeyBuilderConfig.flowId}-${Date.now()}`
    }

    // Only initialize messages once
    if (!messageInitiated) {
        initMessages()
        messageInitiated = true
    }

    let effectiveSpeechRegion = cogSvcRegion
    let speechAuthorizationToken = ''
    let relayPayload = null

    if (cogSvcSubKey === '') {
        if (journeyBuilderConfig.apiKey === '') {
            setSessionHint('Falta API key para abrir la sesión de avatar.')
            alert('Please fill in JB API Key or Azure Speech API Key.')
            return
        }

        try {
            setWidgetStatus('Obteniendo credenciales de voz...')
            const speechSession = await fetchAvatarSpeechSession(
                journeyBuilderConfig.hostUrl,
                journeyBuilderConfig.apiKey
            )
            speechAuthorizationToken = String(speechSession.authorizationToken || '').trim()
            effectiveSpeechRegion = String(speechSession.speechRegion || '').trim()
            relayPayload = speechSession.relay
            if (effectiveSpeechRegion !== '') {
                document.getElementById('region').value = effectiveSpeechRegion
            }
        } catch (error) {
            handleAvatarSessionError(
                'Unable to fetch avatar speech session from Journey Builder API.',
                error
            )
            return
        }

        if (effectiveSpeechRegion === '' || speechAuthorizationToken === '') {
            handleAvatarSessionError(
                'Journey Builder speech session response is incomplete.',
                'missing_region_or_token'
            )
            return
        }
    } else if (effectiveSpeechRegion === '') {
        setSessionHint('Falta la región de Azure Speech.')
        alert('Please fill in the Azure Speech region.')
        return
    }

    let speechSynthesisConfig
    let speechRecognitionConfig
    if (speechAuthorizationToken !== '') {
        speechSynthesisConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(
            speechAuthorizationToken,
            effectiveSpeechRegion
        )
        speechRecognitionConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(
            speechAuthorizationToken,
            effectiveSpeechRegion
        )
    } else if (privateEndpointEnabled) {
        speechSynthesisConfig = SpeechSDK.SpeechConfig.fromEndpoint(
            new URL(`wss://${privateEndpoint}/tts/cognitiveservices/websocket/v1?enableTalkingAvatar=true`),
            cogSvcSubKey
        )
        speechRecognitionConfig = SpeechSDK.SpeechConfig.fromEndpoint(
            new URL(`wss://${privateEndpoint}/stt/speech/universal/v2`),
            cogSvcSubKey
        )
    } else {
        speechSynthesisConfig = SpeechSDK.SpeechConfig.fromSubscription(cogSvcSubKey, effectiveSpeechRegion)
        speechRecognitionConfig = SpeechSDK.SpeechConfig.fromEndpoint(
            new URL(`wss://${effectiveSpeechRegion}.stt.speech.microsoft.com/speech/universal/v2`),
            cogSvcSubKey
        )
    }
    speechSynthesisConfig.endpointId = document.getElementById('customVoiceEndpointId').value

    const talkingAvatarCharacter = document.getElementById('talkingAvatarCharacter').value
    const talkingAvatarStyle = document.getElementById('talkingAvatarStyle').value
    const avatarConfig = new SpeechSDK.AvatarConfig(talkingAvatarCharacter, talkingAvatarStyle)
    avatarConfig.customized = document.getElementById('customizedAvatar').checked
    avatarConfig.useBuiltInVoice = document.getElementById('useBuiltInVoice').checked
    avatarSynthesizer = new SpeechSDK.AvatarSynthesizer(speechSynthesisConfig, avatarConfig)
    avatarSynthesizer.avatarEventReceived = function (s, e) {
        var offsetMessage = ", offset from session start: " + e.offset / 10000 + "ms."
        if (e.offset === 0) {
            offsetMessage = ""
        }

        console.log("Event received: " + e.description + offsetMessage)
    }

    speechRecognitionConfig.setProperty(SpeechSDK.PropertyId.SpeechServiceConnection_LanguageIdMode, "Continuous")
    var sttLocales = document.getElementById('sttLocales').value.split(',')
    var autoDetectSourceLanguageConfig = SpeechSDK.AutoDetectSourceLanguageConfig.fromLanguages(sttLocales)
    speechRecognizer = SpeechSDK.SpeechRecognizer.FromConfig(
        speechRecognitionConfig,
        autoDetectSourceLanguageConfig,
        SpeechSDK.AudioConfig.fromDefaultMicrophoneInput()
    )

    isConnecting = true
    document.getElementById('startSession').disabled = true
    document.getElementById('stopSession').disabled = false
    setConfigurationVisibility(false)
    setMicrophoneUiState(false, true)
    setSessionHint('Abriendo sesión de avatar...')
    setAutoMicStatus('Inicializando micrófono automático...')
    setWidgetStatus('Conectando avatar...')

    if (relayPayload === null) {
        try {
            relayPayload = await fetchAvatarRelayTokenFromAzure(
                effectiveSpeechRegion,
                cogSvcSubKey,
                privateEndpointEnabled ? privateEndpoint : ''
            )
        } catch (error) {
            handleAvatarSessionError(
                'Unable to get avatar relay token from Azure Speech.',
                error
            )
            return
        }
    }

    try {
        const relayConfig = parseAndValidateRelayTokenPayload(relayPayload)
        setupWebRTC(
            relayConfig.iceServerUrl,
            relayConfig.iceServerUsername,
            relayConfig.iceServerCredential
        )
    } catch (error) {
        handleAvatarSessionError(
            'Unable to parse avatar relay token response.',
            error
        )
    }
}

// Disconnect from avatar service
function disconnectAvatar() {
    releaseAvatarClients()
}

// Setup WebRTC
function setupWebRTC(iceServerUrl, iceServerUsername, iceServerCredential) {
    // Create WebRTC peer connection
    peerConnection = new RTCPeerConnection({
        iceServers: [{
            urls: [ iceServerUrl ],
            username: iceServerUsername,
            credential: iceServerCredential
        }]
    })

    // Fetch WebRTC streams and mount media elements
    peerConnection.ontrack = function (event) {
        const incomingStream =
            event.streams && event.streams.length > 0 ? event.streams[0] : null
        console.log(`WebRTC ontrack: ${event.track.kind}`)

        const mountRemoteVideo = (stream) => {
            let remoteVideoDiv = document.getElementById('remoteVideo')
            let videoElement = document.getElementById('videoPlayer')
            if (videoElement === null) {
                videoElement = document.createElement('video')
                videoElement.id = 'videoPlayer'
            }

            videoElement.srcObject = stream
            videoElement.autoplay = true
            videoElement.playsInline = true
            videoElement.muted = true
            videoElement.style.width = '0.5px'

            let videoUiReady = false
            const finalizeVideoUi = () => {
                if (videoUiReady) {
                    return
                }

                videoUiReady = true
                clearConnectionEstablishTimeout()
                isConnecting = false

                // Keep only the main video element mounted
                remoteVideoDiv = document.getElementById('remoteVideo')
                for (var i = 0; i < remoteVideoDiv.childNodes.length; i++) {
                    const node = remoteVideoDiv.childNodes[i]
                    if (
                        node.localName === 'video' &&
                        node.id !== 'videoPlayer'
                    ) {
                        remoteVideoDiv.removeChild(node)
                        i--
                    }
                }

                videoElement.style.width = getMainVideoWidth()
                if (!remoteVideoDiv.contains(videoElement)) {
                    remoteVideoDiv.appendChild(videoElement)
                }

                console.log('WebRTC video channel connected.')
                setMicrophoneUiState(false, false)
                document.getElementById('stopSession').disabled = false
                setRemoteVideoExpanded()
                if (isWidgetMode) {
                    document.getElementById('chatHistory').hidden = true
                    document.getElementById('showTypeMessage').disabled = true
                    document.getElementById('showTypeMessageCheckbox').hidden = true
                } else {
                    document.getElementById('chatHistory').hidden = false
                    document.getElementById('showTypeMessage').disabled = false
                    document.getElementById('showTypeMessageCheckbox').hidden = false
                }

                if (document.getElementById('useLocalVideoForIdle').checked) {
                    document.getElementById('localVideo').hidden = true
                    if (lastSpeakTime === undefined) {
                        lastSpeakTime = new Date()
                    }
                }

                isReconnecting = false
                setWidgetStatus('Avatar conectado')
                setSessionHint('Avatar abierto. Cerrar avatar finaliza la sesión actual.')
                setAutoMicStatus('Micrófono automático en espera de voz.')
                clearSessionActivationTimeout()
                sessionActivationTimeoutId = setTimeout(() => {
                    if (userClosedSession || avatarSynthesizer === undefined) {
                        return
                    }
                    sessionActive = true
                    startAutoMicrophoneDetection()
                }, 5000) // Set session active after 5 seconds
            }

            videoElement.onplaying = () => {
                finalizeVideoUi()
            }

            videoElement.onloadedmetadata = () => {
                if (videoElement.paused) {
                    videoElement.play().catch((error) => {
                        console.debug('Video autoplay fallback skipped:', error)
                    })
                }

                setTimeout(() => {
                    finalizeVideoUi()
                }, 200)
            }

            if (!remoteVideoDiv.contains(videoElement)) {
                remoteVideoDiv.appendChild(videoElement)
            }
            videoElement.play().catch((error) => {
                console.debug('Initial video play attempt skipped:', error)
            })
        }

        // Continue speaking if there are unfinished sentences
        if (event.track.kind === 'video') {
            if (repeatSpeakingSentenceAfterReconnection) {
                if (speakingText !== '') {
                    speakNext(speakingText, 0, true)
                }
            } else if (spokenTextQueue.length > 0) {
                speakNext(spokenTextQueue.shift())
            }
        }

        // Fallback: some browsers fire only audio ontrack while stream still carries video
        if (incomingStream !== null && incomingStream.getVideoTracks().length > 0) {
            mountRemoteVideo(incomingStream)
        }

        if (event.track.kind === 'audio') {
            let audioElement = document.createElement('audio')
            audioElement.id = 'audioPlayer'
            audioElement.srcObject = incomingStream
            audioElement.autoplay = true

            audioElement.onplaying = () => {
                console.log(`WebRTC ${event.track.kind} channel connected.`)
            }

            // Clean up existing audio element if there is any
            remoteVideoDiv = document.getElementById('remoteVideo')
            for (var i = 0; i < remoteVideoDiv.childNodes.length; i++) {
                if (remoteVideoDiv.childNodes[i].localName === event.track.kind) {
                    remoteVideoDiv.removeChild(remoteVideoDiv.childNodes[i])
                }
            }

            // Append the new audio element
            document.getElementById('remoteVideo').appendChild(audioElement)
        }
    }
    
     // Listen to data channel, to get the event from the server
    peerConnection.addEventListener("datachannel", event => {
        peerConnectionDataChannel = event.channel
        peerConnectionDataChannel.onmessage = e => {
            let subtitles = document.getElementById('subtitles')
            const webRTCEvent = JSON.parse(e.data)
            if (webRTCEvent.event.eventType === 'EVENT_TYPE_TURN_START' && document.getElementById('showSubtitles').checked) {
                subtitles.hidden = false
                subtitles.innerHTML = speakingText
            } else if (webRTCEvent.event.eventType === 'EVENT_TYPE_SESSION_END' || webRTCEvent.event.eventType === 'EVENT_TYPE_SWITCH_TO_IDLE') {
                subtitles.hidden = true
                if (webRTCEvent.event.eventType === 'EVENT_TYPE_SESSION_END') {
                    if (document.getElementById('autoReconnectAvatar').checked && !userClosedSession && !isReconnecting) {
                        // No longer reconnect when there is no interaction for a while
                        if (new Date() - lastInteractionTime < 300000) {
                            // Session disconnected unexpectedly, need reconnect
                            console.log(`[${(new Date()).toISOString()}] The WebSockets got disconnected, need reconnect.`)
                            isReconnecting = true

                            // Remove data channel onmessage callback to avoid duplicatedly triggering reconnect
                            peerConnectionDataChannel.onmessage = null

                            // Release the existing avatar connection
                            if (avatarSynthesizer !== undefined) {
                                avatarSynthesizer.close()
                            }

                            // Setup a new avatar connection
                            connectAvatar()
                        }
                    }
                }
            }

            console.log("[" + (new Date()).toISOString() + "] WebRTC event received: " + e.data)
        }
    })

    // This is a workaround to make sure the data channel listening is working by creating a data channel from the client side
    c = peerConnection.createDataChannel("eventChannel")

    // Make necessary update to the web page when the connection state changes
    peerConnection.oniceconnectionstatechange = e => {
        console.log("WebRTC status: " + peerConnection.iceConnectionState)
        if (
            peerConnection.iceConnectionState === 'connected' ||
            peerConnection.iceConnectionState === 'completed'
        ) {
            clearConnectionEstablishTimeout()
        } else if (peerConnection.iceConnectionState === 'failed') {
            handleAvatarSessionError(
                'WebRTC connection failed before receiving avatar media stream.',
                peerConnection.iceConnectionState
            )
            return
        }

        if (peerConnection.iceConnectionState === 'disconnected') {
            stopAutoMicrophoneDetection()
            setAutoMicStatus('Conexión del avatar interrumpida.', true)
            if (document.getElementById('useLocalVideoForIdle').checked) {
                ensureLocalIdleVideoSource()
                document.getElementById('localVideo').hidden = false
                setRemoteVideoCollapsed()
            }
        }
    }

    // Offer to receive 1 audio, and 1 video track
    peerConnection.addTransceiver('video', { direction: 'sendrecv' })
    peerConnection.addTransceiver('audio', { direction: 'sendrecv' })
    startConnectionEstablishTimeout()

    // start avatar, establish WebRTC connection
    avatarSynthesizer.startAvatarAsync(peerConnection).then((r) => {
        if (r.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
            console.log("[" + (new Date()).toISOString() + "] Avatar started. Result ID: " + r.resultId)
        } else {
            console.log("[" + (new Date()).toISOString() + "] Unable to start avatar. Result ID: " + r.resultId)
            if (r.reason === SpeechSDK.ResultReason.Canceled) {
                let cancellationDetails = SpeechSDK.CancellationDetails.fromResult(r)
                if (cancellationDetails.reason === SpeechSDK.CancellationReason.Error) {
                    console.log(cancellationDetails.errorDetails)
                }

                handleAvatarSessionError(
                    buildAvatarStartErrorMessage(cancellationDetails.errorDetails),
                    cancellationDetails
                )
                return
            }
            handleAvatarSessionError('Unable to start avatar session.', r)
        }
    }).catch(
        (error) => {
            handleAvatarSessionError(
                'Avatar failed to start. Check Azure Speech region and API key.',
                error
            )
        }
    )
}

// Initialize messages
function initMessages() {
    messages = []

    let systemPrompt = document.getElementById('prompt').value.trim()
    if (systemPrompt !== '') {
        messages.push({
            role: 'system',
            content: systemPrompt
        })
    }
}

function getJourneyBuilderConfig() {
    return {
        hostUrl: document.getElementById('jbApiBaseUrl').value.trim().replace(/\/$/, ''),
        flowId: document.getElementById('jbFlowId').value.trim(),
        apiKey: document.getElementById('jbApiKey').value.trim()
    }
}

function buildJourneyBuilderRunEndpoint(hostUrl, flowId) {
    if (hostUrl.includes('/api/v1/run/')) {
        return hostUrl.includes('?') ? `${hostUrl}&stream=false` : `${hostUrl}?stream=false`
    }

    if (hostUrl.endsWith('/api/v1')) {
        return `${hostUrl}/run/${flowId}?stream=false`
    }

    return `${hostUrl}/api/v1/run/${flowId}?stream=false`
}

function extractTextFromJourneyBuilderResponse(responseData) {
    if (responseData === null || responseData === undefined) {
        return ''
    }

    if (typeof responseData === 'string') {
        return responseData
    }

    if (Array.isArray(responseData)) {
        for (const item of responseData) {
            const text = extractTextFromJourneyBuilderResponse(item)
            if (text) {
                return text
            }
        }
        return ''
    }

    if (typeof responseData === 'object') {
        if (typeof responseData.text === 'string' && responseData.text.trim() !== '') {
            return responseData.text
        }

        if (
            responseData.data &&
            typeof responseData.data === 'object' &&
            typeof responseData.data.text === 'string' &&
            responseData.data.text.trim() !== ''
        ) {
            return responseData.data.text
        }

        const priorityKeys = ['message', 'results', 'outputs', 'output', 'data']
        for (const key of priorityKeys) {
            if (key in responseData) {
                const text = extractTextFromJourneyBuilderResponse(responseData[key])
                if (text) {
                    return text
                }
            }
        }

        for (const value of Object.values(responseData)) {
            const text = extractTextFromJourneyBuilderResponse(value)
            if (text) {
                return text
            }
        }
    }

    return ''
}

// Do HTML encoding on given text
function htmlEncode(text) {
    const entityMap = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
      '/': '&#x2F;'
    };

    return String(text).replace(/[&<>"'\/]/g, (match) => entityMap[match])
}

// Speak the given text
function speak(text, endingSilenceMs = 0) {
    if (isSpeaking) {
        spokenTextQueue.push(text)
        return
    }

    speakNext(text, endingSilenceMs)
}

function speakNext(text, endingSilenceMs = 0, skipUpdatingChatHistory = false) {
    let ttsVoice = document.getElementById('ttsVoice').value
     let ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='en-US'><voice name='${ttsVoice}'><mstts:leadingsilence-exact value='0'/>${htmlEncode(text)}</voice></speak>`
    if (endingSilenceMs > 0) {
        ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='en-US'><voice name='${ttsVoice}'><mstts:leadingsilence-exact value='0'/>${htmlEncode(text)}<break time='${endingSilenceMs}ms' /></voice></speak>`
    }

    if (enableDisplayTextAlignmentWithSpeech && !skipUpdatingChatHistory) {
        let chatHistoryTextArea = document.getElementById('chatHistory')
        chatHistoryTextArea.innerHTML += text.replace(/\n/g, '<br/>')
        chatHistoryTextArea.scrollTop = chatHistoryTextArea.scrollHeight
    }

    lastSpeakTime = new Date()
    isSpeaking = true
    speakingText = text
    document.getElementById('stopSpeaking').disabled = false
    avatarSynthesizer.speakSsmlAsync(ssml).then(
        (result) => {
            if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
                console.log(`Speech synthesized to speaker for text [ ${text} ]. Result ID: ${result.resultId}`)
                lastSpeakTime = new Date()
            } else {
                console.log(`Error occurred while speaking the SSML. Result ID: ${result.resultId}`)
            }

            speakingText = ''

            if (spokenTextQueue.length > 0) {
                speakNext(spokenTextQueue.shift())
            } else {
                isSpeaking = false
                document.getElementById('stopSpeaking').disabled = true
            }
        }).catch(
            (error) => {
                console.log(`Error occurred while speaking the SSML: [ ${error} ]`)

                speakingText = ''

                if (spokenTextQueue.length > 0) {
                    speakNext(spokenTextQueue.shift())
                } else {
                    isSpeaking = false
                    document.getElementById('stopSpeaking').disabled = true
                }
            }
        )
}

function stopSpeaking() {
    lastInteractionTime = new Date()
    spokenTextQueue = []
    avatarSynthesizer.stopSpeakingAsync().then(
        () => {
            isSpeaking = false
            document.getElementById('stopSpeaking').disabled = true
            console.log("[" + (new Date()).toISOString() + "] Stop speaking request sent.")
        }
    ).catch(
        (error) => {
            console.log("Error occurred while stopping speaking: " + error)
        }
    )
}

function handleUserQuery(userQuery, userQueryHTML, imgUrlPath) {
    lastInteractionTime = new Date()
    let contentMessage = userQuery
    if (imgUrlPath.trim()) {
        contentMessage = [  
            { 
                "type": "text", 
                "text": userQuery 
            },
            { 
                "type": "image_url",
                "image_url": {
                    "url": imgUrlPath
                }
            }
        ]
    }
    let chatMessage = {
        role: 'user',
        content: contentMessage
    }

    messages.push(chatMessage)
    let chatHistoryTextArea = document.getElementById('chatHistory')
    if (chatHistoryTextArea.innerHTML !== '' && !chatHistoryTextArea.innerHTML.endsWith('\n\n')) {
        chatHistoryTextArea.innerHTML += '\n\n'
    }

    chatHistoryTextArea.innerHTML += imgUrlPath.trim() ? "<br/><br/>User: " + userQueryHTML : "<br/><br/>User: " + userQuery + "<br/>";
        
    chatHistoryTextArea.scrollTop = chatHistoryTextArea.scrollHeight

    // Stop previous speaking if there is any
    if (isSpeaking) {
        stopSpeaking()
    }

    const journeyBuilderConfig = getJourneyBuilderConfig()
    if (journeyBuilderConfig.hostUrl === '' || journeyBuilderConfig.flowId === '') {
        const errorMessage = "Error: faltan datos de configuración de Journey Builder (URL o Flow ID)."
        chatHistoryTextArea.innerHTML += `<br/>Assistant: ${errorMessage}`
        chatHistoryTextArea.scrollTop = chatHistoryTextArea.scrollHeight
        speak(errorMessage)
        return
    }

    if (journeyBuilderSessionId === '') {
        journeyBuilderSessionId = `avatar-${journeyBuilderConfig.flowId}-${Date.now()}`
    }

    const requestBody = {
        input_value: userQuery,
        input_type: 'chat',
        output_type: 'chat',
        session_id: journeyBuilderSessionId
    }

    const endpoint = buildJourneyBuilderRunEndpoint(
        journeyBuilderConfig.hostUrl,
        journeyBuilderConfig.flowId
    )
    const requestHeaders = {
        'Content-Type': 'application/json'
    }

    if (journeyBuilderConfig.apiKey) {
        requestHeaders['x-api-key'] = journeyBuilderConfig.apiKey
    }

    chatHistoryTextArea.innerHTML += imgUrlPath.trim() ? 'Assistant: ' : '<br/>Assistant: '

    fetch(endpoint, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(requestBody)
    })
        .then(response => {
            if (!response.ok) {
                throw new Error(`Journey Builder API response status: ${response.status} ${response.statusText}`)
            }
            return response.json()
        })
        .then(data => {
            let assistantReply = extractTextFromJourneyBuilderResponse(data)
            if (!assistantReply) {
                assistantReply = 'No se pudo obtener una respuesta del flujo.'
            }

            chatHistoryTextArea.innerHTML += assistantReply.replace(/\n/g, '<br/>')
            chatHistoryTextArea.scrollTop = chatHistoryTextArea.scrollHeight

            if (!enableDisplayTextAlignmentWithSpeech) {
                chatHistoryTextArea.innerHTML += '<br/>'
            }

            speak(assistantReply)

            messages.push({
                role: 'assistant',
                content: assistantReply
            })
        })
        .catch(error => {
            const errorMessage = `Error: ${error.message}`
            chatHistoryTextArea.innerHTML += errorMessage
            chatHistoryTextArea.scrollTop = chatHistoryTextArea.scrollHeight
            speak("Lo siento, ocurrió un error al consultar el flujo.")
        })
}

function checkHung() {
    // Check whether the avatar video stream is hung, by checking whether the video time is advancing
    let videoElement = document.getElementById('videoPlayer')
    if (videoElement !== null && videoElement !== undefined && sessionActive) {
        let videoTime = videoElement.currentTime
        setTimeout(() => {
            // Check whether the video time is advancing
            if (videoElement.currentTime === videoTime) {
                // Check whether the session is active to avoid duplicatedly triggering reconnect
                if (sessionActive) {
                    sessionActive = false
                    if (document.getElementById('autoReconnectAvatar').checked) {
                        // No longer reconnect when there is no interaction for a while
                        if (new Date() - lastInteractionTime < 300000) {
                            console.log(`[${(new Date()).toISOString()}] The video stream got disconnected, need reconnect.`)
                            isReconnecting = true
                            // Remove data channel onmessage callback to avoid duplicatedly triggering reconnect
                            peerConnectionDataChannel.onmessage = null
                            // Release the existing avatar connection
                            if (avatarSynthesizer !== undefined) {
                                avatarSynthesizer.close()
                            }
    
                            // Setup a new avatar connection
                            connectAvatar()
                        }
                    }
                }
            }
        }, 2000)
    }
}

function checkLastSpeak() {
    if (lastSpeakTime === undefined) {
        return
    }

    let currentTime = new Date()
    if (currentTime - lastSpeakTime > 15000) {
        if (document.getElementById('useLocalVideoForIdle').checked && sessionActive && !isSpeaking) {
            disconnectAvatar()
            ensureLocalIdleVideoSource()
            document.getElementById('localVideo').hidden = false
            setRemoteVideoCollapsed()
            sessionActive = false
        }
    }
}

function getEmbedQueryParams() {
    const search = String(window.location.search || '').trim()
    if (search !== '') {
        return new URLSearchParams(search)
    }

    const embeddedQuery = window.__JB_AVATAR_QUERY__
    if (typeof embeddedQuery === 'string' && embeddedQuery.trim() !== '') {
        const normalizedQuery = embeddedQuery.trim().startsWith('?')
            ? embeddedQuery.trim()
            : `?${embeddedQuery.trim()}`
        return new URLSearchParams(normalizedQuery)
    }

    return new URLSearchParams()
}

function loadJourneyBuilderParamsFromUrl() {
    const query = getEmbedQueryParams()
    const view = query.get('view') || query.get('mode')
    const widget = query.get('widget')
    const flowId = query.get('flowId') || query.get('flow_id')
    const apiKey = query.get('apiKey') || query.get('api_key')
    const hostUrl = query.get('hostUrl') || query.get('host_url')
    const prompt = query.get('prompt')
    const speechRegion = query.get('speechRegion') || query.get('speech_region')
    const speechApiKey = query.get('speechApiKey') || query.get('speech_api_key')
    const speechPrivateEndpoint = query.get('speechPrivateEndpoint') || query.get('speech_private_endpoint')
    const ttsVoice = query.get('ttsVoice') || query.get('tts_voice') || query.get('voice')
    const avatarCharacter =
        query.get('avatarCharacter') || query.get('avatar_character') || query.get('character')
    const avatarStyle = query.get('avatarStyle') || query.get('avatar_style') || query.get('style')
    const autoStart = query.get('autoStart') || query.get('auto_start')

    const shouldUseWidgetMode =
        view === 'widget' ||
        widget === '1' ||
        widget === 'true' ||
        widget === 'TRUE'

    if (shouldUseWidgetMode) {
        isWidgetMode = true
        document.body.classList.add('avatar-widget-mode')
    }

    if (flowId) {
        document.getElementById('jbFlowId').value = flowId
    }

    if (apiKey) {
        document.getElementById('jbApiKey').value = apiKey
    }

    if (hostUrl) {
        document.getElementById('jbApiBaseUrl').value = hostUrl
    }

    if (prompt) {
        document.getElementById('prompt').value = prompt
    }

    if (speechRegion) {
        document.getElementById('region').value = speechRegion
    }

    if (speechApiKey) {
        document.getElementById('APIKey').value = speechApiKey
    }

    if (speechPrivateEndpoint) {
        document.getElementById('privateEndpoint').value = speechPrivateEndpoint
        document.getElementById('enablePrivateEndpoint').checked = true
        window.updatePrivateEndpoint()
    }

    if (ttsVoice) {
        document.getElementById('ttsVoice').value = ttsVoice
    }

    if (avatarCharacter) {
        document.getElementById('talkingAvatarCharacter').value = avatarCharacter
    }

    if (avatarStyle) {
        document.getElementById('talkingAvatarStyle').value = avatarStyle
    }

    const shouldAutoStart =
        autoStart === '1' || autoStart === 'true' || autoStart === 'TRUE'
    const hasSpeechCredential =
        document.getElementById('APIKey').value.trim() !== '' ||
        document.getElementById('jbApiKey').value.trim() !== ''

    return (
        shouldAutoStart &&
        document.getElementById('jbFlowId').value.trim() !== '' &&
        document.getElementById('jbApiBaseUrl').value.trim() !== '' &&
        hasSpeechCredential
    )
}

window.onload = () => {
    const shouldAutoStart = loadJourneyBuilderParamsFromUrl()
    setRemoteVideoExpanded()
    setConfigurationVisibility(!isWidgetMode)
    setMicrophoneUiState(false, true)
    setSessionHint('Abrir avatar crea una sesión nueva. Cerrar avatar finaliza la sesión actual.')
    setAutoMicStatus('Micrófono automático en espera de voz.')
    document.getElementById('showTypeMessageCheckbox').hidden = isWidgetMode
    if (isWidgetMode) {
        setWidgetOpenState(false)
    } else {
        setWidgetOpenState(true)
    }
    setWidgetStatus('Listo para iniciar')
    setInterval(() => {
        checkHung()
        checkLastSpeak()
    }, 2000) // Check session activity every 2 seconds

    if (shouldAutoStart) {
        setTimeout(() => {
            if (isWidgetMode) {
                window.openAvatarWidget()
            } else {
                window.startSession()
            }
        }, 150)
    }
}

window.openAvatarWidget = () => {
    if (isWidgetMode && !widgetOpen) {
        setWidgetOpenState(true)
    }

    if (sessionActive || isConnecting || avatarSynthesizer !== undefined) {
        return
    }

    window.startSession()
}

window.closeAvatarWidget = () => {
    if (sessionActive || isConnecting || avatarSynthesizer !== undefined) {
        window.stopSession()
    } else {
        resetSessionUi()
    }

    if (isWidgetMode) {
        setWidgetOpenState(false)
    }
}

window.toggleAvatarWidget = () => {
    if (widgetOpen) {
        window.closeAvatarWidget()
    } else {
        window.openAvatarWidget()
    }
}

window.startSession = () => {
    if (isWidgetMode && !widgetOpen) {
        setWidgetOpenState(true)
    }

    if (isConnecting || sessionActive || avatarSynthesizer !== undefined) {
        return
    }

    lastInteractionTime = new Date()
    if (document.getElementById('useLocalVideoForIdle').checked) {
        ensureLocalIdleVideoSource()
        document.getElementById('startSession').disabled = true
        setConfigurationVisibility(false)
        setMicrophoneUiState(false, false)
        document.getElementById('stopSession').disabled = false
        document.getElementById('localVideo').hidden = false
        setRemoteVideoCollapsed()
        if (isWidgetMode) {
            document.getElementById('chatHistory').hidden = true
            document.getElementById('showTypeMessage').disabled = true
            document.getElementById('showTypeMessageCheckbox').hidden = true
        } else {
            document.getElementById('chatHistory').hidden = false
            document.getElementById('showTypeMessage').disabled = false
            document.getElementById('showTypeMessageCheckbox').hidden = false
        }
        setSessionHint('Modo idle local activo. Abrir avatar crea sesión cuando se conecte.')
        setAutoMicStatus('Micrófono automático en espera de voz.')
        setWidgetStatus('Modo idle local activo')
        return
    }

    window.clearChatHistory()
    userClosedSession = false
    document.getElementById('startSession').disabled = true
    document.getElementById('stopSession').disabled = false
    setConfigurationVisibility(false)
    setSessionHint('Abriendo avatar. Esta acción crea una sesión nueva.')
    setAutoMicStatus('Inicializando micrófono automático...')
    connectAvatar()
}

window.stopSession = () => {
    lastInteractionTime = new Date()

    if (!isConnecting && !sessionActive && avatarSynthesizer === undefined) {
        resetSessionUi()
        if (isWidgetMode) {
            setWidgetOpenState(false)
        }
        return
    }

    if (speechRecognizer !== undefined && isMicrophoneListening) {
        try {
            speechRecognizer.stopContinuousRecognitionAsync(() => {}, () => {})
        } catch (error) {
            console.warn('Speech recognizer stop failed:', error)
        }
    }

    isMicrophoneListening = false
    userClosedSession = true
    disconnectAvatar()
    journeyBuilderSessionId = ''
    messageInitiated = false
    resetSessionUi()
    setSessionHint('Sesión cerrada. Abrir avatar crea una sesión nueva.')
    setAutoMicStatus('Micrófono automático detenido. Abrí avatar para reactivarlo.')
    setWidgetStatus('Sesión cerrada')
    if (isWidgetMode) {
        setWidgetOpenState(false)
    }
}

window.clearChatHistory = () => {
    lastInteractionTime = new Date()
    document.getElementById('chatHistory').innerHTML = ''
    const flowId = document.getElementById('jbFlowId').value.trim() || 'flow'
    journeyBuilderSessionId = `avatar-${flowId}-${Date.now()}`
    initMessages()
    messageInitiated = true
}

window.microphone = (autoTriggered = false) => {
    lastInteractionTime = new Date()
    if (!sessionActive || speechRecognizer === undefined) {
        if (!autoTriggered) {
            setAutoMicStatus('Abrí avatar para habilitar el micrófono automático.', true)
        }
        return
    }

    if (isMicrophoneListening) {
        if (autoTriggered) {
            return
        }

        setMicrophoneUiState(true, true)
        speechRecognizer.stopContinuousRecognitionAsync(
            () => {
                isMicrophoneListening = false
                setMicrophoneUiState(false, false)
                setAutoMicStatus('Micrófono automático en espera de voz.')
            }, (err) => {
                console.log("Failed to stop continuous recognition:", err)
                setMicrophoneUiState(true, false)
            })
        return
    }

    const audioPlayer = document.getElementById('audioPlayer')
    if (audioPlayer !== null) {
        audioPlayer.play().catch((error) => {
            console.debug('Audio autoplay fallback skipped:', error)
        })
    }

    setMicrophoneUiState(false, true)
    speechRecognizer.recognized = async (s, e) => {
        if (e.result.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
            let userQuery = e.result.text.trim()
            if (userQuery === '') {
                return
            }

            if (!document.getElementById('continuousConversation').checked) {
                setMicrophoneUiState(true, true)
                speechRecognizer.stopContinuousRecognitionAsync(
                    () => {
                        isMicrophoneListening = false
                        setMicrophoneUiState(false, false)
                        setAutoMicStatus('Micrófono automático en espera de voz.')
                    }, (err) => {
                        console.log("Failed to stop continuous recognition:", err)
                        setMicrophoneUiState(true, false)
                    })
            }

            handleUserQuery(userQuery,"","")
        }
    }

    speechRecognizer.startContinuousRecognitionAsync(
        () => {
            isMicrophoneListening = true
            setMicrophoneUiState(true, false)
            setAutoMicStatus('Micrófono automático escuchando.')
        }, (err) => {
            console.log("Failed to start continuous recognition:", err)
            isMicrophoneListening = false
            setMicrophoneUiState(false, false)
            setAutoMicStatus('No se pudo activar el micrófono automático.', true)
        })
}

window.updateTypeMessageBox = () => {
    if (document.getElementById('showTypeMessage').checked) {
        document.getElementById('userMessageBox').hidden = false
        document.getElementById('uploadImgIcon').hidden = false
        document.getElementById('userMessageBox').addEventListener('keyup', (e) => {
            if (e.key === 'Enter') {
                const userQuery = document.getElementById('userMessageBox').innerText
                const messageBox = document.getElementById('userMessageBox')
                const childImg = messageBox.querySelector("#picInput")
                if (childImg) {
                    childImg.style.width = "200px"
                    childImg.style.height = "200px"
                }
                let userQueryHTML = messageBox.innerHTML.trim("")
                if(userQueryHTML.startsWith('<img')){
                    userQueryHTML="<br/>"+userQueryHTML
                }
                if (userQuery !== '') {
                    handleUserQuery(userQuery.trim(''), userQueryHTML, imgUrl)
                    document.getElementById('userMessageBox').innerHTML = ''
                    imgUrl = ""
                }
            }
        })
        document.getElementById('uploadImgIcon').addEventListener('click', function() {
            imgUrl = "https://wallpaperaccess.com/full/528436.jpg"
            const userMessage = document.getElementById("userMessageBox");
            const childImg = userMessage.querySelector("#picInput");
            if (childImg) {
                userMessage.removeChild(childImg)
            }
            userMessage.innerHTML+='<br/><img id="picInput" src="https://wallpaperaccess.com/full/528436.jpg" style="width:100px;height:100px"/><br/><br/>'   
        });
    } else {
        document.getElementById('userMessageBox').hidden = true
        document.getElementById('uploadImgIcon').hidden = true
        imgUrl = ""
    }
}

window.updateLocalVideoForIdle = () => {
    if (isWidgetMode) {
        document.getElementById('showTypeMessageCheckbox').hidden = true
        return
    }

    if (document.getElementById('useLocalVideoForIdle').checked) {
        ensureLocalIdleVideoSource()
        document.getElementById('showTypeMessageCheckbox').hidden = true
    } else {
        document.getElementById('showTypeMessageCheckbox').hidden = false
    }
}

window.updatePrivateEndpoint = () => {
    if (document.getElementById('enablePrivateEndpoint').checked) {
        document.getElementById('showPrivateEndpointCheckBox').hidden = false
    } else {
        document.getElementById('showPrivateEndpointCheckBox').hidden = true
    }
}

window.updateCustomAvatarBox = () => {
    if (document.getElementById('customizedAvatar').checked) {
        document.getElementById('useBuiltInVoice').disabled = false
    } else {
        document.getElementById('useBuiltInVoice').disabled = true
        document.getElementById('useBuiltInVoice').checked = false
    }
}
