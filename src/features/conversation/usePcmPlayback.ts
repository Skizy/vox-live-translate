import type { Accessor } from "solid-js";
import { base64ToBytes, getSilentPcm24kDurationMs, OUTPUT_SAMPLE_RATE } from "../audio/pcm";
import type { ConversationPhase } from "./types";

const SILENT_OUTGOING_AUDIO_DURATION_TO_END_TURN_MS = 3_000;

type PlaybackOptions = {
    phase: Accessor<ConversationPhase>;
    setPhase: (phase: ConversationPhase) => void;
    setStatus: (status: string) => void;
};

export function usePcmPlayback({ phase, setPhase, setStatus }: PlaybackOptions) {
    let outputAudioContext: AudioContext | undefined;
    let nextPlaybackTime = 0;
    let queuedAudio: string[] = [];
    const activeSources = new Set<AudioBufferSourceNode>();
    let generation = 0;
    let consecutiveSilentDurationMs = 0;
    let lastNonSilentAudioTime = 0;
    let terminalSilenceTimer: number | undefined;

    function cancelTerminalSilenceTransition() {
        if (terminalSilenceTimer !== undefined) {
            window.clearTimeout(terminalSilenceTimer);
            terminalSilenceTimer = undefined;
        }
    }

    function finishEndingPlayback() {
        if (activeSources.size !== 0) return;
        if (queuedAudio.length > 0) {
            flushQueue();
            return;
        }
        if (phase() === "ending-play") {
            setPhase("listening");
            setStatus("Listening to your companion.");
        }
    }

    function beginEndingPlayback() {
        if (phase() !== "playing") return;
        cancelTerminalSilenceTransition();
        setPhase("ending-play");
        setStatus("Finishing translation playback…");
        finishEndingPlayback();
    }

    function resumeListeningAfterTerminalSilence() {
        if (phase() !== "playing" || consecutiveSilentDurationMs < SILENT_OUTGOING_AUDIO_DURATION_TO_END_TURN_MS)
            return;

        const remainingQuietDurationMs = Math.max(
            0,
            SILENT_OUTGOING_AUDIO_DURATION_TO_END_TURN_MS - (performance.now() - lastNonSilentAudioTime),
        );
        if (remainingQuietDurationMs === 0) {
            beginEndingPlayback();
        } else if (terminalSilenceTimer === undefined) {
            terminalSilenceTimer = window.setTimeout(() => {
                terminalSilenceTimer = undefined;
                if (
                    phase() === "playing" &&
                    consecutiveSilentDurationMs >= SILENT_OUTGOING_AUDIO_DURATION_TO_END_TURN_MS &&
                    performance.now() - lastNonSilentAudioTime >= SILENT_OUTGOING_AUDIO_DURATION_TO_END_TURN_MS
                ) {
                    beginEndingPlayback();
                }
            }, remainingQuietDurationMs);
        }
    }

    function advanceQueue() {
        if (activeSources.size !== 0) return;
        if (queuedAudio.length > 0) {
            flushQueue();
        } else if (phase() === "ending-play") {
            finishEndingPlayback();
        } else if (phase() === "playing") {
            resumeListeningAfterTerminalSilence();
        }
    }

    function play(base64Audio: string) {
        const playbackGeneration = generation;
        outputAudioContext ??= new AudioContext();
        if (outputAudioContext.state !== "running") {
            void outputAudioContext
                .resume()
                .catch((error: unknown) => console.error("[Vox] Could not resume output audio context", error));
        }

        const pcmBytes = base64ToBytes(base64Audio);
        const samples = new Int16Array(
            pcmBytes.buffer,
            pcmBytes.byteOffset,
            pcmBytes.byteLength / Int16Array.BYTES_PER_ELEMENT,
        );
        const buffer = outputAudioContext.createBuffer(1, samples.length, OUTPUT_SAMPLE_RATE);
        const channel = buffer.getChannelData(0);
        for (let index = 0; index < samples.length; index += 1) channel[index] = (samples[index] ?? 0) / 0x8000;

        const source = outputAudioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(outputAudioContext.destination);
        source.onended = () => {
            if (playbackGeneration !== generation) return;
            activeSources.delete(source);
            advanceQueue();
        };
        const startAt = Math.max(outputAudioContext.currentTime, nextPlaybackTime);
        activeSources.add(source);
        source.start(startAt);
        nextPlaybackTime = startAt + buffer.duration;
    }

    function flushQueue() {
        const audio = queuedAudio;
        queuedAudio = [];
        for (const chunk of audio) play(chunk);
    }

    function receive(base64Audio: string) {
        if (phase() === "speaking") {
            queuedAudio.push(base64Audio);
            return;
        }
        if (phase() !== "playing") {
            console.warn("[Vox] Discarded outgoing translation audio outside an active turn", { phase: phase() });
            return;
        }

        queuedAudio.push(base64Audio);
        const silentDurationMs = getSilentPcm24kDurationMs(base64Audio);
        if (silentDurationMs === undefined) {
            consecutiveSilentDurationMs = 0;
            lastNonSilentAudioTime = performance.now();
            cancelTerminalSilenceTransition();
        } else {
            consecutiveSilentDurationMs += silentDurationMs;
            resumeListeningAfterTerminalSilence();
        }
        advanceQueue();
    }

    function receiveIncoming(base64Audio: string) {
        play(base64Audio);
    }

    function beginSpeaking() {
        queuedAudio = [];
        consecutiveSilentDurationMs = 0;
        lastNonSilentAudioTime = 0;
        cancelTerminalSilenceTransition();
    }

    function finishSpeaking() {
        flushQueue();
        advanceQueue();
    }

    function resumeOutput() {
        outputAudioContext ??= new AudioContext();
        return outputAudioContext.resume();
    }

    function stop() {
        generation += 1;
        for (const source of activeSources) {
            source.onended = null;
            source.stop();
            source.disconnect();
        }
        activeSources.clear();
        queuedAudio = [];
        consecutiveSilentDurationMs = 0;
        lastNonSilentAudioTime = 0;
        cancelTerminalSilenceTransition();
        nextPlaybackTime = outputAudioContext?.currentTime ?? 0;
    }

    return { beginSpeaking, finishSpeaking, receive, receiveIncoming, resumeOutput, stop };
}
