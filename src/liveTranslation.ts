import type { Session } from "@google/genai";

export const MODEL = "models/gemini-3.5-live-translate-preview";
export const INPUT_SAMPLE_RATE = 16_000;
export const INPUT_BUFFER_SIZE = 2048;

function bytesToBase64(bytes: Uint8Array) {
    let binary = "";
    const chunkSize = 0x8000;

    for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }

    return btoa(binary);
}

function floatToInt16Pcm(float32Data: Float32Array) {
    const int16Buffer = new Int16Array(float32Data.length);

    for (let index = 0; index < float32Data.length; index += 1) {
        const sample = Math.max(-1, Math.min(1, float32Data[index] ?? 0));
        int16Buffer[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }

    return new Uint8Array(int16Buffer.buffer);
}

export async function getEphemeralToken() {
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

export async function requestMicrophoneStream() {
    if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser must be served over HTTPS to access the microphone.");
    }

    return navigator.mediaDevices.getUserMedia({
        audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
        },
    });
}

export async function startMicrophoneCapture(stream: MediaStream, onAudio: (audio: Uint8Array) => void) {
    const audioContext = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(INPUT_BUFFER_SIZE, 1, 1);
    const silentGain = audioContext.createGain();
    let stopped = false;

    silentGain.gain.value = 0;
    processor.onaudioprocess = (event) => {
        onAudio(floatToInt16Pcm(event.inputBuffer.getChannelData(0)));
    };

    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(audioContext.destination);
    await audioContext.resume();

    return () => {
        if (stopped) {
            return;
        }

        stopped = true;
        processor.onaudioprocess = null;
        processor.disconnect();
        source.disconnect();
        silentGain.disconnect();
        stream.getTracks().forEach((track) => {
            track.stop();
        });
        if (audioContext.state !== "closed") {
            void audioContext.close();
        }
    };
}

export function sendMicrophoneAudio(session: Session | undefined, audio: Uint8Array) {
    if (!session) {
        return;
    }

    session.sendRealtimeInput({
        audio: {
            mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}`,
            data: bytesToBase64(audio),
        },
    });
}

export function base64ToBytes(base64: string) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
}
