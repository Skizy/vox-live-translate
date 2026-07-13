import { GoogleGenAI, type LiveServerMessage, Modality, type Session } from "@google/genai";
import { createSignal, onCleanup } from "solid-js";

const MODEL = "models/gemini-3.5-live-translate-preview";
const INPUT_SAMPLE_RATE = 16_000;
const OUTPUT_SAMPLE_RATE = 24_000;
const INPUT_BUFFER_SIZE = 2048;

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

export default function App() {
    const [status, setStatus] = createSignal("Ready.");
    const [targetLanguageCode, setTargetLanguageCode] = createSignal("en");
    const [isListening, setIsListening] = createSignal(false);
    const [isConnecting, setIsConnecting] = createSignal(false);

    let liveSession: Session | undefined;
    let microphoneStream: MediaStream | undefined;
    let inputAudioContext: AudioContext | undefined;
    let outputAudioContext: AudioContext | undefined;
    let sourceNode: MediaStreamAudioSourceNode | undefined;
    let processorNode: ScriptProcessorNode | undefined;
    let silentGainNode: GainNode | undefined;
    let nextPlaybackTime = 0;

    function playPcm24k(base64Audio: string) {
        outputAudioContext ??= new AudioContext();

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

        const startAt = Math.max(outputAudioContext.currentTime, nextPlaybackTime);
        source.start(startAt);
        nextPlaybackTime = startAt + audioBuffer.duration;
    }

    async function getEphemeralToken() {
        const response = await fetch("/api/get-ephemeral-token", { method: "POST" });

        if (!response.ok) {
            throw new Error("Could not create a Gemini Live token.");
        }

        const { token } = (await response.json()) as { token?: string };

        if (!token) {
            throw new Error("Token response did not include a token.");
        }

        return token;
    }

    async function connectLiveTranslate(token: string) {
        let hasOpened = false;
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
                onopen: () => {
                    hasOpened = true;
                },
                onmessage: (message: LiveServerMessage) => {
                    for (const part of message.serverContent?.modelTurn?.parts ?? []) {
                        const inlineData = part.inlineData;

                        if (inlineData?.mimeType?.startsWith("audio/pcm") && inlineData.data) {
                            playPcm24k(inlineData.data);
                        }
                    }
                },
                onerror: (event) => {
                    console.error("Gemini Live session error", event);
                },
                onclose: (event) => {
                    const reason = event.reason ? `: ${event.reason}` : "";
                    const message = `Translation connection closed (${event.code}${reason}).`;

                    if (!hasOpened || isListening()) {
                        setStatus(message);
                        stopListening();
                    }
                },
            },
        });
    }

    async function startMicrophoneStream() {
        inputAudioContext = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
        outputAudioContext ??= new AudioContext();
        await inputAudioContext.resume();
        await outputAudioContext.resume();

        microphoneStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
            },
        });

        sourceNode = inputAudioContext.createMediaStreamSource(microphoneStream);
        processorNode = inputAudioContext.createScriptProcessor(INPUT_BUFFER_SIZE, 1, 1);
        silentGainNode = inputAudioContext.createGain();
        silentGainNode.gain.value = 0;

        processorNode.onaudioprocess = (event) => {
            if (!liveSession) {
                return;
            }

            const pcmBytes = floatToInt16Pcm(event.inputBuffer.getChannelData(0));
            liveSession.sendRealtimeInput({
                audio: {
                    mimeType: "audio/pcm;rate=16000",
                    data: bytesToBase64(pcmBytes),
                },
            });
        };

        sourceNode.connect(processorNode);
        processorNode.connect(silentGainNode);
        silentGainNode.connect(inputAudioContext.destination);
    }

    async function startListening() {
        setIsConnecting(true);
        setStatus("Requesting a short-lived Gemini token…");

        try {
            const token = await getEphemeralToken();
            setStatus("Opening live translation session…");
            liveSession = await connectLiveTranslate(token);

            setStatus("Requesting microphone access…");
            await startMicrophoneStream();

            setIsListening(true);
            setStatus("Listening. Speak now.");
        } catch (error) {
            console.error(error);
            setStatus(error instanceof Error ? error.message : "Could not start live translation.");
            stopListening();
        } finally {
            setIsConnecting(false);
        }
    }

    function stopListening() {
        const wasListening = isListening();
        setIsListening(false);

        processorNode?.disconnect();
        sourceNode?.disconnect();
        silentGainNode?.disconnect();
        microphoneStream?.getTracks().forEach((track) => {
            track.stop();
        });

        if (inputAudioContext?.state !== "closed") {
            void inputAudioContext?.close();
        }

        liveSession?.close();
        liveSession = undefined;
        microphoneStream = undefined;
        inputAudioContext = undefined;
        sourceNode = undefined;
        processorNode = undefined;
        silentGainNode = undefined;
        nextPlaybackTime = outputAudioContext?.currentTime ?? 0;

        if (wasListening) {
            setStatus("Stopped.");
        }
    }

    onCleanup(stopListening);

    if ("serviceWorker" in navigator) {
        window.addEventListener("load", () => {
            void navigator.serviceWorker.register("/service-worker.js").catch((error: unknown) => {
                console.error("Service worker registration failed", error);
            });
        });
    }

    return (
        <main class="app-shell">
            <section class="translator" aria-labelledby="app-title">
                <p class="eyebrow">Live speech translation</p>
                <h1 id="app-title">Vox</h1>
                <p class="lede">
                    Choose an output language, press the button, allow microphone access, and speak. Vox streams your
                    voice to Gemini Live Translate and plays the translated audio response.
                </p>

                <label class="field" for="language-select">
                    <span>Output language</span>
                    <select
                        id="language-select"
                        name="language"
                        value={targetLanguageCode()}
                        disabled={isListening() || isConnecting()}
                        onInput={(event) => setTargetLanguageCode(event.currentTarget.value)}
                    >
                        <option value="en">English</option>
                        <option value="ru">Russian</option>
                        <option value="de">German</option>
                        <option value="uk">Ukrainian</option>
                        <option value="sr">Serbian</option>
                    </select>
                </label>

                <button
                    class="primary-button"
                    type="button"
                    disabled={isConnecting()}
                    onClick={() => (isListening() ? stopListening() : void startListening())}
                >
                    {isConnecting() ? "Connecting…" : isListening() ? "Stop listening" : "Start listening"}
                </button>
                <p class="status" role="status" aria-live="polite">
                    {status()}
                </p>
            </section>
        </main>
    );
}
