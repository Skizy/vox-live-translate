import { GoogleGenAI, Modality, type Session } from "@google/genai";
import { createSignal, onCleanup } from "solid-js";
import { requestMicrophoneStream, sendMicrophoneAudio, startMicrophoneCapture } from "./audio/microphone";
import { getEphemeralToken, MODEL } from "./liveTranslation";
import Navigation from "./Navigation";

const languageOptions = [
    ["en", "English"],
    ["ru", "Russian"],
    ["de", "German"],
    ["uk", "Ukrainian"],
    ["sr", "Serbian"],
] as const;

export default function SpeechToTextPage() {
    const [targetLanguageCode, setTargetLanguageCode] = createSignal("en");
    const [status, setStatus] = createSignal("Ready to translate speech to text.");
    const [translation, setTranslation] = createSignal("");
    const [isTranslating, setIsTranslating] = createSignal(false);
    const [isConnecting, setIsConnecting] = createSignal(false);
    let session: Session | undefined;
    let stopMicrophoneCapture: (() => void) | undefined;
    let microphoneStream: MediaStream | undefined;
    let generation = 0;

    function releaseResources() {
        stopMicrophoneCapture?.();
        stopMicrophoneCapture = undefined;
        microphoneStream?.getTracks().forEach((track) => {
            track.stop();
        });
        microphoneStream = undefined;
        session?.close();
        session = undefined;
    }

    function stopTranslation(statusMessage = "Translation stopped.") {
        generation += 1;
        const wasActive = isConnecting() || isTranslating();
        setIsConnecting(false);
        setIsTranslating(false);
        releaseResources();

        if (wasActive) {
            setStatus(statusMessage);
        }
    }

    async function startTranslation() {
        const attempt = ++generation;
        setIsConnecting(true);
        setStatus("Requesting microphone access…");
        setTranslation("");

        try {
            microphoneStream = await requestMicrophoneStream();
            const token = await getEphemeralToken();
            setStatus("Opening live text translation…");
            const ai = new GoogleGenAI({ apiKey: token });
            const connectedSession = await ai.live.connect({
                model: MODEL,
                config: {
                    responseModalities: [Modality.TEXT],
                    translationConfig: {
                        targetLanguageCode: targetLanguageCode(),
                        echoTargetLanguage: false,
                    },
                },
                callbacks: {
                    onmessage: (message) => {
                        if (attempt !== generation) {
                            return;
                        }

                        const text = message.serverContent?.outputTranscription?.text;
                        if (text) {
                            setTranslation((current) => current + text);
                        }
                    },
                    onclose: (event) => {
                        if (attempt !== generation) {
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

            if (attempt !== generation) {
                connectedSession.close();
                return;
            }

            session = connectedSession;
            stopMicrophoneCapture = await startMicrophoneCapture(microphoneStream, (audio) => {
                sendMicrophoneAudio(session, audio);
            });

            if (attempt !== generation) {
                stopMicrophoneCapture();
                connectedSession.close();
                return;
            }

            setIsConnecting(false);
            setIsTranslating(true);
            setStatus("Listening and translating to text…");
        } catch (error) {
            console.error("[Vox] Could not start speech-to-text translation", error);
            if (attempt === generation) {
                stopTranslation(error instanceof Error ? error.message : "Could not start speech-to-text translation.");
            }
        }
    }

    onCleanup(() => stopTranslation());

    return (
        <main class="app-shell">
            <Navigation />
            <section class="translator feature-page" aria-labelledby="speech-to-text-title">
                <p class="eyebrow">Translation mode</p>
                <h1 id="speech-to-text-title">Speech to text</h1>
                <p class="lede">Speak naturally and read the live translation in your selected language.</p>

                <label class="field" for="speech-to-text-language">
                    <span>Translation language</span>
                    <select
                        id="speech-to-text-language"
                        value={targetLanguageCode()}
                        disabled={isConnecting() || isTranslating()}
                        onInput={(event) => setTargetLanguageCode(event.currentTarget.value)}
                    >
                        {languageOptions.map(([code, label]) => (
                            <option value={code}>{label}</option>
                        ))}
                    </select>
                </label>

                <button
                    class="primary-button mode-action"
                    type="button"
                    disabled={isConnecting()}
                    onClick={() => (isTranslating() ? stopTranslation() : void startTranslation())}
                >
                    {isConnecting() ? "Connecting…" : isTranslating() ? "Stop translation" : "Start translation"}
                </button>

                <p class="translation" aria-live="polite">
                    {translation() || "Your translated speech will appear here."}
                </p>
                <p class="status" role="status" aria-live="polite">
                    {status()}
                </p>
            </section>
        </main>
    );
}
