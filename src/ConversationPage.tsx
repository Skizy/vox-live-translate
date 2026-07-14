import { GoogleGenAI, type LiveServerMessage, Modality, type Session } from "@google/genai";
import { createSignal, onCleanup } from "solid-js";
import Navigation from "./Navigation";

const MODEL = "models/gemini-3.5-live-translate-preview";
const INPUT_SAMPLE_RATE = 16_000;
const OUTPUT_SAMPLE_RATE = 24_000;
const INPUT_BUFFER_SIZE = 2048;
const SILENT_OUTGOING_AUDIO_DURATION_TO_END_TURN_MS = 3_000;

type ConversationPhase = "listening" | "speaking" | "playing" | "ending-play";

function bytesToBase64(bytes: Uint8Array) {
    let binary = "";
    const chunkSize = 0x8000;

    for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }

    return btoa(binary);
}

function base64ToBytes(base64: string) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
}

function floatToInt16Pcm(float32Data: Float32Array) {
    const int16Buffer = new Int16Array(float32Data.length);

    for (let index = 0; index < float32Data.length; index += 1) {
        const sample = Math.max(-1, Math.min(1, float32Data[index] ?? 0));
        int16Buffer[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }

    return new Uint8Array(int16Buffer.buffer);
}

export default function ConversationPage() {
    const [status, setStatus] = createSignal("Ready to start a conversation.");
    const [myLanguageCode, setMyLanguageCode] = createSignal("ru");
    const [companionLanguageCode, setCompanionLanguageCode] = createSignal("en");
    const [isConversing, setIsConversing] = createSignal(false);
    const [isConnecting, setIsConnecting] = createSignal(false);
    const [phase, setPhase] = createSignal<ConversationPhase>("listening");
    const [companionTranslation, setCompanionTranslation] = createSignal("");

    let myLanguageSession: Session | undefined;
    let companionLanguageSession: Session | undefined;
    let microphoneStream: MediaStream | undefined;
    let inputAudioContext: AudioContext | undefined;
    let outputAudioContext: AudioContext | undefined;
    let sourceNode: MediaStreamAudioSourceNode | undefined;
    let processorNode: ScriptProcessorNode | undefined;
    let silentGainNode: GainNode | undefined;
    let nextPlaybackTime = 0;
    let queuedOutgoingAudio: string[] = [];
    const activePlaybackSources = new Set<AudioBufferSourceNode>();
    let playbackGeneration = 0;
    let conversationGeneration = 0;
    let consecutiveSilentOutgoingAudioDurationMs = 0;
    let lastNonSilentOutgoingAudioTime = 0;
    let terminalSilenceTimer: number | undefined;
    let lastAudioRoutingLogTime = 0;

    function sendRealtimeAudio(session: Session | undefined, data: Uint8Array, direction: string) {
        if (!session) {
            console.warn("[Vox] Audio frame was not sent: session is unavailable", { direction, phase: phase() });
            return;
        }

        session.sendRealtimeInput({
            audio: {
                mimeType: "audio/pcm;rate=16000",
                data: bytesToBase64(data),
            },
        });
    }

    function getSilentPcm24kDurationMs(base64Audio: string) {
        const pcmBytes = base64ToBytes(base64Audio);

        if (!pcmBytes.every((byte) => byte === 0)) {
            return undefined;
        }

        return (pcmBytes.byteLength / (OUTPUT_SAMPLE_RATE * Int16Array.BYTES_PER_ELEMENT)) * 1_000;
    }

    function cancelTerminalSilenceTransition() {
        console.log("[Vox] Cancelling terminal silence transition");

        if (terminalSilenceTimer !== undefined) {
            window.clearTimeout(terminalSilenceTimer);
            terminalSilenceTimer = undefined;
        }
    }

    function flushQueuedOutgoingAudio() {
        if (queuedOutgoingAudio.length === 0) {
            return;
        }

        const audioChunks = queuedOutgoingAudio;
        queuedOutgoingAudio = [];
        for (const audio of audioChunks) {
            playPcm24k(audio);
        }
    }

    function finishEndingPlayback() {
        if (activePlaybackSources.size !== 0) {
            return;
        }

        if (queuedOutgoingAudio.length > 0) {
            flushQueuedOutgoingAudio();
            return;
        }

        if (phase() === "ending-play") {
            setPhase("listening");
            setStatus("Listening to your companion.");
        }
    }

    function advancePlaybackQueue() {
        if (activePlaybackSources.size !== 0) {
            return;
        }

        if (queuedOutgoingAudio.length > 0) {
            flushQueuedOutgoingAudio();
            return;
        }

        if (phase() === "ending-play") {
            finishEndingPlayback();
        } else if (phase() === "playing") {
            resumeListeningAfterTerminalSilence();
        }
    }

    function beginEndingPlayback() {
        if (phase() !== "playing") {
            return;
        }

        cancelTerminalSilenceTransition();
        setPhase("ending-play");
        setStatus("Finishing translation playback…");
        finishEndingPlayback();
    }

    function resumeListeningAfterTerminalSilence() {
        if (
            phase() !== "playing" ||
            consecutiveSilentOutgoingAudioDurationMs < SILENT_OUTGOING_AUDIO_DURATION_TO_END_TURN_MS
        ) {
            return;
        }

        const quietDurationMs = performance.now() - lastNonSilentOutgoingAudioTime;
        const remainingQuietDurationMs = Math.max(0, SILENT_OUTGOING_AUDIO_DURATION_TO_END_TURN_MS - quietDurationMs);
        if (remainingQuietDurationMs === 0) {
            beginEndingPlayback();
            return;
        }

        if (terminalSilenceTimer !== undefined) {
            return;
        }

        terminalSilenceTimer = window.setTimeout(() => {
            terminalSilenceTimer = undefined;
            if (
                phase() === "playing" &&
                consecutiveSilentOutgoingAudioDurationMs >= SILENT_OUTGOING_AUDIO_DURATION_TO_END_TURN_MS &&
                performance.now() - lastNonSilentOutgoingAudioTime >= SILENT_OUTGOING_AUDIO_DURATION_TO_END_TURN_MS
            ) {
                beginEndingPlayback();
            }
        }, remainingQuietDurationMs);
    }

    function playPcm24k(base64Audio: string) {
        const generation = playbackGeneration;
        outputAudioContext ??= new AudioContext();
        console.info("[Vox] Scheduling translation audio playback", {
            contextState: outputAudioContext.state,
            encodedBytes: base64Audio.length,
        });
        if (outputAudioContext.state !== "running") {
            console.warn("[Vox] Output audio context is not running; attempting to resume it", {
                state: outputAudioContext.state,
            });
            void outputAudioContext.resume().catch((error: unknown) => {
                console.error("[Vox] Could not resume output audio context", error);
            });
        }

        const pcmBytes = base64ToBytes(base64Audio);
        const samples = new Int16Array(
            pcmBytes.buffer,
            pcmBytes.byteOffset,
            pcmBytes.byteLength / Int16Array.BYTES_PER_ELEMENT,
        );
        const audioBuffer = outputAudioContext.createBuffer(1, samples.length, OUTPUT_SAMPLE_RATE);
        const channel = audioBuffer.getChannelData(0);

        for (let index = 0; index < samples.length; index += 1) {
            channel[index] = (samples[index] ?? 0) / 0x8000;
        }

        const source = outputAudioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(outputAudioContext.destination);
        source.onended = () => {
            if (generation !== playbackGeneration) {
                return;
            }

            activePlaybackSources.delete(source);
            advancePlaybackQueue();
        };

        const startAt = Math.max(outputAudioContext.currentTime, nextPlaybackTime);
        activePlaybackSources.add(source);
        source.start(startAt);
        nextPlaybackTime = startAt + audioBuffer.duration;
    }

    function observeIncomingAudioDuringPlayback(base64Audio: string) {
        const silentDurationMs = getSilentPcm24kDurationMs(base64Audio);
        if (silentDurationMs !== undefined) {
            consecutiveSilentOutgoingAudioDurationMs += silentDurationMs;
            console.info("[Vox] Received silent outgoing audio", {
                consecutiveDurationMs: consecutiveSilentOutgoingAudioDurationMs,
            });
            resumeListeningAfterTerminalSilence();
            return;
        }

        consecutiveSilentOutgoingAudioDurationMs = 0;
        lastNonSilentOutgoingAudioTime = performance.now();
        cancelTerminalSilenceTransition();
    }

    function receiveOutgoingAudio(base64Audio: string) {
        const p = phase();
        if (p === "speaking") {
            queuedOutgoingAudio.push(base64Audio);
            return;
        }

        if (p === "playing") {
            queuedOutgoingAudio.push(base64Audio);
            observeIncomingAudioDuringPlayback(base64Audio);
            advancePlaybackQueue();
            return;
        }

        if (p === "ending-play") {
            console.info("[Vox] Discarded outgoing audio while ending playback");
            return;
        }

        console.warn("[Vox] Discarded outgoing translation audio outside an active turn", { phase: p });
    }

    async function getEphemeralToken() {
        console.info("[Vox] Requesting Gemini ephemeral token");
        const response = await fetch("/api/get-ephemeral-token", { method: "POST" });
        console.info("[Vox] Gemini token response", response.status, response.statusText);

        if (!response.ok) {
            console.warn("[Vox] Token request failed", { status: response.status, statusText: response.statusText });
            throw new Error("Could not create a Gemini Live token.");
        }

        const { token } = (await response.json()) as { token?: string };

        if (!token) {
            console.warn("[Vox] Token response did not contain a token");
            throw new Error("Token response did not include a token.");
        }

        return token;
    }

    async function connectLiveTranslate(
        token: string,
        targetLanguageCode: string,
        responseModalities: Modality[],
        onMessage: (message: LiveServerMessage) => void,
        generation: number,
    ) {
        let hasOpened = false;
        console.info("[Vox] Opening Gemini session", { targetLanguageCode, responseModalities });
        const ai = new GoogleGenAI({ apiKey: token });

        return ai.live.connect({
            model: MODEL,
            config: {
                responseModalities,
                translationConfig: {
                    targetLanguageCode,
                    echoTargetLanguage: false,
                },
            },
            callbacks: {
                onopen: () => {
                    hasOpened = true;
                    console.info("[Vox] Gemini session opened", { targetLanguageCode, responseModalities });
                },
                onmessage: (message) => {
                    if (generation !== conversationGeneration) {
                        console.info("[Vox] Ignoring message from a stale Gemini session", { targetLanguageCode });
                        return;
                    }

                    console.debug(`[Vox] Gemini message (${targetLanguageCode})`, message);
                    onMessage(message);
                },
                onerror: (event) => {
                    console.error("[Vox] Gemini Live session error", { targetLanguageCode, event });
                },
                onclose: (event) => {
                    const reason = event.reason ? `: ${event.reason}` : "";
                    const message = `Translation connection closed (${event.code}${reason}).`;
                    console.warn("[Vox] Gemini session closed", { targetLanguageCode, event });

                    if (generation !== conversationGeneration) {
                        console.info("[Vox] Ignoring close from a stale Gemini session", { targetLanguageCode });
                        return;
                    }

                    if (!hasOpened || isConversing() || isConnecting()) {
                        setStatus(message);
                        stopConversation();
                    } else {
                        console.warn("[Vox] Ignoring close from an intentionally stopped session", {
                            targetLanguageCode,
                        });
                    }
                },
            },
        });
    }

    function handleMyLanguageMessage(message: LiveServerMessage) {
        for (const part of message.serverContent?.modelTurn?.parts ?? []) {
            const inlineData = part.inlineData;

            if (inlineData?.mimeType?.startsWith("audio/pcm") && inlineData.data) {
                console.info("[Vox] Received outgoing translation audio", {
                    bytes: inlineData.data.length,
                    phase: phase(),
                });
                receiveOutgoingAudio(inlineData.data);
            }
        }
    }

    function handleCompanionLanguageMessage(message: LiveServerMessage) {
        const text = message.serverContent?.outputTranscription?.text;

        console.debug("[Vox] Companion tranlation transcription: ", text);

        if (text) {
            console.info("[Vox] Received companion translation text", text);
            setCompanionTranslation((translation) => translation + text);
        }
    }

    async function requestMicrophoneAccess() {
        if (!navigator.mediaDevices?.getUserMedia) {
            console.warn("[Vox] Microphone access is unavailable: getUserMedia is not supported", {
                secureContext: window.isSecureContext,
            });
            throw new Error("This browser must be served over HTTPS to access the microphone.");
        }

        console.info("[Vox] Requesting microphone permission directly from the conversation button");
        microphoneStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
            },
        });
        console.info("[Vox] Microphone permission granted", {
            tracks: microphoneStream.getAudioTracks().map((track) => ({ label: track.label, enabled: track.enabled })),
        });
    }

    async function startMicrophoneStream() {
        if (!microphoneStream) {
            console.warn("[Vox] Cannot start microphone processing: no approved microphone stream is available");
            throw new Error("Microphone access was not granted.");
        }

        inputAudioContext = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
        outputAudioContext ??= new AudioContext();
        await inputAudioContext.resume();
        await outputAudioContext.resume();

        sourceNode = inputAudioContext.createMediaStreamSource(microphoneStream);
        processorNode = inputAudioContext.createScriptProcessor(INPUT_BUFFER_SIZE, 1, 1);
        silentGainNode = inputAudioContext.createGain();
        silentGainNode.gain.value = 0;

        processorNode.onaudioprocess = (event) => {
            const p = phase();
            const microphoneAudio = floatToInt16Pcm(event.inputBuffer.getChannelData(0));
            const silenceAudio = new Uint8Array(microphoneAudio.byteLength);

            if (performance.now() - lastAudioRoutingLogTime > 1_000) {
                lastAudioRoutingLogTime = performance.now();
                console.debug("[Vox] Routing microphone audio", {
                    phase: p,
                    microphoneBytes: microphoneAudio.byteLength,
                    myLanguageSession: Boolean(myLanguageSession),
                    companionLanguageSession: Boolean(companionLanguageSession),
                });
            }

            if (p === "speaking") {
                sendRealtimeAudio(myLanguageSession, microphoneAudio, "my to companion language");
                sendRealtimeAudio(companionLanguageSession, silenceAudio, "companion to my language");
            } else if (p === "listening") {
                sendRealtimeAudio(myLanguageSession, silenceAudio, "my to companion language");
                sendRealtimeAudio(companionLanguageSession, microphoneAudio, "companion to my language");
            } else {
                sendRealtimeAudio(myLanguageSession, silenceAudio, "my to companion language");
                sendRealtimeAudio(companionLanguageSession, silenceAudio, "companion to my language");
            }
        };

        sourceNode.connect(processorNode);
        processorNode.connect(silentGainNode);
        console.info("[Vox] Microphone stream started", {
            sampleRate: inputAudioContext.sampleRate,
            tracks: microphoneStream.getAudioTracks().map((track) => track.label),
        });
        silentGainNode.connect(inputAudioContext.destination);
    }

    async function startConversation() {
        const generation = ++conversationGeneration;
        console.info("[Vox] Starting conversation", {
            myLanguage: myLanguageCode(),
            companionLanguage: companionLanguageCode(),
        });
        setIsConnecting(true);
        setStatus("Requesting short-lived Gemini tokens…");

        try {
            // This must happen before any network awaits so browsers retain the click's user activation.
            setStatus("Requesting microphone access…");
            await requestMicrophoneAccess();

            const [myToken, companionToken] = await Promise.all([getEphemeralToken(), getEphemeralToken()]);
            setStatus("Opening two live translation sessions…");
            const [mySession, companionSession] = await Promise.all([
                connectLiveTranslate(
                    myToken,
                    companionLanguageCode(),
                    [Modality.AUDIO],
                    handleMyLanguageMessage,
                    generation,
                ),
                connectLiveTranslate(
                    companionToken,
                    myLanguageCode(),
                    [Modality.TEXT],
                    handleCompanionLanguageMessage,
                    generation,
                ),
            ]);

            if (generation !== conversationGeneration) {
                mySession.close();
                companionSession.close();
                return;
            }

            myLanguageSession = mySession;
            companionLanguageSession = companionSession;
            setStatus("Starting microphone stream…");
            await startMicrophoneStream();

            if (generation !== conversationGeneration) {
                stopConversation();
                return;
            }

            setIsConversing(true);
            setPhase("listening");
            setStatus("Listening to your companion.");
        } catch (error) {
            console.error("[Vox] Could not start conversation", error);
            if (error instanceof DOMException) {
                console.warn("[Vox] Microphone request failed", { name: error.name, message: error.message });
            }
            setStatus(error instanceof Error ? error.message : "Could not start the conversation.");
            stopConversation();
        } finally {
            setIsConnecting(false);
        }
    }

    function beginSpeaking() {
        if (phase() !== "listening") {
            console.warn("[Vox] Ignored start-speaking action because the conversation is not listening", {
                phase: phase(),
            });
            return;
        }

        console.info("[Vox] Started speaking");
        queuedOutgoingAudio = [];
        consecutiveSilentOutgoingAudioDurationMs = 0;
        lastNonSilentOutgoingAudioTime = 0;
        cancelTerminalSilenceTransition();
        setCompanionTranslation("");
        setPhase("speaking");
        setStatus("You are speaking. Release to hear the translation.");
    }

    function finishSpeaking() {
        if (phase() !== "speaking") {
            console.warn("[Vox] Ignored finish-speaking action because no speech turn is active", { phase: phase() });
            return;
        }

        console.info("[Vox] Finished speaking", {
            queuedAudioChunks: queuedOutgoingAudio.length,
        });
        setPhase("playing");
        setStatus("Playing your translation…");
        flushQueuedOutgoingAudio();
        advancePlaybackQueue();
    }

    function stopConversation() {
        console.info("[Vox] Stopping conversation");
        conversationGeneration += 1;
        playbackGeneration += 1;
        const wasConversing = isConversing();
        setIsConversing(false);
        setPhase("listening");

        for (const source of activePlaybackSources) {
            source.onended = null;
            source.stop();
            source.disconnect();
        }
        activePlaybackSources.clear();

        processorNode?.disconnect();
        sourceNode?.disconnect();
        silentGainNode?.disconnect();
        microphoneStream?.getTracks().forEach((track) => {
            track.stop();
        });

        if (inputAudioContext?.state !== "closed") {
            void inputAudioContext?.close();
        }

        myLanguageSession?.close();
        companionLanguageSession?.close();
        myLanguageSession = undefined;
        companionLanguageSession = undefined;
        microphoneStream = undefined;
        inputAudioContext = undefined;
        sourceNode = undefined;
        processorNode = undefined;
        silentGainNode = undefined;
        queuedOutgoingAudio = [];
        consecutiveSilentOutgoingAudioDurationMs = 0;
        lastNonSilentOutgoingAudioTime = 0;
        cancelTerminalSilenceTransition();
        nextPlaybackTime = outputAudioContext?.currentTime ?? 0;

        if (wasConversing) {
            setStatus("Conversation stopped.");
        } else {
            console.warn("[Vox] Stop requested when no conversation was active");
        }
    }

    const releaseSpeakingFromWindow = () => finishSpeaking();
    window.addEventListener("pointerup", releaseSpeakingFromWindow);
    window.addEventListener("pointercancel", releaseSpeakingFromWindow);
    onCleanup(() => {
        window.removeEventListener("pointerup", releaseSpeakingFromWindow);
        window.removeEventListener("pointercancel", releaseSpeakingFromWindow);
        stopConversation();
    });

    const languageOptions = [
        ["en", "English"],
        ["ru", "Russian"],
        ["de", "German"],
        ["uk", "Ukrainian"],
        ["sr", "Serbian"],
    ] as const;

    return (
        <main class="app-shell">
            <Navigation />
            <section class="translator" aria-labelledby="app-title">
                <p class="eyebrow">Two-way live speech translation</p>
                <h1 id="app-title">Vox</h1>
                <p class="lede">
                    Choose both languages to translate your companion’s speech as text and your speech as audio.
                </p>

                <div class="language-fields">
                    <label class="field" for="my-language-select">
                        <span>My Language</span>
                        <select
                            id="my-language-select"
                            value={myLanguageCode()}
                            disabled={isConversing() || isConnecting()}
                            onInput={(event) => setMyLanguageCode(event.currentTarget.value)}
                        >
                            {languageOptions.map(([code, label]) => (
                                <option value={code}>{label}</option>
                            ))}
                        </select>
                    </label>

                    <label class="field" for="companion-language-select">
                        <span>Companion Language</span>
                        <select
                            id="companion-language-select"
                            value={companionLanguageCode()}
                            disabled={isConversing() || isConnecting()}
                            onInput={(event) => setCompanionLanguageCode(event.currentTarget.value)}
                        >
                            {languageOptions.map(([code, label]) => (
                                <option value={code}>{label}</option>
                            ))}
                        </select>
                    </label>
                </div>

                <button
                    class="primary-button"
                    type="button"
                    disabled={isConnecting()}
                    onClick={() => (isConversing() ? stopConversation() : void startConversation())}
                >
                    {isConnecting() ? "Connecting…" : isConversing() ? "Stop conversation" : "Start conversation"}
                </button>

                {isConversing() && (
                    <section class="conversation" aria-label="Conversation controls">
                        <button
                            class="speaking-button"
                            type="button"
                            disabled={phase() !== "listening"}
                            onPointerDown={(event) => {
                                event.currentTarget.setPointerCapture(event.pointerId);
                                beginSpeaking();
                            }}
                            onPointerUp={(event) => {
                                finishSpeaking();
                                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                                    event.currentTarget.releasePointerCapture(event.pointerId);
                                } else {
                                    console.warn("[Vox] Pointer was released without pointer capture", {
                                        pointerId: event.pointerId,
                                    });
                                }
                            }}
                            onPointerCancel={finishSpeaking}
                            onLostPointerCapture={finishSpeaking}
                        >
                            {phase() === "speaking" ? "Release to translate" : "I am speaking"}
                        </button>
                        <p class="speaking-hint">
                            Hold while you speak. Your translated audio plays after you release.
                        </p>
                        <p class="translation" aria-live="polite">
                            {companionTranslation() || "Your companion’s translation will appear here."}
                        </p>
                    </section>
                )}

                <p class="status" role="status" aria-live="polite">
                    {status()}
                </p>
            </section>
        </main>
    );
}
