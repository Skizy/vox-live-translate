import { useCallback, useEffect, useMemo, useRef } from "react";
import { base64ToBytes, getSilentPcm24kDurationMs, OUTPUT_SAMPLE_RATE } from "../audio/pcm";
import type { ConversationPhase } from "./types";

const SILENT_OUTGOING_AUDIO_DURATION_TO_END_TURN_MS = 3_000;

type PlaybackOptions = {
    phase: ConversationPhase;
    setPhase: (phase: ConversationPhase) => void;
    setStatus: (status: string) => void;
};

export function usePcmPlayback({ phase, setPhase, setStatus }: PlaybackOptions) {
    const phaseRef = useRef(phase);
    const outputAudioContextRef = useRef<AudioContext | undefined>(undefined);
    const nextPlaybackTimeRef = useRef(0);
    const queuedAudioRef = useRef<string[]>([]);
    const activeSourcesRef = useRef(new Set<AudioBufferSourceNode>());
    const generationRef = useRef(0);
    const consecutiveSilentDurationMsRef = useRef(0);
    const lastNonSilentAudioTimeRef = useRef(0);
    const terminalSilenceTimerRef = useRef<number | undefined>(undefined);

    useEffect(() => {
        phaseRef.current = phase;
    }, [phase]);

    const cancelTerminalSilenceTransition = useCallback(() => {
        if (terminalSilenceTimerRef.current !== undefined) {
            window.clearTimeout(terminalSilenceTimerRef.current);
            terminalSilenceTimerRef.current = undefined;
        }
    }, []);

    const flushQueueRef = useRef<() => void>(() => undefined);
    const advanceQueueRef = useRef<() => void>(() => undefined);
    const finishEndingPlaybackRef = useRef<() => void>(() => undefined);
    const beginEndingPlaybackRef = useRef<() => void>(() => undefined);
    const resumeListeningAfterTerminalSilenceRef = useRef<() => void>(() => undefined);

    const play = useCallback((base64Audio: string) => {
        const playbackGeneration = generationRef.current;
        let outputAudioContext = outputAudioContextRef.current;
        if (!outputAudioContext) {
            outputAudioContext = new AudioContext();
            outputAudioContextRef.current = outputAudioContext;
        }
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
            if (playbackGeneration !== generationRef.current) return;
            activeSourcesRef.current.delete(source);
            advanceQueueRef.current();
        };
        const startAt = Math.max(outputAudioContext.currentTime, nextPlaybackTimeRef.current);
        activeSourcesRef.current.add(source);
        source.start(startAt);
        nextPlaybackTimeRef.current = startAt + buffer.duration;
    }, []);

    const finishEndingPlayback = useCallback(() => {
        if (activeSourcesRef.current.size !== 0) return;
        if (queuedAudioRef.current.length > 0) {
            flushQueueRef.current();
            return;
        }
        if (phaseRef.current === "ending-play") {
            setPhase("listening");
            setStatus("Listening to your companion.");
        }
    }, [setPhase, setStatus]);

    const beginEndingPlayback = useCallback(() => {
        if (phaseRef.current !== "playing") return;
        cancelTerminalSilenceTransition();
        setPhase("ending-play");
        setStatus("Finishing translation playback…");
        finishEndingPlaybackRef.current();
    }, [cancelTerminalSilenceTransition, setPhase, setStatus]);

    const resumeListeningAfterTerminalSilence = useCallback(() => {
        if (
            phaseRef.current !== "playing" ||
            consecutiveSilentDurationMsRef.current < SILENT_OUTGOING_AUDIO_DURATION_TO_END_TURN_MS
        )
            return;

        const remainingQuietDurationMs = Math.max(
            0,
            SILENT_OUTGOING_AUDIO_DURATION_TO_END_TURN_MS - (performance.now() - lastNonSilentAudioTimeRef.current),
        );
        if (remainingQuietDurationMs === 0) {
            beginEndingPlaybackRef.current();
        } else if (terminalSilenceTimerRef.current === undefined) {
            terminalSilenceTimerRef.current = window.setTimeout(() => {
                terminalSilenceTimerRef.current = undefined;
                if (
                    phaseRef.current === "playing" &&
                    consecutiveSilentDurationMsRef.current >= SILENT_OUTGOING_AUDIO_DURATION_TO_END_TURN_MS &&
                    performance.now() - lastNonSilentAudioTimeRef.current >=
                        SILENT_OUTGOING_AUDIO_DURATION_TO_END_TURN_MS
                ) {
                    beginEndingPlaybackRef.current();
                }
            }, remainingQuietDurationMs);
        }
    }, []);

    const flushQueue = useCallback(() => {
        const audio = queuedAudioRef.current;
        queuedAudioRef.current = [];
        for (const chunk of audio) play(chunk);
    }, [play]);

    const advanceQueue = useCallback(() => {
        if (activeSourcesRef.current.size !== 0) return;
        if (queuedAudioRef.current.length > 0) {
            flushQueueRef.current();
        } else if (phaseRef.current === "ending-play") {
            finishEndingPlaybackRef.current();
        } else if (phaseRef.current === "playing") {
            resumeListeningAfterTerminalSilenceRef.current();
        }
    }, []);

    finishEndingPlaybackRef.current = finishEndingPlayback;
    beginEndingPlaybackRef.current = beginEndingPlayback;
    resumeListeningAfterTerminalSilenceRef.current = resumeListeningAfterTerminalSilence;
    flushQueueRef.current = flushQueue;
    advanceQueueRef.current = advanceQueue;

    const receive = useCallback(
        (base64Audio: string) => {
            if (phaseRef.current === "speaking") {
                queuedAudioRef.current.push(base64Audio);
                return;
            }
            if (phaseRef.current !== "playing") {
                console.warn("[Vox] Discarded outgoing translation audio outside an active turn", {
                    phase: phaseRef.current,
                });
                return;
            }

            queuedAudioRef.current.push(base64Audio);
            const silentDurationMs = getSilentPcm24kDurationMs(base64Audio);
            if (silentDurationMs === undefined) {
                consecutiveSilentDurationMsRef.current = 0;
                lastNonSilentAudioTimeRef.current = performance.now();
                cancelTerminalSilenceTransition();
            } else {
                consecutiveSilentDurationMsRef.current += silentDurationMs;
                resumeListeningAfterTerminalSilenceRef.current();
            }
            advanceQueueRef.current();
        },
        [cancelTerminalSilenceTransition],
    );

    const receiveIncoming = useCallback(
        (base64Audio: string) => {
            play(base64Audio);
        },
        [play],
    );

    const beginSpeaking = useCallback(() => {
        queuedAudioRef.current = [];
        consecutiveSilentDurationMsRef.current = 0;
        lastNonSilentAudioTimeRef.current = 0;
        cancelTerminalSilenceTransition();
    }, [cancelTerminalSilenceTransition]);

    const finishSpeaking = useCallback(() => {
        flushQueueRef.current();
        advanceQueueRef.current();
    }, []);

    const resumeOutput = useCallback(() => {
        let outputAudioContext = outputAudioContextRef.current;
        if (!outputAudioContext) {
            outputAudioContext = new AudioContext();
            outputAudioContextRef.current = outputAudioContext;
        }
        return outputAudioContext.resume();
    }, []);

    const stop = useCallback(() => {
        generationRef.current += 1;
        for (const source of activeSourcesRef.current) {
            source.onended = null;
            source.stop();
            source.disconnect();
        }
        activeSourcesRef.current.clear();
        queuedAudioRef.current = [];
        consecutiveSilentDurationMsRef.current = 0;
        lastNonSilentAudioTimeRef.current = 0;
        cancelTerminalSilenceTransition();
        nextPlaybackTimeRef.current = outputAudioContextRef.current?.currentTime ?? 0;
    }, [cancelTerminalSilenceTransition]);

    return useMemo(
        () => ({ beginSpeaking, finishSpeaking, receive, receiveIncoming, resumeOutput, stop }),
        [beginSpeaking, finishSpeaking, receive, receiveIncoming, resumeOutput, stop],
    );
}
