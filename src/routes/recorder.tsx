/** @jsxImportSource react */

import { GoogleGenAI, Modality, type Session } from "@google/genai";
import { createFileRoute } from "@tanstack/react-router";
import { PlayIcon, SquareIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import Navigation from "~/components/Navigation";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { requestMicrophoneStream, sendMicrophoneAudio, startMicrophoneCapture } from "~/features/audio/microphone";
import { languageLabel } from "~/features/conversation/types";
import { getRecordings, getRecordingText, type RecordingMetadata, saveRecording } from "~/features/recordings/storage";
import { getEphemeralToken, MODEL } from "~/lib/liveTranslation";

export const Route = createFileRoute("/recorder")({
    component: RecorderPage,
});

const languageOptions = [
    ["en", "English"],
    ["ru", "Russian"],
    ["de", "German"],
    ["uk", "Ukrainian"],
    ["sr", "Serbian"],
] as const;

function formatTimestamp(timestamp: number, includeSeconds = true) {
    const date = new Date(timestamp);
    const pad = (value: number) => String(value).padStart(2, "0");
    const datePart = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const timePart = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    return includeSeconds ? `${datePart} ${timePart}:${pad(date.getSeconds())}` : `${datePart} ${timePart}`;
}

function formatDuration(seconds: number) {
    return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatFilenameTimestamp(timestamp: number) {
    const date = new Date(timestamp);
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}h${pad(date.getMinutes())}m`;
}

function createRecordingId() {
    return crypto.randomUUID();
}

function recentSentences(text: string) {
    const content = text.replace(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\]\n/gm, "").trim();
    const sentences = content.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [];
    return sentences.slice(-2).join(" ").trim();
}

export default function RecorderPage() {
    const [targetLanguageCode, setTargetLanguageCode] = useState("en");
    const [status, setStatus] = useState("Ready to record a translation.");
    const [translation, setTranslation] = useState("");
    const [isRecording, setIsRecording] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [elapsedSeconds, setElapsedSeconds] = useState(0);
    const [title, setTitle] = useState("");
    const [awaitingTitle, setAwaitingTitle] = useState(false);
    const [recordings, setRecordings] = useState<RecordingMetadata[]>([]);
    const [selectedRecording, setSelectedRecording] = useState<RecordingMetadata>();
    const [selectedRecordingText, setSelectedRecordingText] = useState("");

    const targetLanguageCodeRef = useRef(targetLanguageCode);
    const isConnectingRef = useRef(isConnecting);
    const isRecordingRef = useRef(isRecording);
    const sessionRef = useRef<Session | undefined>(undefined);
    const microphoneStreamRef = useRef<MediaStream | undefined>(undefined);
    const stopMicrophoneCaptureRef = useRef<(() => void) | undefined>(undefined);
    const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const durationTimerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
    const refreshSessionRef = useRef<((attempt: number) => void) | undefined>(undefined);
    const startTimestampRef = useRef(0);
    const nextTimestampMinuteRef = useRef(1);
    const recordingStartedAtRef = useRef(0);
    const generationRef = useRef(0);
    const sessionGenerationRef = useRef(0);

    const updateConnectionState = useCallback((connecting: boolean) => {
        isConnectingRef.current = connecting;
        setIsConnecting(connecting);
    }, []);

    const updateRecordingState = useCallback((recording: boolean) => {
        isRecordingRef.current = recording;
        setIsRecording(recording);
    }, []);

    const loadRecordings = useCallback(async () => {
        try {
            setRecordings(await getRecordings());
        } catch (error) {
            console.error("[Vox] Could not load recording list", error);
            setStatus("Could not load saved recordings.");
        }
    }, []);

    const appendTimestamp = useCallback((timestamp: number) => {
        setTranslation((current) => `${current}${current ? "\n" : ""}[${formatTimestamp(timestamp)}]\n`);
    }, []);

    const clearTimers = useCallback(() => {
        if (refreshTimerRef.current !== undefined) clearTimeout(refreshTimerRef.current);
        if (durationTimerRef.current !== undefined) clearInterval(durationTimerRef.current);
        refreshTimerRef.current = undefined;
        durationTimerRef.current = undefined;
    }, []);

    const releaseResources = useCallback(() => {
        clearTimers();
        stopMicrophoneCaptureRef.current?.();
        stopMicrophoneCaptureRef.current = undefined;
        microphoneStreamRef.current?.getTracks().forEach((track) => {
            track.stop();
        });
        microphoneStreamRef.current = undefined;
        sessionRef.current?.close();
        sessionRef.current = undefined;
    }, [clearTimers]);

    const stopRecording = useCallback(
        (statusMessage = "Recording stopped.") => {
            generationRef.current += 1;
            const wasActive = isConnectingRef.current || isRecordingRef.current;
            updateConnectionState(false);
            updateRecordingState(false);
            releaseResources();
            if (wasActive) {
                setAwaitingTitle(true);
                setStatus(statusMessage);
            }
        },
        [releaseResources, updateConnectionState, updateRecordingState],
    );

    const openLiveSession = useCallback(
        async (attempt: number, connection: number) => {
            const token = await getEphemeralToken(targetLanguageCodeRef.current);
            const ai = new GoogleGenAI({ apiKey: token });
            return ai.live.connect({
                model: MODEL,
                config: {
                    responseModalities: [Modality.TEXT],
                    translationConfig: { targetLanguageCode: targetLanguageCodeRef.current, echoTargetLanguage: false },
                },
                callbacks: {
                    onmessage: (message) => {
                        if (attempt !== generationRef.current || connection !== sessionGenerationRef.current) return;
                        const text = message.serverContent?.outputTranscription?.text;
                        if (text) setTranslation((current) => current + text);
                    },
                    onclose: (event) => {
                        if (attempt !== generationRef.current || connection !== sessionGenerationRef.current) return;
                        const reason = event.reason ? `: ${event.reason}` : "";
                        stopRecording(`Translation connection closed (${event.code}${reason}).`);
                    },
                    onerror: (event) => console.error("[Vox] Recorder session error", event),
                },
            });
        },
        [stopRecording],
    );

    const resetRefreshTimer = useCallback((attempt: number) => {
        if (refreshTimerRef.current !== undefined) clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = setTimeout(() => {
            refreshTimerRef.current = undefined;
            refreshSessionRef.current?.(attempt);
        }, 110_000);
    }, []);

    async function refreshSession(attempt: number) {
        if (attempt !== generationRef.current || !isRecordingRef.current) return;
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
            console.error("[Vox] Could not refresh recorder translation", error);
            if (attempt === generationRef.current && connection === sessionGenerationRef.current) {
                stopRecording(error instanceof Error ? error.message : "Could not refresh the recording connection.");
            }
        }
    }

    refreshSessionRef.current = (attempt) => {
        void refreshSession(attempt);
    };

    async function startRecording() {
        const attempt = ++generationRef.current;
        const connection = ++sessionGenerationRef.current;
        const now = Date.now();
        recordingStartedAtRef.current = now;
        startTimestampRef.current = now;
        nextTimestampMinuteRef.current = 1;
        updateConnectionState(true);
        setAwaitingTitle(false);
        setTitle("");
        setElapsedSeconds(0);
        setTranslation("");
        appendTimestamp(now);
        setStatus("Requesting microphone access…");

        try {
            const stream = await requestMicrophoneStream();
            if (attempt !== generationRef.current || connection !== sessionGenerationRef.current) {
                stream.getTracks().forEach((track) => {
                    track.stop();
                });
                return;
            }
            microphoneStreamRef.current = stream;
            setStatus("Opening live translation…");
            const connectedSession = await openLiveSession(attempt, connection);
            if (attempt !== generationRef.current || connection !== sessionGenerationRef.current) {
                connectedSession.close();
                stream.getTracks().forEach((track) => {
                    track.stop();
                });
                return;
            }
            sessionRef.current = connectedSession;
            const stopCapture = await startMicrophoneCapture(stream, (audio) =>
                sendMicrophoneAudio(sessionRef.current, audio),
            );
            if (attempt !== generationRef.current || connection !== sessionGenerationRef.current) {
                stopCapture();
                connectedSession.close();
                stream.getTracks().forEach((track) => {
                    track.stop();
                });
                return;
            }
            stopMicrophoneCaptureRef.current = stopCapture;
            durationTimerRef.current = setInterval(() => {
                const seconds = Math.floor((Date.now() - startTimestampRef.current) / 1000);
                setElapsedSeconds(seconds);
                while (seconds >= nextTimestampMinuteRef.current * 60) {
                    appendTimestamp(startTimestampRef.current + nextTimestampMinuteRef.current * 60_000);
                    nextTimestampMinuteRef.current += 1;
                }
            }, 1_000);
            updateConnectionState(false);
            updateRecordingState(true);
            setStatus("Recording and translating…");
            resetRefreshTimer(attempt);
        } catch (error) {
            console.error("[Vox] Could not start recording", error);
            if (attempt === generationRef.current && connection === sessionGenerationRef.current) {
                stopRecording(error instanceof Error ? error.message : "Could not start recording.");
            }
        }
    }

    async function saveCurrentRecording() {
        if (!translation.trim()) {
            setAwaitingTitle(false);
            setStatus("Nothing was translated, so no recording was saved.");
            return;
        }
        const metadata: RecordingMetadata = {
            id: createRecordingId(),
            timestamp: recordingStartedAtRef.current,
            targetLanguageCode,
            title: title.trim() || undefined,
        };
        try {
            await saveRecording(metadata, translation);
            setAwaitingTitle(false);
            setStatus("Recording saved on this device.");
            await loadRecordings();
        } catch (error) {
            console.error("[Vox] Could not save recording", error);
            setStatus("Could not save the recording.");
        }
    }

    async function openRecording(recording: RecordingMetadata) {
        try {
            setSelectedRecordingText((await getRecordingText(recording.id)) ?? "");
            setSelectedRecording(recording);
        } catch (error) {
            console.error("[Vox] Could not open recording", error);
            setStatus("Could not open that recording.");
        }
    }

    function downloadRecording() {
        if (!selectedRecording) return;
        const titleSuffix = selectedRecording.title ? ` (${selectedRecording.title})` : "";
        const fileName = `Translation Recording from ${formatFilenameTimestamp(selectedRecording.timestamp)}${titleSuffix}.txt`;
        const url = URL.createObjectURL(new Blob([selectedRecordingText], { type: "text/plain;charset=utf-8" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(url);
    }

    useEffect(() => {
        void loadRecordings();
        return () => {
            generationRef.current += 1;
            releaseResources();
        };
    }, [loadRecordings, releaseResources]);

    return (
        <main className="min-h-svh bg-background">
            <Navigation />
            <div className="mx-auto grid w-full max-w-6xl gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
                <section
                    className="flex flex-col gap-5 rounded-xl border bg-card p-6 text-card-foreground shadow-sm"
                    aria-labelledby="recorder-title"
                >
                    <p className="text-sm font-medium text-muted-foreground">Translation mode</p>
                    <h1 id="recorder-title" className="text-3xl font-bold tracking-tight">
                        Recorder
                    </h1>
                    <p className="text-muted-foreground">
                        Record a live translation and keep a timestamped text transcript on this device.
                    </p>
                    <label className="grid gap-2 text-sm font-medium" htmlFor="recorder-language">
                        <span>Translation language</span>
                        <Select
                            value={targetLanguageCode}
                            disabled={isConnecting || isRecording}
                            onValueChange={(value) => {
                                if (!value) return;
                                targetLanguageCodeRef.current = value;
                                setTargetLanguageCode(value);
                            }}
                        >
                            <SelectTrigger id="recorder-language" className="w-full">
                                <SelectValue>
                                    {(value) => (value ? languageLabel(value) : "Select a language")}
                                </SelectValue>
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
                    <div className="flex items-center gap-3">
                        <Button
                            size="icon-lg"
                            type="button"
                            disabled={isConnecting}
                            onClick={() => (isRecording ? stopRecording() : void startRecording())}
                            aria-label={isRecording ? "Stop recording" : "Start recording"}
                        >
                            {isRecording ? <SquareIcon aria-hidden="true" /> : <PlayIcon aria-hidden="true" />}
                        </Button>
                        <span className="font-mono text-sm text-muted-foreground" aria-live="polite">
                            {formatDuration(elapsedSeconds)}
                        </span>
                    </div>
                    <p className="min-h-24 rounded-md border bg-muted/30 p-3 text-sm" aria-live="polite">
                        {recentSentences(translation) || "Your most recent translated sentences will appear here."}
                    </p>
                    <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
                        {status}
                    </p>
                    {awaitingTitle && (
                        <form
                            className="grid gap-4 rounded-lg border p-4"
                            onSubmit={(event) => {
                                event.preventDefault();
                                void saveCurrentRecording();
                            }}
                        >
                            <label className="grid gap-2 text-sm font-medium" htmlFor="recording-title">
                                <span>Recording title (optional)</span>
                                <Input
                                    id="recording-title"
                                    value={title}
                                    onChange={(event) => setTitle(event.currentTarget.value)}
                                />
                            </label>
                            <Button type="submit">Save recording</Button>
                        </form>
                    )}
                </section>
                <aside
                    className="rounded-xl border bg-card p-6 text-card-foreground shadow-sm"
                    aria-label="Previous recordings"
                >
                    <p className="text-sm font-medium text-muted-foreground">On this device</p>
                    <h2 className="mt-1 text-lg font-semibold">Previous recordings</h2>
                    <div className="mt-4 grid gap-2">
                        {recordings.length > 0 ? (
                            recordings.map((recording) => (
                                <Button
                                    variant="outline"
                                    className="grid h-auto w-full justify-start gap-1 rounded-2xl p-3 text-left"
                                    type="button"
                                    key={recording.id}
                                    onClick={() => void openRecording(recording)}
                                >
                                    <span>{formatTimestamp(recording.timestamp)}</span>
                                    <span>
                                        {languageOptions.find(([code]) => code === recording.targetLanguageCode)?.[1] ??
                                            recording.targetLanguageCode}
                                    </span>
                                    {recording.title && <strong>{recording.title}</strong>}
                                </Button>
                            ))
                        ) : (
                            <p className="text-sm text-muted-foreground">No recordings saved yet.</p>
                        )}
                    </div>
                </aside>
            </div>
            <Dialog open={Boolean(selectedRecording)} onOpenChange={(open) => !open && setSelectedRecording(undefined)}>
                {selectedRecording && (
                    <DialogContent className="max-w-2xl" showCloseButton>
                        <DialogHeader>
                            <p className="text-sm text-muted-foreground">
                                {formatTimestamp(selectedRecording.timestamp)}
                            </p>
                            <DialogTitle>{selectedRecording.title || "Translation recording"}</DialogTitle>
                        </DialogHeader>
                        <ScrollArea className="h-96 rounded-2xl border bg-muted/30">
                            <pre className="whitespace-pre-wrap p-3 text-sm">{selectedRecordingText}</pre>
                        </ScrollArea>
                        <DialogFooter>
                            <Button type="button" onClick={downloadRecording}>
                                Save to device
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                )}
            </Dialog>
        </main>
    );
}
