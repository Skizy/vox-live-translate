import { type LiveServerMessage, Modality, type Session } from "@google/genai";
import { useCallback, useEffect, useRef, useState } from "react";
import { match } from "ts-pattern";
import { createMicrophoneCaptureNodes } from "../audio/microphone";
import { bytesToBase64, INPUT_SAMPLE_RATE } from "../audio/pcm";
import { createConversationHistory } from "./conversationHistory";
import { connectLiveTranslate, getEphemeralToken } from "./liveTranslate";
import { autoLanguageCode, type ConversationMode, type ConversationPhase, languageLabel } from "./types";
import { usePcmPlayback } from "./usePcmPlayback";

export function useConversation() {
    const [status, setStatusState] = useState("Ready to start a conversation.");
    const [myLanguageCode, setMyLanguageCodeState] = useState("ru");
    const [companionLanguageCode, setCompanionLanguageCodeState] = useState("en");
    const [conversationMode, setConversationModeState] = useState<ConversationMode>("companion-text");
    const [isConversing, setIsConversingState] = useState(false);
    const [isConnecting, setIsConnectingState] = useState(false);
    const [phase, setPhaseState] = useState<ConversationPhase>("listening");
    const [companionTranslation, setCompanionTranslation] = useState("");
    const [detectedCompanionLanguage, setDetectedCompanionLanguage] = useState<string>();
    const [isCompanionLanguageReady, setIsCompanionLanguageReady] = useState(true);
    const [lastConversationTimestamp, setLastConversationTimestamp] = useState<number>();

    const myLanguageCodeRef = useRef(myLanguageCode);
    const companionLanguageCodeRef = useRef(companionLanguageCode);
    const conversationModeRef = useRef(conversationMode);
    const isConversingRef = useRef(isConversing);
    const isConnectingRef = useRef(isConnecting);
    const phaseRef = useRef(phase);
    const detectedCompanionLanguageRef = useRef(detectedCompanionLanguage);
    const myLanguageSessionRef = useRef<Session | undefined>(undefined);
    const companionLanguageSessionRef = useRef<Session | undefined>(undefined);
    const microphoneStreamRef = useRef<MediaStream | undefined>(undefined);
    const inputAudioContextRef = useRef<AudioContext | undefined>(undefined);
    const sourceNodeRef = useRef<MediaStreamAudioSourceNode | undefined>(undefined);
    const processorNodeRef = useRef<AudioWorkletNode | undefined>(undefined);
    const silentGainNodeRef = useRef<GainNode | undefined>(undefined);
    const conversationGenerationRef = useRef(0);
    const historyRef = useRef<ReturnType<typeof createConversationHistory> | undefined>(undefined);
    const lastAudioRoutingLogTimeRef = useRef(0);
    const reconnectionTimerRef = useRef<number | undefined>(undefined);

    const setStatus = useCallback((value: string) => setStatusState(value), []);
    const setMyLanguageCode = useCallback((value: string) => {
        myLanguageCodeRef.current = value;
        setMyLanguageCodeState(value);
    }, []);
    const setCompanionLanguageCode = useCallback((value: string) => {
        companionLanguageCodeRef.current = value;
        setCompanionLanguageCodeState(value);
    }, []);
    const setConversationMode = useCallback((value: ConversationMode) => {
        conversationModeRef.current = value;
        setConversationModeState(value);
    }, []);
    const setIsConversing = useCallback((value: boolean) => {
        isConversingRef.current = value;
        setIsConversingState(value);
    }, []);
    const setIsConnecting = useCallback((value: boolean) => {
        isConnectingRef.current = value;
        setIsConnectingState(value);
    }, []);
    const setPhase = useCallback((value: ConversationPhase) => {
        phaseRef.current = value;
        setPhaseState(value);
    }, []);
    const setDetectedLanguage = useCallback((value: string | undefined) => {
        detectedCompanionLanguageRef.current = value;
        setDetectedCompanionLanguage(value);
    }, []);

    const playback = usePcmPlayback({ phase, setPhase, setStatus });

    const sendRealtimeAudio = useCallback((session: Session | undefined, data: Uint8Array) => {
        if (!session) return;
        session.sendRealtimeInput({ audio: { mimeType: "audio/pcm;rate=16000", data: bytesToBase64(data) } });
    }, []);

    const recordTranscriptions = useCallback((message: LiveServerMessage, side: "me" | "companion") => {
        const { inputTranscription, outputTranscription } = message.serverContent ?? {};
        if (inputTranscription?.text) historyRef.current?.addInput(side, inputTranscription.text);
        if (outputTranscription?.text) historyRef.current?.addOutput(side, outputTranscription.text);
    }, []);

    const handleMyLanguageMessage = useCallback(
        (message: LiveServerMessage) => {
            recordTranscriptions(message, "me");
            const text = message.serverContent?.outputTranscription?.text;
            if (conversationModeRef.current === "companion-audio") {
                if (text) setCompanionTranslation((translation) => translation + text);
                return;
            }

            for (const part of message.serverContent?.modelTurn?.parts ?? []) {
                const inlineData = part.inlineData;
                if (inlineData?.mimeType?.startsWith("audio/pcm") && inlineData.data) playback.receive(inlineData.data);
            }
        },
        [playback, recordTranscriptions],
    );

    const handleCompanionLanguageMessage = useCallback(
        (message: LiveServerMessage) => {
            recordTranscriptions(message, "companion");
            if (conversationModeRef.current === "companion-text") {
                const text = message.serverContent?.outputTranscription?.text;
                if (text) setCompanionTranslation((translation) => translation + text);
                return;
            }

            for (const part of message.serverContent?.modelTurn?.parts ?? []) {
                const inlineData = part.inlineData;
                if (inlineData?.mimeType?.startsWith("audio/pcm") && inlineData.data)
                    playback.receiveIncoming(inlineData.data);
            }
        },
        [playback, recordTranscriptions],
    );

    const requestMicrophoneAccess = useCallback(async () => {
        if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error("This browser must be served over HTTPS to access the microphone.");
        }
        microphoneStreamRef.current = await navigator.mediaDevices.getUserMedia({
            audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
    }, []);

    const startMicrophoneStream = useCallback(async () => {
        const microphoneStream = microphoneStreamRef.current;
        if (!microphoneStream) throw new Error("Microphone access was not granted.");
        const inputAudioContext = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
        inputAudioContextRef.current = inputAudioContext;
        await inputAudioContext.resume();
        await playback.resumeOutput();
        const capture = await createMicrophoneCaptureNodes(inputAudioContext, microphoneStream, (microphoneAudio) => {
            const currentPhase = phaseRef.current;
            const silenceAudio = new Uint8Array(microphoneAudio.byteLength);
            if (performance.now() - lastAudioRoutingLogTimeRef.current > 1_000) {
                lastAudioRoutingLogTimeRef.current = performance.now();
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
            sendRealtimeAudio(myLanguageSessionRef.current, myLanguageAudio);
            sendRealtimeAudio(companionLanguageSessionRef.current, companionLanguageAudio);
        });
        sourceNodeRef.current = capture.source;
        processorNodeRef.current = capture.processor;
        silentGainNodeRef.current = capture.silentGain;
    }, [playback, sendRealtimeAudio]);

    const stopConversation = useCallback(() => {
        conversationGenerationRef.current += 1;
        if (reconnectionTimerRef.current !== undefined) {
            window.clearTimeout(reconnectionTimerRef.current);
            reconnectionTimerRef.current = undefined;
        }
        const wasConversing = isConversingRef.current;
        setIsConversing(false);
        setPhase("listening");
        playback.stop();
        if (processorNodeRef.current) {
            processorNodeRef.current.port.onmessage = null;
            processorNodeRef.current.disconnect();
        }
        sourceNodeRef.current?.disconnect();
        silentGainNodeRef.current?.disconnect();
        microphoneStreamRef.current?.getTracks().forEach((track) => {
            track.stop();
        });
        if (inputAudioContextRef.current?.state !== "closed") void inputAudioContextRef.current?.close();
        myLanguageSessionRef.current?.close();
        companionLanguageSessionRef.current?.close();
        myLanguageSessionRef.current = undefined;
        companionLanguageSessionRef.current = undefined;
        microphoneStreamRef.current = undefined;
        inputAudioContextRef.current = undefined;
        sourceNodeRef.current = undefined;
        processorNodeRef.current = undefined;
        silentGainNodeRef.current = undefined;
        if (wasConversing) {
            setLastConversationTimestamp(historyRef.current?.timestamp);
            setStatus("Conversation stopped.");
        }
    }, [playback, setIsConversing, setPhase, setStatus]);

    const startConversation = useCallback(async () => {
        const myLanguage = myLanguageCodeRef.current;
        const selectedCompanionLanguage = companionLanguageCodeRef.current;
        const selectedConversationMode = conversationModeRef.current;
        const detectCompanionLanguage = selectedCompanionLanguage === autoLanguageCode;
        let generation = ++conversationGenerationRef.current;
        historyRef.current = createConversationHistory(myLanguage, selectedCompanionLanguage);
        setLastConversationTimestamp(undefined);
        setCompanionTranslation("");
        setDetectedLanguage(undefined);
        setIsCompanionLanguageReady(!detectCompanionLanguage);
        setIsConnecting(true);

        const getToken = async (targetLanguageCode: string) =>
            (await getEphemeralToken(targetLanguageCode)).match(
                (token) => token,
                (error) => {
                    throw error;
                },
            );
        const isCurrent = (sessionGeneration: number) => () => sessionGeneration === conversationGenerationRef.current;
        const onUnexpectedClose = (sessionGeneration: number) => (message: string) => {
            if (
                sessionGeneration === conversationGenerationRef.current &&
                (isConversingRef.current || isConnectingRef.current)
            ) {
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
                    myLanguageSessionRef.current = session;
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
                companionLanguageSessionRef.current = await connectLiveTranslate({
                    token,
                    targetLanguageCode: myLanguage,
                    responseModalities: [
                        selectedConversationMode === "companion-audio" ? Modality.AUDIO : Modality.TEXT,
                    ],
                    onMessage: (message) => {
                        handleCompanionLanguageMessage(message);
                        const languageCode = message.serverContent?.inputTranscription?.languageCode;
                        if (languageCode && !detectedCompanionLanguageRef.current) {
                            setDetectedLanguage(languageCode);
                            void openDetectedLanguageSession(languageCode);
                        }
                    },
                    isCurrent: current,
                    onUnexpectedClose: unexpectedClose,
                });
                const detectedLanguage = detectedCompanionLanguageRef.current;
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
            myLanguageSessionRef.current = mySession;
            companionLanguageSessionRef.current = companionSession;
        };
        const scheduleReconnection = () => {
            if (reconnectionTimerRef.current !== undefined) window.clearTimeout(reconnectionTimerRef.current);
            reconnectionTimerRef.current = window.setTimeout(() => void reconnect(), 110_000);
        };
        const reconnect = async () => {
            if (!isConversingRef.current) return;

            generation = ++conversationGenerationRef.current;
            myLanguageSessionRef.current?.close();
            companionLanguageSessionRef.current?.close();
            myLanguageSessionRef.current = undefined;
            companionLanguageSessionRef.current = undefined;
            setIsCompanionLanguageReady(false);
            setPhase("listening");
            setStatus("Refreshing translation connection…");
            try {
                await openSessions(generation);
                if (!isCurrent(generation)()) return;
                setIsCompanionLanguageReady(Boolean(myLanguageSessionRef.current));
                setStatus(
                    myLanguageSessionRef.current
                        ? "Listening to your companion."
                        : "Listening for your companion’s language…",
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
    }, [
        handleCompanionLanguageMessage,
        handleMyLanguageMessage,
        requestMicrophoneAccess,
        setDetectedLanguage,
        setIsConnecting,
        setIsConversing,
        setPhase,
        setStatus,
        startMicrophoneStream,
        stopConversation,
    ]);

    const beginSpeaking = useCallback(() => {
        if (phaseRef.current !== "listening") return;
        playback.beginSpeaking();
        setCompanionTranslation("");
        setPhase("speaking");
        setStatus("You are speaking. Release to hear the translation.");
    }, [playback, setPhase, setStatus]);

    const finishSpeaking = useCallback(() => {
        if (phaseRef.current !== "speaking") return;
        if (conversationModeRef.current === "companion-audio") {
            setPhase("listening");
            setStatus("Listening to your companion.");
            return;
        }

        setPhase("playing");
        setStatus("Playing your translation…");
        playback.finishSpeaking();
    }, [playback, setPhase, setStatus]);

    useEffect(() => {
        window.addEventListener("pointerup", finishSpeaking);
        window.addEventListener("pointercancel", finishSpeaking);
        return () => {
            window.removeEventListener("pointerup", finishSpeaking);
            window.removeEventListener("pointercancel", finishSpeaking);
        };
    }, [finishSpeaking]);

    useEffect(() => stopConversation, [stopConversation]);

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
        lastConversationTimestamp,
        startConversation,
        stopConversation,
        beginSpeaking,
        finishSpeaking,
    };
}
