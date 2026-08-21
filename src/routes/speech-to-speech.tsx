import { GoogleGenAI, Modality, type Session } from "@google/genai";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import Navigation from "~/components/Navigation";
import { Button } from "~/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { requestMicrophoneStream, sendMicrophoneAudio, startMicrophoneCapture } from "~/features/audio/microphone";
import { base64ToBytes, OUTPUT_SAMPLE_RATE } from "~/features/audio/pcm";
import { languageLabel } from "~/features/conversation/types";
import { getEphemeralToken, MODEL } from "~/lib/liveTranslation";

export const Route = createFileRoute("/speech-to-speech")({
    component: SpeechToSpeechPage,
});

const languageOptions = [
    ["en", "English"],
    ["ru", "Russian"],
    ["de", "German"],
    ["uk", "Ukrainian"],
    ["sr", "Serbian"],
] as const;

function SpeechToSpeechPage() {
    const [targetLanguageCode, setTargetLanguageCode] = useState("en");
    const [status, setStatus] = useState("Ready to translate speech to speech.");
    const [isTranslating, setIsTranslating] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const targetLanguageCodeRef = useRef(targetLanguageCode);
    const isTranslatingRef = useRef(isTranslating);
    const isConnectingRef = useRef(isConnecting);
    const sessionRef = useRef<Session | undefined>(undefined);
    const microphoneStreamRef = useRef<MediaStream | undefined>(undefined);
    const stopMicrophoneCaptureRef = useRef<(() => void) | undefined>(undefined);
    const outputAudioContextRef = useRef<AudioContext | undefined>(undefined);
    const nextPlaybackTimeRef = useRef(0);
    const generationRef = useRef(0);
    const sessionGenerationRef = useRef(0);
    const playbackGenerationRef = useRef(0);
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const activePlaybackSourcesRef = useRef(new Set<AudioBufferSourceNode>());

    targetLanguageCodeRef.current = targetLanguageCode;
    isTranslatingRef.current = isTranslating;
    isConnectingRef.current = isConnecting;

    function stopPlayback() {
        playbackGenerationRef.current += 1;
        for (const source of activePlaybackSourcesRef.current) {
            source.onended = null;
            source.stop();
            source.disconnect();
        }
        activePlaybackSourcesRef.current.clear();
        nextPlaybackTimeRef.current = 0;

        if (outputAudioContextRef.current?.state !== "closed") {
            void outputAudioContextRef.current?.close();
        }
        outputAudioContextRef.current = undefined;
    }

    function playPcm24k(base64Audio: string) {
        const context = outputAudioContextRef.current;
        const currentPlaybackGeneration = playbackGenerationRef.current;

        if (!context || base64Audio.length === 0) {
            return;
        }

        try {
            const pcmBytes = base64ToBytes(base64Audio);
            if (pcmBytes.byteLength % Int16Array.BYTES_PER_ELEMENT !== 0) {
                throw new Error("Received an incomplete PCM audio frame.");
            }

            const samples = new Int16Array(
                pcmBytes.buffer,
                pcmBytes.byteOffset,
                pcmBytes.byteLength / Int16Array.BYTES_PER_ELEMENT,
            );
            const audioBuffer = context.createBuffer(1, samples.length, OUTPUT_SAMPLE_RATE);
            const channel = audioBuffer.getChannelData(0);

            for (let index = 0; index < samples.length; index += 1) {
                channel[index] = (samples[index] ?? 0) / 0x8000;
            }

            const source = context.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(context.destination);
            source.onended = () => {
                if (currentPlaybackGeneration === playbackGenerationRef.current) {
                    activePlaybackSourcesRef.current.delete(source);
                }
            };

            const startAt = Math.max(context.currentTime, nextPlaybackTimeRef.current);
            activePlaybackSourcesRef.current.add(source);
            source.start(startAt);
            nextPlaybackTimeRef.current = startAt + audioBuffer.duration;
        } catch (error) {
            console.error("[Vox] Could not play translated speech", error);
        }
    }

    function clearReconnectTimer() {
        if (reconnectTimerRef.current !== undefined) {
            clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = undefined;
        }
    }

    function releaseResources() {
        clearReconnectTimer();
        stopMicrophoneCaptureRef.current?.();
        stopMicrophoneCaptureRef.current = undefined;
        microphoneStreamRef.current?.getTracks().forEach((track) => {
            track.stop();
        });
        microphoneStreamRef.current = undefined;
        sessionRef.current?.close();
        sessionRef.current = undefined;
        stopPlayback();
    }

    function stopTranslation(statusMessage = "Translation stopped.") {
        generationRef.current += 1;
        const wasActive = isConnectingRef.current || isTranslatingRef.current;
        setIsConnecting(false);
        setIsTranslating(false);
        releaseResources();

        if (wasActive) {
            setStatus(statusMessage);
        }
    }

    async function connectLiveSession(token: string, attempt: number, sessionAttempt: number) {
        const ai = new GoogleGenAI({ apiKey: token });
        return ai.live.connect({
            model: MODEL,
            config: {
                responseModalities: [Modality.AUDIO],
                translationConfig: {
                    targetLanguageCode: targetLanguageCodeRef.current,
                    echoTargetLanguage: false,
                },
            },
            callbacks: {
                onmessage: (message) => {
                    if (attempt !== generationRef.current || sessionAttempt !== sessionGenerationRef.current) {
                        return;
                    }

                    for (const part of message.serverContent?.modelTurn?.parts ?? []) {
                        const inlineData = part.inlineData;
                        if (inlineData?.mimeType?.startsWith("audio/pcm") && inlineData.data) {
                            playPcm24k(inlineData.data);
                        }
                    }
                },
                onclose: (event) => {
                    if (attempt !== generationRef.current || sessionAttempt !== sessionGenerationRef.current) {
                        return;
                    }

                    const reason = event.reason ? `: ${event.reason}` : "";
                    stopTranslation(`Translation connection closed (${event.code}${reason}).`);
                },
                onerror: (event) => {
                    console.error("[Vox] Speech-to-speech session error", event);
                },
            },
        });
    }

    function scheduleSessionRefresh(attempt: number) {
        clearReconnectTimer();
        reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = undefined;
            void refreshSession(attempt);
        }, 110_000);
    }

    async function refreshSession(attempt: number) {
        if (attempt !== generationRef.current || !sessionRef.current) {
            return;
        }

        const sessionAttempt = ++sessionGenerationRef.current;

        try {
            const token = await getEphemeralToken(targetLanguageCodeRef.current);
            const connectedSession = await connectLiveSession(token, attempt, sessionAttempt);

            if (attempt !== generationRef.current || sessionAttempt !== sessionGenerationRef.current) {
                connectedSession.close();
                return;
            }

            const previousSession = sessionRef.current;
            sessionRef.current = connectedSession;
            previousSession.close();
            scheduleSessionRefresh(attempt);
        } catch (error) {
            console.error("[Vox] Could not refresh speech-to-speech translation", error);
            if (attempt === generationRef.current && sessionAttempt === sessionGenerationRef.current) {
                stopTranslation(
                    error instanceof Error ? error.message : "Could not refresh speech-to-speech translation.",
                );
            }
        }
    }

    async function startTranslation() {
        const attempt = ++generationRef.current;
        setIsConnecting(true);
        setStatus("Preparing audio and requesting microphone access…");

        try {
            const outputAudioContext = new AudioContext();
            outputAudioContextRef.current = outputAudioContext;
            await outputAudioContext.resume();
            const microphoneStream = await requestMicrophoneStream();
            microphoneStreamRef.current = microphoneStream;
            const token = await getEphemeralToken(targetLanguageCodeRef.current);
            const sessionAttempt = ++sessionGenerationRef.current;
            setStatus("Opening live speech translation…");
            const connectedSession = await connectLiveSession(token, attempt, sessionAttempt);

            if (attempt !== generationRef.current || sessionAttempt !== sessionGenerationRef.current) {
                connectedSession.close();
                return;
            }

            sessionRef.current = connectedSession;
            stopMicrophoneCaptureRef.current = await startMicrophoneCapture(microphoneStream, (audio) => {
                sendMicrophoneAudio(sessionRef.current, audio);
            });

            if (attempt !== generationRef.current || sessionAttempt !== sessionGenerationRef.current) {
                stopMicrophoneCaptureRef.current();
                connectedSession.close();
                return;
            }

            setIsConnecting(false);
            setIsTranslating(true);
            setStatus("Listening and speaking the translation…");
            scheduleSessionRefresh(attempt);
        } catch (error) {
            console.error("[Vox] Could not start speech-to-speech translation", error);
            if (attempt === generationRef.current) {
                stopTranslation(
                    error instanceof Error ? error.message : "Could not start speech-to-speech translation.",
                );
            }
        }
    }

    // biome-ignore lint/correctness/useExhaustiveDependencies: cleanup intentionally reads the current resource refs on unmount.
    useEffect(() => () => stopTranslation(), []);

    return (
        <main className="min-h-screen bg-background text-foreground">
            <Navigation />
            <section
                className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-12"
                aria-labelledby="speech-to-speech-title"
            >
                <div className="space-y-2">
                    <p className="text-sm font-medium text-muted-foreground">Translation mode</p>
                    <h1 id="speech-to-speech-title" className="text-3xl font-bold tracking-tight">
                        Speech to speech
                    </h1>
                    <p className="text-muted-foreground">
                        Speak naturally and hear the live translation in your selected language.
                    </p>
                </div>

                <p className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-4 text-sm" role="note">
                    <strong>Headphones or earphones required.</strong> This mode only works when they are connected.
                </p>

                <label className="grid gap-2 text-sm font-medium" htmlFor="speech-to-speech-language">
                    Translation language
                    <Select
                        value={targetLanguageCode}
                        disabled={isConnecting || isTranslating}
                        onValueChange={(value) => value && setTargetLanguageCode(value)}
                    >
                        <SelectTrigger id="speech-to-speech-language" className="w-full">
                            <SelectValue>{(value) => (value ? languageLabel(value) : "Select a language")}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {languageOptions.map(([code, label]) => (
                                    <SelectItem key={code} value={code}>
                                        {label}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </label>

                <Button
                    className="w-full sm:w-fit"
                    type="button"
                    disabled={isConnecting}
                    onClick={() => (isTranslating ? stopTranslation() : void startTranslation())}
                >
                    {isConnecting ? "Connecting…" : isTranslating ? "Stop translation" : "Start translation"}
                </Button>

                <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
                    {status}
                </p>
            </section>
        </main>
    );
}
