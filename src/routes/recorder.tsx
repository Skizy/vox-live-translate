import { GoogleGenAI, Modality, type Session } from "@google/genai";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import Navigation from "~/components/Navigation";
import { requestMicrophoneStream, sendMicrophoneAudio, startMicrophoneCapture } from "~/features/audio/microphone";
import { getRecordings, getRecordingText, type RecordingMetadata, saveRecording } from "~/features/recordings/storage";
import { getEphemeralToken, MODEL } from "~/lib/liveTranslation";

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
    const [targetLanguageCode, setTargetLanguageCode] = createSignal("en");
    const [status, setStatus] = createSignal("Ready to record a translation.");
    const [translation, setTranslation] = createSignal("");
    const [isRecording, setIsRecording] = createSignal(false);
    const [isConnecting, setIsConnecting] = createSignal(false);
    const [elapsedSeconds, setElapsedSeconds] = createSignal(0);
    const [title, setTitle] = createSignal("");
    const [awaitingTitle, setAwaitingTitle] = createSignal(false);
    const [recordings, setRecordings] = createSignal<RecordingMetadata[]>([]);
    const [selectedRecording, setSelectedRecording] = createSignal<RecordingMetadata>();
    const [selectedRecordingText, setSelectedRecordingText] = createSignal("");

    let session: Session | undefined;
    let microphoneStream: MediaStream | undefined;
    let stopMicrophoneCapture: (() => void) | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let durationTimer: ReturnType<typeof setInterval> | undefined;
    let startTimestamp = 0;
    let nextTimestampMinute = 1;
    let recordingStartedAt = 0;
    let generation = 0;
    let sessionGeneration = 0;

    async function loadRecordings() {
        try {
            setRecordings(await getRecordings());
        } catch (error) {
            console.error("[Vox] Could not load recording list", error);
            setStatus("Could not load saved recordings.");
        }
    }

    function appendTimestamp(timestamp: number) {
        setTranslation((current) => `${current}${current ? "\n" : ""}[${formatTimestamp(timestamp)}]\n`);
    }

    function clearTimers() {
        if (refreshTimer !== undefined) clearTimeout(refreshTimer);
        if (durationTimer !== undefined) clearInterval(durationTimer);
        refreshTimer = undefined;
        durationTimer = undefined;
    }

    function resetRefreshTimer(attempt: number) {
        if (refreshTimer !== undefined) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
            refreshTimer = undefined;
            void refreshSession(attempt);
        }, 110_000);
    }

    function releaseResources() {
        clearTimers();
        stopMicrophoneCapture?.();
        stopMicrophoneCapture = undefined;
        microphoneStream?.getTracks().forEach((track) => {
            track.stop();
        });
        microphoneStream = undefined;
        session?.close();
        session = undefined;
    }

    function stopRecording(statusMessage = "Recording stopped.") {
        generation += 1;
        const wasActive = isConnecting() || isRecording();
        setIsConnecting(false);
        setIsRecording(false);
        releaseResources();
        if (wasActive) {
            setAwaitingTitle(true);
            setStatus(statusMessage);
        }
    }

    async function openLiveSession(attempt: number, connection: number) {
        const token = await getEphemeralToken(targetLanguageCode());
        const ai = new GoogleGenAI({ apiKey: token });
        return ai.live.connect({
            model: MODEL,
            config: {
                responseModalities: [Modality.TEXT],
                translationConfig: { targetLanguageCode: targetLanguageCode(), echoTargetLanguage: false },
            },
            callbacks: {
                onmessage: (message) => {
                    if (attempt !== generation || connection !== sessionGeneration) return;
                    const text = message.serverContent?.outputTranscription?.text;
                    if (text) setTranslation((current) => current + text);
                },
                onclose: (event) => {
                    if (attempt !== generation || connection !== sessionGeneration) return;
                    const reason = event.reason ? `: ${event.reason}` : "";
                    stopRecording(`Translation connection closed (${event.code}${reason}).`);
                },
                onerror: (event) => console.error("[Vox] Recorder session error", event),
            },
        });
    }

    async function refreshSession(attempt: number) {
        if (attempt !== generation || !isRecording()) return;
        const connection = ++sessionGeneration;
        try {
            const refreshedSession = await openLiveSession(attempt, connection);
            if (attempt !== generation || connection !== sessionGeneration) {
                refreshedSession.close();
                return;
            }
            const previousSession = session;
            session = refreshedSession;
            previousSession?.close();
            resetRefreshTimer(attempt);
        } catch (error) {
            console.error("[Vox] Could not refresh recorder translation", error);
            if (attempt === generation && connection === sessionGeneration) {
                stopRecording(error instanceof Error ? error.message : "Could not refresh the recording connection.");
            }
        }
    }

    async function startRecording() {
        const attempt = ++generation;
        const connection = ++sessionGeneration;
        const now = Date.now();
        recordingStartedAt = now;
        startTimestamp = now;
        nextTimestampMinute = 1;
        setIsConnecting(true);
        setAwaitingTitle(false);
        setTitle("");
        setElapsedSeconds(0);
        setTranslation("");
        appendTimestamp(now);
        setStatus("Requesting microphone access…");

        try {
            microphoneStream = await requestMicrophoneStream();
            setStatus("Opening live translation…");
            const connectedSession = await openLiveSession(attempt, connection);
            if (attempt !== generation || connection !== sessionGeneration) {
                connectedSession.close();
                return;
            }
            session = connectedSession;
            stopMicrophoneCapture = await startMicrophoneCapture(microphoneStream, (audio) =>
                sendMicrophoneAudio(session, audio),
            );
            if (attempt !== generation || connection !== sessionGeneration) {
                stopMicrophoneCapture();
                connectedSession.close();
                return;
            }
            durationTimer = setInterval(() => {
                const seconds = Math.floor((Date.now() - startTimestamp) / 1000);
                setElapsedSeconds(seconds);
                while (seconds >= nextTimestampMinute * 60) {
                    appendTimestamp(startTimestamp + nextTimestampMinute * 60_000);
                    nextTimestampMinute += 1;
                }
            }, 1_000);
            setIsConnecting(false);
            setIsRecording(true);
            setStatus("Recording and translating…");
            resetRefreshTimer(attempt);
        } catch (error) {
            console.error("[Vox] Could not start recording", error);
            if (attempt === generation && connection === sessionGeneration) {
                stopRecording(error instanceof Error ? error.message : "Could not start recording.");
            }
        }
    }

    async function saveCurrentRecording() {
        if (!translation().trim()) {
            setAwaitingTitle(false);
            setStatus("Nothing was translated, so no recording was saved.");
            return;
        }
        const metadata: RecordingMetadata = {
            id: createRecordingId(),
            timestamp: recordingStartedAt,
            targetLanguageCode: targetLanguageCode(),
            title: title().trim() || undefined,
        };
        try {
            await saveRecording(metadata, translation());
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
        const recording = selectedRecording();
        if (!recording) return;
        const titleSuffix = recording.title ? ` (${recording.title})` : "";
        const fileName = `Translation Recording from ${formatFilenameTimestamp(recording.timestamp)}${titleSuffix}.txt`;
        const link = document.createElement("a");
        link.href = URL.createObjectURL(new Blob([selectedRecordingText()], { type: "text/plain;charset=utf-8" }));
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(link.href);
    }

    onMount(() => void loadRecordings());
    onCleanup(() => releaseResources());

    return (
        <main class="app-shell recorder-shell">
            <Navigation />
            <div class="recorder-layout">
                <section class="translator feature-page recorder-page" aria-labelledby="recorder-title">
                    <p class="eyebrow">Translation mode</p>
                    <h1 id="recorder-title">Recorder</h1>
                    <p class="lede">Record a live translation and keep a timestamped text transcript on this device.</p>
                    <label class="field" for="recorder-language">
                        <span>Translation language</span>
                        <select
                            id="recorder-language"
                            value={targetLanguageCode()}
                            disabled={isConnecting() || isRecording()}
                            onInput={(event) => setTargetLanguageCode(event.currentTarget.value)}
                        >
                            <For each={languageOptions}>{([code, label]) => <option value={code}>{label}</option>}</For>
                        </select>
                    </label>
                    <div class="recorder-controls">
                        <button
                            class="recorder-toggle"
                            type="button"
                            disabled={isConnecting()}
                            onClick={() => (isRecording() ? stopRecording() : void startRecording())}
                            aria-label={isRecording() ? "Stop recording" : "Start recording"}
                        >
                            <Show when={isRecording()} fallback={<span aria-hidden="true">▶</span>}>
                                <span aria-hidden="true">■</span>
                            </Show>
                        </button>
                        <span class="recording-duration" aria-live="polite">
                            {formatDuration(elapsedSeconds())}
                        </span>
                    </div>
                    <p class="recording-preview" aria-live="polite">
                        {recentSentences(translation()) || "Your most recent translated sentences will appear here."}
                    </p>
                    <p class="status" role="status" aria-live="polite">
                        {status()}
                    </p>
                    <Show when={awaitingTitle()}>
                        <form
                            class="recording-save-form"
                            onSubmit={(event) => {
                                event.preventDefault();
                                void saveCurrentRecording();
                            }}
                        >
                            <label class="field" for="recording-title">
                                <span>Recording title (optional)</span>
                                <input
                                    id="recording-title"
                                    value={title()}
                                    onInput={(event) => setTitle(event.currentTarget.value)}
                                />
                            </label>
                            <button class="primary-button" type="submit">
                                Save recording
                            </button>
                        </form>
                    </Show>
                </section>
                <aside class="recordings-sidebar" aria-label="Previous recordings">
                    <p class="eyebrow">On this device</p>
                    <h2>Previous recordings</h2>
                    <div class="recordings-list">
                        <Show
                            when={recordings().length > 0}
                            fallback={<p class="empty-history">No recordings saved yet.</p>}
                        >
                            <For each={recordings()}>
                                {(recording) => (
                                    <button
                                        class="recording-list-item"
                                        type="button"
                                        onClick={() => void openRecording(recording)}
                                    >
                                        <span>{formatTimestamp(recording.timestamp)}</span>
                                        <span>
                                            {languageOptions.find(
                                                ([code]) => code === recording.targetLanguageCode,
                                            )?.[1] ?? recording.targetLanguageCode}
                                        </span>
                                        <Show when={recording.title}>
                                            <strong>{recording.title}</strong>
                                        </Show>
                                    </button>
                                )}
                            </For>
                        </Show>
                    </div>
                </aside>
            </div>
            <Show when={selectedRecording()}>
                {(recording) => (
                    <div class="recording-modal-backdrop">
                        <section
                            class="recording-modal"
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="recording-modal-title"
                        >
                            <div class="recording-modal-heading">
                                <div>
                                    <p class="eyebrow">{formatTimestamp(recording().timestamp)}</p>
                                    <h2 id="recording-modal-title">{recording().title || "Translation recording"}</h2>
                                </div>
                                <button
                                    class="modal-close-button"
                                    type="button"
                                    onClick={() => setSelectedRecording()}
                                    aria-label="Close recording"
                                >
                                    ×
                                </button>
                            </div>
                            <pre class="recording-text">{selectedRecordingText()}</pre>
                            <button class="primary-button" type="button" onClick={downloadRecording}>
                                Save to device
                            </button>
                        </section>
                    </div>
                )}
            </Show>
        </main>
    );
}
