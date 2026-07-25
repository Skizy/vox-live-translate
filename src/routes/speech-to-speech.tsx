import { GoogleGenAI, Modality, type Session } from "@google/genai";

import { createSignal, onCleanup } from "solid-js";
import Navigation from "~/components/Navigation";
import { requestMicrophoneStream, sendMicrophoneAudio, startMicrophoneCapture } from "~/features/audio/microphone";
import { base64ToBytes, OUTPUT_SAMPLE_RATE } from "~/features/audio/pcm";
import { getEphemeralToken, MODEL } from "~/lib/liveTranslation";

const languageOptions = [
    ["en", "English"],
    ["ru", "Russian"],
    ["de", "German"],
    ["uk", "Ukrainian"],
    ["sr", "Serbian"],
] as const;

export default function SpeechToSpeechPage() {
    const [targetLanguageCode, setTargetLanguageCode] = createSignal("en");
    const [status, setStatus] = createSignal("Ready to translate speech to speech.");
    const [isTranslating, setIsTranslating] = createSignal(false);
    const [isConnecting, setIsConnecting] = createSignal(false);
    let session: Session | undefined;
    let microphoneStream: MediaStream | undefined;
    let stopMicrophoneCapture: (() => void) | undefined;
    let outputAudioContext: AudioContext | undefined;
    let nextPlaybackTime = 0;
    let generation = 0;
    let sessionGeneration = 0;
    let playbackGeneration = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    const activePlaybackSources = new Set<AudioBufferSourceNode>();

    function stopPlayback() {
        playbackGeneration += 1;
        for (const source of activePlaybackSources) {
            source.onended = null;
            source.stop();
            source.disconnect();
        }
        activePlaybackSources.clear();
        nextPlaybackTime = 0;

        if (outputAudioContext?.state !== "closed") {
            void outputAudioContext?.close();
        }
        outputAudioContext = undefined;
    }

    function playPcm24k(base64Audio: string) {
        const context = outputAudioContext;
        const currentPlaybackGeneration = playbackGeneration;

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
                if (currentPlaybackGeneration === playbackGeneration) {
                    activePlaybackSources.delete(source);
                }
            };

            const startAt = Math.max(context.currentTime, nextPlaybackTime);
            activePlaybackSources.add(source);
            source.start(startAt);
            nextPlaybackTime = startAt + audioBuffer.duration;
        } catch (error) {
            console.error("[Vox] Could not play translated speech", error);
        }
    }

    function clearReconnectTimer() {
        if (reconnectTimer !== undefined) {
            clearTimeout(reconnectTimer);
            reconnectTimer = undefined;
        }
    }

    function releaseResources() {
        clearReconnectTimer();
        stopMicrophoneCapture?.();
        stopMicrophoneCapture = undefined;
        microphoneStream?.getTracks().forEach((track) => {
            track.stop();
        });
        microphoneStream = undefined;
        session?.close();
        session = undefined;
        stopPlayback();
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

    async function connectLiveSession(token: string, attempt: number, sessionAttempt: number) {
        const ai = new GoogleGenAI({ apiKey: token });
        return ai.live.connect({
            model: MODEL,
            config: {
                responseModalities: [Modality.AUDIO],
                translationConfig: {
                    targetLanguageCode: targetLanguageCode(),
                    echoTargetLanguage: false,
                },
            },
            callbacks: {
                onmessage: (message) => {
                    if (attempt !== generation || sessionAttempt !== sessionGeneration) {
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
                    if (attempt !== generation || sessionAttempt !== sessionGeneration) {
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
        reconnectTimer = setTimeout(() => {
            reconnectTimer = undefined;
            void refreshSession(attempt);
        }, 110_000);
    }

    async function refreshSession(attempt: number) {
        if (attempt !== generation || !session) {
            return;
        }

        const sessionAttempt = ++sessionGeneration;

        try {
            const token = await getEphemeralToken(targetLanguageCode());
            const connectedSession = await connectLiveSession(token, attempt, sessionAttempt);

            if (attempt !== generation || sessionAttempt !== sessionGeneration) {
                connectedSession.close();
                return;
            }

            const previousSession = session;
            session = connectedSession;
            previousSession.close();
            scheduleSessionRefresh(attempt);
        } catch (error) {
            console.error("[Vox] Could not refresh speech-to-speech translation", error);
            if (attempt === generation && sessionAttempt === sessionGeneration) {
                stopTranslation(
                    error instanceof Error ? error.message : "Could not refresh speech-to-speech translation.",
                );
            }
        }
    }

    async function startTranslation() {
        const attempt = ++generation;
        setIsConnecting(true);
        setStatus("Preparing audio and requesting microphone access…");

        try {
            outputAudioContext = new AudioContext();
            await outputAudioContext.resume();
            microphoneStream = await requestMicrophoneStream();
            const token = await getEphemeralToken(targetLanguageCode());
            const sessionAttempt = ++sessionGeneration;
            setStatus("Opening live speech translation…");
            const connectedSession = await connectLiveSession(token, attempt, sessionAttempt);

            if (attempt !== generation || sessionAttempt !== sessionGeneration) {
                connectedSession.close();
                return;
            }

            session = connectedSession;
            stopMicrophoneCapture = await startMicrophoneCapture(microphoneStream, (audio) => {
                sendMicrophoneAudio(session, audio);
            });

            if (attempt !== generation || sessionAttempt !== sessionGeneration) {
                stopMicrophoneCapture();
                connectedSession.close();
                return;
            }

            setIsConnecting(false);
            setIsTranslating(true);
            setStatus("Listening and speaking the translation…");
            scheduleSessionRefresh(attempt);
        } catch (error) {
            console.error("[Vox] Could not start speech-to-speech translation", error);
            if (attempt === generation) {
                stopTranslation(
                    error instanceof Error ? error.message : "Could not start speech-to-speech translation.",
                );
            }
        }
    }

    onCleanup(() => stopTranslation());

    return (
        <main class="app-shell">
            <Navigation />
            <section class="translator feature-page" aria-labelledby="speech-to-speech-title">
                <p class="eyebrow">Translation mode</p>
                <h1 id="speech-to-speech-title">Speech to speech</h1>
                <p class="lede">Speak naturally and hear the live translation in your selected language.</p>

                <label class="field" for="speech-to-speech-language">
                    <span>Translation language</span>
                    <select
                        id="speech-to-speech-language"
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

                <p class="status" role="status" aria-live="polite">
                    {status()}
                </p>
            </section>
        </main>
    );
}
