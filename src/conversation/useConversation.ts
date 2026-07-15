import { type LiveServerMessage, Modality, type Session } from "@google/genai";
import { createSignal, onCleanup } from "solid-js";
import { createMicrophoneCaptureNodes } from "../audio/microphone";
import { bytesToBase64, INPUT_SAMPLE_RATE } from "../audio/pcm";
import { createConversationHistory } from "./conversationHistory";
import { connectLiveTranslate, getEphemeralToken } from "./liveTranslate";
import type { ConversationPhase } from "./types";
import { usePcmPlayback } from "./usePcmPlayback";

export function useConversation() {
    const [status, setStatus] = createSignal("Ready to start a conversation.");
    const [myLanguageCode, setMyLanguageCode] = createSignal("ru");
    const [companionLanguageCode, setCompanionLanguageCode] = createSignal("en");
    const [isConversing, setIsConversing] = createSignal(false);
    const [isConnecting, setIsConnecting] = createSignal(false);
    const [phase, setPhase] = createSignal<ConversationPhase>("listening");
    const [companionTranslation, setCompanionTranslation] = createSignal("");
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

    function sendRealtimeAudio(session: Session | undefined, data: Uint8Array, direction: string) {
        if (!session) {
            console.warn("[Vox] Audio frame was not sent: session is unavailable", { direction, phase: phase() });
            return;
        }
        session.sendRealtimeInput({ audio: { mimeType: "audio/pcm;rate=16000", data: bytesToBase64(data) } });
    }

    function recordTranscriptions(message: LiveServerMessage, side: "me" | "companion") {
        const { inputTranscription, outputTranscription } = message.serverContent ?? {};
        if (inputTranscription?.text) history?.addInput(side, inputTranscription.text);
        if (outputTranscription?.text) history?.addOutput(side, outputTranscription.text);
    }

    function handleMyLanguageMessage(message: LiveServerMessage) {
        recordTranscriptions(message, "me");
        for (const part of message.serverContent?.modelTurn?.parts ?? []) {
            const inlineData = part.inlineData;
            if (inlineData?.mimeType?.startsWith("audio/pcm") && inlineData.data) playback.receive(inlineData.data);
        }
    }

    function handleCompanionLanguageMessage(message: LiveServerMessage) {
        recordTranscriptions(message, "companion");
        const text = message.serverContent?.outputTranscription?.text;
        if (text) setCompanionTranslation((translation) => translation + text);
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
            sendRealtimeAudio(
                myLanguageSession,
                currentPhase === "speaking" ? microphoneAudio : silenceAudio,
                "my to companion language",
            );
            sendRealtimeAudio(
                companionLanguageSession,
                currentPhase === "listening" ? microphoneAudio : silenceAudio,
                "companion to my language",
            );
        });
        sourceNode = capture.source;
        processorNode = capture.processor;
        silentGainNode = capture.silentGain;
    }

    async function startConversation() {
        const generation = ++conversationGeneration;
        history = createConversationHistory(myLanguageCode(), companionLanguageCode());
        setIsConnecting(true);
        try {
            setStatus("Requesting microphone access…");
            await requestMicrophoneAccess();
            setStatus("Requesting short-lived Gemini tokens…");
            const [myToken, companionToken] = await Promise.all([getEphemeralToken(), getEphemeralToken()]);
            setStatus("Opening two live translation sessions…");
            const isCurrent = () => generation === conversationGeneration;
            const onUnexpectedClose = (message: string) => {
                if (isConversing() || isConnecting()) {
                    setStatus(message);
                    stopConversation();
                }
            };
            const [mySession, companionSession] = await Promise.all([
                connectLiveTranslate({
                    token: myToken,
                    targetLanguageCode: companionLanguageCode(),
                    responseModalities: [Modality.AUDIO],
                    onMessage: handleMyLanguageMessage,
                    isCurrent,
                    onUnexpectedClose,
                }),
                connectLiveTranslate({
                    token: companionToken,
                    targetLanguageCode: myLanguageCode(),
                    responseModalities: [Modality.TEXT],
                    onMessage: handleCompanionLanguageMessage,
                    isCurrent,
                    onUnexpectedClose,
                }),
            ]);
            if (!isCurrent()) {
                mySession.close();
                companionSession.close();
                return;
            }
            myLanguageSession = mySession;
            companionLanguageSession = companionSession;
            setStatus("Starting microphone stream…");
            await startMicrophoneStream();
            if (!isCurrent()) {
                stopConversation();
                return;
            }
            setIsConversing(true);
            setPhase("listening");
            setStatus("Listening to your companion.");
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
        setPhase("playing");
        setStatus("Playing your translation…");
        playback.finishSpeaking();
    }

    function stopConversation() {
        conversationGeneration += 1;
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
    window.addEventListener("pointerup", releaseSpeakingFromWindow);
    window.addEventListener("pointercancel", releaseSpeakingFromWindow);
    onCleanup(() => {
        window.removeEventListener("pointerup", releaseSpeakingFromWindow);
        window.removeEventListener("pointercancel", releaseSpeakingFromWindow);
        stopConversation();
    });

    return {
        status,
        myLanguageCode,
        setMyLanguageCode,
        companionLanguageCode,
        setCompanionLanguageCode,
        isConversing,
        isConnecting,
        phase,
        companionTranslation,
        startConversation,
        stopConversation,
        beginSpeaking,
        finishSpeaking,
    };
}
