import { GoogleGenAI, type LiveServerMessage, Modality, type Session } from "@google/genai";

const MODEL = "models/gemini-3.5-live-translate-preview";
const INPUT_SAMPLE_RATE = 16_000;
const OUTPUT_SAMPLE_RATE = 24_000;
const INPUT_BUFFER_SIZE = 2048;

function requireElement<T extends Element>(selector: string) {
    const element = document.querySelector<T>(selector);

    if (!element) {
        throw new Error(`Required element is missing: ${selector}`);
    }

    return element;
}

const listenButton = requireElement<HTMLButtonElement>("#listen-button");
const languageSelect = requireElement<HTMLSelectElement>("#language-select");
const statusElement = requireElement<HTMLElement>("#status");

let liveSession: Session | undefined;
let microphoneStream: MediaStream | undefined;
let inputAudioContext: AudioContext | undefined;
let outputAudioContext: AudioContext | undefined;
let sourceNode: MediaStreamAudioSourceNode | undefined;
let processorNode: ScriptProcessorNode | undefined;
let silentGainNode: GainNode | undefined;
let nextPlaybackTime = 0;
let isListening = false;

function setStatus(message: string) {
    statusElement.textContent = message;
}

function bytesToBase64(bytes: Uint8Array) {
    let binary = "";
    const chunkSize = 0x8000;

    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }

    return btoa(binary);
}

function base64ToBytes(base64: string) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
}

function floatToInt16Pcm(float32Data: Float32Array) {
    const int16Buffer = new Int16Array(float32Data.length);

    for (let i = 0; i < float32Data.length; i += 1) {
        const sample = Math.max(-1, Math.min(1, float32Data[i] ?? 0));
        int16Buffer[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }

    return new Uint8Array(int16Buffer.buffer);
}

function playPcm24k(base64Audio: string) {
    outputAudioContext = outputAudioContext ?? new AudioContext();

    const pcmBytes = base64ToBytes(base64Audio);
    const samples = new Int16Array(pcmBytes.buffer);
    const audioBuffer = outputAudioContext.createBuffer(1, samples.length, OUTPUT_SAMPLE_RATE);
    const channel = audioBuffer.getChannelData(0);

    for (let i = 0; i < samples.length; i += 1) {
        channel[i] = (samples[i] ?? 0) / 0x8000;
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

function handleLiveMessage(message: LiveServerMessage) {
    const parts = message.serverContent?.modelTurn?.parts;

    if (!parts) {
        return;
    }

    for (const part of parts) {
        const inlineData = part.inlineData;

        if (inlineData?.mimeType?.startsWith("audio/pcm") && inlineData.data) {
            playPcm24k(inlineData.data);
        }
    }
}

async function connectLiveTranslate(token: string, targetLanguageCode: string) {
    let hasOpened = false;
    const ai = new GoogleGenAI({ apiKey: token });

    const session = await ai.live.connect({
        model: MODEL,
        config: {
            responseModalities: [Modality.AUDIO],
            translationConfig: {
                targetLanguageCode,
                echoTargetLanguage: false,
            },
        },
        callbacks: {
            onopen: () => {
                hasOpened = true;
            },
            onmessage: handleLiveMessage,
            onerror: (event) => {
                console.error("Gemini Live session error", event);
            },
            onclose: (event) => {
                const reason = event.reason ? `: ${event.reason}` : "";
                const message = `Translation connection closed (${event.code}${reason}).`;

                if (!hasOpened) {
                    setStatus(message);
                    return;
                }

                if (isListening) {
                    setStatus(message);
                    stopListening();
                }
            },
        },
    });

    return session;
}

async function startMicrophoneStream() {
    inputAudioContext = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
    outputAudioContext = outputAudioContext ?? new AudioContext();
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

        const float32Data = event.inputBuffer.getChannelData(0);
        const pcmBytes = floatToInt16Pcm(float32Data);
        const base64Audio = bytesToBase64(pcmBytes);

        liveSession.sendRealtimeInput({
            audio: {
                mimeType: "audio/pcm;rate=16000",
                data: base64Audio,
            },
        });
    };

    sourceNode.connect(processorNode);
    processorNode.connect(silentGainNode);
    silentGainNode.connect(inputAudioContext.destination);
}

async function startListening() {
    isListening = true;
    listenButton.disabled = true;
    languageSelect.disabled = true;
    listenButton.textContent = "Connecting…";
    setStatus("Requesting a short-lived Gemini token…");

    try {
        const token = await getEphemeralToken();
        const targetLanguageCode = languageSelect.value;

        setStatus("Opening live translation session…");
        liveSession = await connectLiveTranslate(token, targetLanguageCode);

        setStatus("Requesting microphone access…");
        await startMicrophoneStream();

        listenButton.disabled = false;
        listenButton.textContent = "Stop listening";
        setStatus("Listening. Speak now.");
    } catch (error) {
        console.error(error);
        setStatus(error instanceof Error ? error.message : "Could not start live translation.");
        stopListening();
    }
}

function stopListening() {
    isListening = false;
    listenButton.disabled = false;
    languageSelect.disabled = false;
    listenButton.textContent = "Start listening";

    processorNode?.disconnect();
    sourceNode?.disconnect();
    silentGainNode?.disconnect();
    microphoneStream?.getTracks().forEach((track) => {
        track.stop();
    });

    if (inputAudioContext?.state !== "closed") {
        inputAudioContext?.close();
    }

    liveSession?.close();

    liveSession = undefined;
    microphoneStream = undefined;
    inputAudioContext = undefined;
    sourceNode = undefined;
    processorNode = undefined;
    silentGainNode = undefined;
    nextPlaybackTime = outputAudioContext?.currentTime ?? 0;

    if (statusElement.textContent === "Listening. Speak now.") {
        setStatus("Stopped.");
    }
}

listenButton.addEventListener("click", () => {
    if (isListening) {
        stopListening();
        setStatus("Stopped.");
        return;
    }

    startListening();
});

if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("/service-worker.js").catch((error: unknown) => {
            console.error("Service worker registration failed", error);
        });
    });
}
