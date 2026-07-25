import { type LiveServerMessage, Modality, type Session } from "@google/genai";
import { createSignal, onCleanup, onMount } from "solid-js";
import { match } from "ts-pattern";
import { createMicrophoneCaptureNodes } from "../audio/microphone";
import { bytesToBase64, INPUT_SAMPLE_RATE } from "../audio/pcm";
import { createConversationHistory } from "./conversationHistory";
import { connectLiveTranslate, getEphemeralToken } from "./liveTranslate";
import { autoLanguageCode, type ConversationMode, type ConversationPhase, languageLabel } from "./types";
import { usePcmPlayback } from "./usePcmPlayback";

export function useConversation() {
    const [status, setStatus] = createSignal("Ready to start a conversation.");
    const [myLanguageCode, setMyLanguageCode] = createSignal("ru");
    const [companionLanguageCode, setCompanionLanguageCode] = createSignal("en");
    const [conversationMode, setConversationMode] = createSignal<ConversationMode>("companion-text");
    const [isConversing, setIsConversing] = createSignal(false);
    const [isConnecting, setIsConnecting] = createSignal(false);
    const [phase, setPhase] = createSignal<ConversationPhase>("listening");
    const [companionTranslation, setCompanionTranslation] = createSignal("");
    const [detectedCompanionLanguage, setDetectedCompanionLanguage] = createSignal<string>();
    const [isCompanionLanguageReady, setIsCompanionLanguageReady] = createSignal(true);
    const playback = usePcmPlayback({ phase, setPhase, setStatus });

    let myLanguageSession: Session | undefined;
    let companionLanguageSession: Session | undefined;
    let microphoneStream: MediaStream | undefined;
    let inputAudioContext: AudioContext | undefined;
    let sourceNode: MediaStreamAudioSourceNode | undefined;
    let processorNode: AudioWorkletNode | undefined;
    let silentGainNode: GainNode | undefined;
    let conversationGeneration = 0;
    let history: ReturnType<typeof createConversationHistory> | undefined;
    let lastAudioRoutingLogTime = 0;
    let reconnectionTimer: number | undefined;

    function sendRealtimeAudio(session: Session | undefined, data: Uint8Array) {
        if (!session) return;
        session.sendRealtimeInput({ audio: { mimeType: "audio/pcm;rate=16000", data: bytesToBase64(data) } });
    }

    function recordTranscriptions(message: LiveServerMessage, side: "me" | "companion") {
        const { inputTranscription, outputTranscription } = message.serverContent ?? {};
        if (inputTranscription?.text) history?.addInput(side, inputTranscription.text);
        if (outputTranscription?.text) history?.addOutput(side, outputTranscription.text);
    }

    function handleMyLanguageMessage(message: LiveServerMessage) {
        recordTranscriptions(message, "me");
        const text = message.serverContent?.outputTranscription?.text;
        if (conversationMode() === "companion-audio") {
            if (text) setCompanionTranslation((translation) => translation + text);
            return;
        }

        for (const part of message.serverContent?.modelTurn?.parts ?? []) {
            const inlineData = part.inlineData;
            if (inlineData?.mimeType?.startsWith("audio/pcm") && inlineData.data) playback.receive(inlineData.data);
        }
    }

    function handleCompanionLanguageMessage(message: LiveServerMessage) {
        recordTranscriptions(message, "companion");
        if (conversationMode() === "companion-text") {
            const text = message.serverContent?.outputTranscription?.text;
            if (text) setCompanionTranslation((translation) => translation + text);
            return;
        }

        for (const part of message.serverContent?.modelTurn?.parts ?? []) {
            const inlineData = part.inlineData;
            if (inlineData?.mimeType?.startsWith("audio/pcm") && inlineData.data)
                playback.receiveIncoming(inlineData.data);
        }
    }

    async function requestMicrophoneAccess() {
        if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error("This browser must be served over HTTPS to access the microphone.");
        }
        microphoneStream = await navigator.mediaDevices.getUserMedia({
            audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
    }

    async function startMicrophoneStream() {
        if (!microphoneStream) throw new Error("Microphone access was not granted.");
        inputAudioContext = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
        await inputAudioContext.resume();
        await playback.resumeOutput();
        const capture = await createMicrophoneCaptureNodes(inputAudioContext, microphoneStream, (microphoneAudio) => {
            const currentPhase = phase();
            const silenceAudio = new Uint8Array(microphoneAudio.byteLength);
            if (performance.now() - lastAudioRoutingLogTime > 1_000) {
                lastAudioRoutingLogTime = performance.now();
                console.debug("[Vox] Routing microphone audio", {
                    phase: currentPhase,
                    microphoneBytes: microphoneAudio.byteLength,
                });
            }
            const [myLanguageAudio, companionLanguageAudio] = match(currentPhase)
                .with("listening", () => [silenceAudio, microphoneAudio] as const)
                .with("speaking", () => [microphoneAudio, silenceAudio] as const)
                .with("playing", "ending-play", () => [silenceAudio, silenceAudio] as const)
                .exhaustive();
            sendRealtimeAudio(myLanguageSession, myLanguageAudio);
            sendRealtimeAudio(companionLanguageSession, companionLanguageAudio);
        });
        sourceNode = capture.source;
        processorNode = capture.processor;
        silentGainNode = capture.silentGain;
    }

    async function startConversation() {
        const myLanguage = myLanguageCode();
        const selectedCompanionLanguage = companionLanguageCode();
        const selectedConversationMode = conversationMode();
        const detectCompanionLanguage = selectedCompanionLanguage === autoLanguageCode;
        let generation = ++conversationGeneration;
        history = createConversationHistory(myLanguage, selectedCompanionLanguage);
        setCompanionTranslation("");
        setDetectedCompanionLanguage(undefined);
        setIsCompanionLanguageReady(!detectCompanionLanguage);
        setIsConnecting(true);

        const getToken = async (targetLanguageCode: string) =>
            (await getEphemeralToken(targetLanguageCode)).match(
                (token) => token,
                (error) => {
                    throw error;
                },
            );
        const isCurrent = (sessionGeneration: number) => () => sessionGeneration === conversationGeneration;
        const onUnexpectedClose = (sessionGeneration: number) => (message: string) => {
            if (sessionGeneration === conversationGeneration && (isConversing() || isConnecting())) {
                setStatus(message);
                stopConversation();
            }
        };
        const openSessions = async (sessionGeneration: number) => {
            const current = isCurrent(sessionGeneration);
            const unexpectedClose = onUnexpectedClose(sessionGeneration);
            const openDetectedLanguageSession = async (languageCode: string) => {
                try {
                    setStatus(`Detected ${languageLabel(languageCode)}. Opening your translation stream…`);
                    const token = await getToken(languageCode);
                    const session = await connectLiveTranslate({
                        token,
                        targetLanguageCode: languageCode,
                        responseModalities: [
                            selectedConversationMode === "companion-audio" ? Modality.TEXT : Modality.AUDIO,
                        ],
                        onMessage: handleMyLanguageMessage,
                        isCurrent: current,
                        onUnexpectedClose: unexpectedClose,
                    });
                    if (!current()) {
                        session.close();
                        return;
                    }
                    myLanguageSession = session;
                    setIsCompanionLanguageReady(true);
                    setStatus("Listening to your companion.");
                } catch (error) {
                    console.error("[Vox] Could not start the detected language stream", error);
                    unexpectedClose(
                        error instanceof Error ? error.message : "Could not start the detected language stream.",
                    );
                }
            };

            if (detectCompanionLanguage) {
                const token = await getToken(myLanguage);
                if (!current()) return;
                companionLanguageSession = await connectLiveTranslate({
                    token,
                    targetLanguageCode: myLanguage,
                    responseModalities: [
                        selectedConversationMode === "companion-audio" ? Modality.AUDIO : Modality.TEXT,
                    ],
                    onMessage: (message) => {
                        handleCompanionLanguageMessage(message);
                        const languageCode = message.serverContent?.inputTranscription?.languageCode;
                        if (languageCode && !detectedCompanionLanguage()) {
                            setDetectedCompanionLanguage(languageCode);
                            void openDetectedLanguageSession(languageCode);
                        }
                    },
                    isCurrent: current,
                    onUnexpectedClose: unexpectedClose,
                });
                const detectedLanguage = detectedCompanionLanguage();
                if (detectedLanguage) await openDetectedLanguageSession(detectedLanguage);
                return;
            }

            const [myToken, companionToken] = await Promise.all([
                getToken(selectedCompanionLanguage),
                getToken(myLanguage),
            ]);
            if (!current()) return;
            const [mySession, companionSession] = await Promise.all([
                connectLiveTranslate({
                    token: myToken,
                    targetLanguageCode: selectedCompanionLanguage,
                    responseModalities: [
                        selectedConversationMode === "companion-audio" ? Modality.TEXT : Modality.AUDIO,
                    ],
                    onMessage: handleMyLanguageMessage,
                    isCurrent: current,
                    onUnexpectedClose: unexpectedClose,
                }),
                connectLiveTranslate({
                    token: companionToken,
                    targetLanguageCode: myLanguage,
                    responseModalities: [
                        selectedConversationMode === "companion-audio" ? Modality.AUDIO : Modality.TEXT,
                    ],
                    onMessage: handleCompanionLanguageMessage,
                    isCurrent: current,
                    onUnexpectedClose: unexpectedClose,
                }),
            ]);
            if (!current()) {
                mySession.close();
                companionSession.close();
                return;
            }
            myLanguageSession = mySession;
            companionLanguageSession = companionSession;
        };
        const scheduleReconnection = () => {
            if (reconnectionTimer !== undefined) window.clearTimeout(reconnectionTimer);
            reconnectionTimer = window.setTimeout(() => void reconnect(), 110_000);
        };
        const reconnect = async () => {
            if (!isConversing()) return;

            generation = ++conversationGeneration;
            myLanguageSession?.close();
            companionLanguageSession?.close();
            myLanguageSession = undefined;
            companionLanguageSession = undefined;
            setIsCompanionLanguageReady(false);
            setPhase("listening");
            setStatus("Refreshing translation connection…");
            try {
                await openSessions(generation);
                if (!isCurrent(generation)()) return;
                setIsCompanionLanguageReady(Boolean(myLanguageSession));
                setStatus(
                    myLanguageSession ? "Listening to your companion." : "Listening for your companion’s language…",
                );
                scheduleReconnection();
            } catch (error) {
                console.error("[Vox] Could not refresh translation connection", error);
                setStatus(error instanceof Error ? error.message : "Could not refresh the translation connection.");
                stopConversation();
            }
        };

        try {
            setStatus("Requesting microphone access…");
            await requestMicrophoneAccess();
            setStatus("Requesting short-lived Gemini tokens…");
            await openSessions(generation);
            if (!isCurrent(generation)()) return;
            setStatus("Starting microphone stream…");
            await startMicrophoneStream();
            if (!isCurrent(generation)()) {
                stopConversation();
                return;
            }
            setIsConversing(true);
            setPhase("listening");
            setStatus(
                detectCompanionLanguage ? "Listening for your companion’s language…" : "Listening to your companion.",
            );
            scheduleReconnection();
        } catch (error) {
            console.error("[Vox] Could not start conversation", error);
            setStatus(error instanceof Error ? error.message : "Could not start the conversation.");
            stopConversation();
        } finally {
            setIsConnecting(false);
        }
    }

    function beginSpeaking() {
        if (phase() !== "listening") return;
        playback.beginSpeaking();
        setCompanionTranslation("");
        setPhase("speaking");
        setStatus("You are speaking. Release to hear the translation.");
    }

    function finishSpeaking() {
        if (phase() !== "speaking") return;
        if (conversationMode() === "companion-audio") {
            setPhase("listening");
            setStatus("Listening to your companion.");
            return;
        }

        setPhase("playing");
        setStatus("Playing your translation…");
        playback.finishSpeaking();
    }

    function stopConversation() {
        conversationGeneration += 1;
        if (reconnectionTimer !== undefined) {
            window.clearTimeout(reconnectionTimer);
            reconnectionTimer = undefined;
        }
        const wasConversing = isConversing();
        setIsConversing(false);
        setPhase("listening");
        playback.stop();
        if (processorNode) {
            processorNode.port.onmessage = null;
            processorNode.disconnect();
        }
        sourceNode?.disconnect();
        silentGainNode?.disconnect();
        microphoneStream?.getTracks().forEach((track) => {
            track.stop();
        });
        if (inputAudioContext?.state !== "closed") void inputAudioContext?.close();
        myLanguageSession?.close();
        companionLanguageSession?.close();
        myLanguageSession = undefined;
        companionLanguageSession = undefined;
        microphoneStream = undefined;
        inputAudioContext = undefined;
        sourceNode = undefined;
        processorNode = undefined;
        silentGainNode = undefined;
        if (wasConversing) setStatus("Conversation stopped.");
    }

    const releaseSpeakingFromWindow = () => finishSpeaking();
    onMount(() => {
        window.addEventListener("pointerup", releaseSpeakingFromWindow);
        window.addEventListener("pointercancel", releaseSpeakingFromWindow);
        onCleanup(() => {
            window.removeEventListener("pointerup", releaseSpeakingFromWindow);
            window.removeEventListener("pointercancel", releaseSpeakingFromWindow);
        });
    });
    onCleanup(stopConversation);

    return {
        status,
        myLanguageCode,
        setMyLanguageCode,
        companionLanguageCode,
        setCompanionLanguageCode,
        conversationMode,
        setConversationMode,
        isConversing,
        isConnecting,
        phase,
        companionTranslation,
        detectedCompanionLanguage,
        isCompanionLanguageReady,
        startConversation,
        stopConversation,
        beginSpeaking,
        finishSpeaking,
    };
}
