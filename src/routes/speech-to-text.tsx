import { GoogleGenAI, Modality, type Session } from "@google/genai";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import Navigation from "~/components/Navigation";
import { Button } from "~/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { requestMicrophoneStream, sendMicrophoneAudio, startMicrophoneCapture } from "~/features/audio/microphone";
import { languageLabel } from "~/features/conversation/types";
import { getEphemeralToken, MODEL } from "~/lib/liveTranslation";

export const Route = createFileRoute("/speech-to-text")({
    component: SpeechToTextPage,
});

const languageOptions = [
    ["en", "English"],
    ["ru", "Russian"],
    ["de", "German"],
    ["uk", "Ukrainian"],
    ["sr", "Serbian"],
] as const;

function SpeechToTextPage() {
    const [targetLanguageCode, setTargetLanguageCode] = useState("en");
    const [status, setStatus] = useState("Ready to translate speech to text.");
    const [translation, setTranslation] = useState("");
    const [isTranslating, setIsTranslating] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const targetLanguageCodeRef = useRef(targetLanguageCode);
    const isTranslatingRef = useRef(isTranslating);
    const isConnectingRef = useRef(isConnecting);
    const sessionRef = useRef<Session | undefined>(undefined);
    const stopMicrophoneCaptureRef = useRef<(() => void) | undefined>(undefined);
    const microphoneStreamRef = useRef<MediaStream | undefined>(undefined);
    const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const generationRef = useRef(0);
    const sessionGenerationRef = useRef(0);

    targetLanguageCodeRef.current = targetLanguageCode;
    isTranslatingRef.current = isTranslating;
    isConnectingRef.current = isConnecting;

    function clearRefreshTimer() {
        if (refreshTimerRef.current !== undefined) {
            clearTimeout(refreshTimerRef.current);
            refreshTimerRef.current = undefined;
        }
    }

    function resetRefreshTimer(attempt: number) {
        clearRefreshTimer();
        refreshTimerRef.current = setTimeout(() => {
            refreshTimerRef.current = undefined;
            void refreshSession(attempt);
        }, 110_000);
    }

    function releaseResources() {
        clearRefreshTimer();
        stopMicrophoneCaptureRef.current?.();
        stopMicrophoneCaptureRef.current = undefined;
        microphoneStreamRef.current?.getTracks().forEach((track) => {
            track.stop();
        });
        microphoneStreamRef.current = undefined;
        sessionRef.current?.close();
        sessionRef.current = undefined;
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

    async function openLiveSession(attempt: number, connection: number) {
        const languageCode = targetLanguageCodeRef.current;
        const token = await getEphemeralToken(languageCode);
        const ai = new GoogleGenAI({ apiKey: token });

        return ai.live.connect({
            model: MODEL,
            config: {
                responseModalities: [Modality.TEXT],
                translationConfig: {
                    targetLanguageCode: languageCode,
                    echoTargetLanguage: false,
                },
            },
            callbacks: {
                onmessage: (message) => {
                    if (attempt !== generationRef.current || connection !== sessionGenerationRef.current) {
                        return;
                    }

                    const text = message.serverContent?.outputTranscription?.text;
                    if (text) {
                        setTranslation((current) => current + text);
                    }
                },
                onclose: (event) => {
                    if (attempt !== generationRef.current || connection !== sessionGenerationRef.current) {
                        return;
                    }

                    const reason = event.reason ? `: ${event.reason}` : "";
                    stopTranslation(`Translation connection closed (${event.code}${reason}).`);
                },
                onerror: (event) => {
                    console.error("[Vox] Speech-to-text session error", event);
                },
            },
        });
    }

    async function refreshSession(attempt: number) {
        if (attempt !== generationRef.current || !isTranslatingRef.current) {
            return;
        }

        const connection = ++sessionGenerationRef.current;

        try {
            const refreshedSession = await openLiveSession(attempt, connection);
            if (attempt !== generationRef.current || connection !== sessionGenerationRef.current) {
                refreshedSession.close();
                return;
            }

            const previousSession = sessionRef.current;
            sessionRef.current = refreshedSession;
            previousSession?.close();
            resetRefreshTimer(attempt);
        } catch (error) {
            console.error("[Vox] Could not refresh speech-to-text translation", error);
            if (attempt === generationRef.current && connection === sessionGenerationRef.current) {
                stopTranslation(
                    error instanceof Error ? error.message : "Could not refresh speech-to-text translation.",
                );
            }
        }
    }

    async function startTranslation() {
        const attempt = ++generationRef.current;
        const connection = ++sessionGenerationRef.current;
        setIsConnecting(true);
        setStatus("Requesting microphone access…");
        setTranslation("");

        try {
            const microphoneStream = await requestMicrophoneStream();
            microphoneStreamRef.current = microphoneStream;
            setStatus("Opening live text translation…");
            const connectedSession = await openLiveSession(attempt, connection);

            if (attempt !== generationRef.current || connection !== sessionGenerationRef.current) {
                connectedSession.close();
                return;
            }

            sessionRef.current = connectedSession;
            stopMicrophoneCaptureRef.current = await startMicrophoneCapture(microphoneStream, (audio) => {
                sendMicrophoneAudio(sessionRef.current, audio);
            });

            if (attempt !== generationRef.current || connection !== sessionGenerationRef.current) {
                stopMicrophoneCaptureRef.current();
                connectedSession.close();
                return;
            }

            setIsConnecting(false);
            setIsTranslating(true);
            setStatus("Listening and translating to text…");
            resetRefreshTimer(attempt);
        } catch (error) {
            console.error("[Vox] Could not start speech-to-text translation", error);
            if (attempt === generationRef.current && connection === sessionGenerationRef.current) {
                stopTranslation(error instanceof Error ? error.message : "Could not start speech-to-text translation.");
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
                aria-labelledby="speech-to-text-title"
            >
                <div className="space-y-2">
                    <p className="text-sm font-medium text-muted-foreground">Translation mode</p>
                    <h1 id="speech-to-text-title" className="text-3xl font-bold tracking-tight">
                        Speech to text
                    </h1>
                    <p className="text-muted-foreground">
                        Speak naturally and read the live translation in your selected language.
                    </p>
                </div>

                <label className="grid gap-2 text-sm font-medium" htmlFor="speech-to-text-language">
                    Translation language
                    <Select
                        value={targetLanguageCode}
                        disabled={isConnecting || isTranslating}
                        onValueChange={(value) => value && setTargetLanguageCode(value)}
                    >
                        <SelectTrigger id="speech-to-text-language" className="w-full">
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

                <p className="min-h-32 rounded-lg border bg-muted/30 p-4 text-sm" aria-live="polite">
                    {translation || "Your translated speech will appear here."}
                </p>
                <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
                    {status}
                </p>
            </section>
        </main>
    );
}
