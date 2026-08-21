import { Button } from "~/components/ui/button";
import type { ConversationMode, ConversationPhase } from "./types";

type ConversationControlsProps = {
    phase: ConversationPhase;
    translation: string;
    conversationMode: ConversationMode;
    isCompanionLanguageReady: boolean;
    beginSpeaking: () => void;
    finishSpeaking: () => void;
};

export function ConversationControls({
    phase,
    translation,
    conversationMode,
    isCompanionLanguageReady,
    beginSpeaking,
    finishSpeaking,
}: ConversationControlsProps) {
    return (
        <section className="space-y-4 rounded-lg border bg-muted/30 p-4" aria-label="Conversation controls">
            <Button
                className="w-full sm:w-auto"
                type="button"
                disabled={phase !== "listening" || !isCompanionLanguageReady}
                onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    beginSpeaking();
                }}
                onPointerUp={(event) => {
                    finishSpeaking();
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                        event.currentTarget.releasePointerCapture(event.pointerId);
                    }
                }}
                onPointerCancel={finishSpeaking}
                onLostPointerCapture={finishSpeaking}
            >
                {phase === "speaking" ? "Release to translate" : "I am speaking"}
            </Button>
            <p className="text-sm text-muted-foreground">
                {conversationMode === "companion-audio"
                    ? "Hold while you speak. Your translated text appears after you release."
                    : "Hold while you speak. Your translated audio plays after you release."}
            </p>
            <p className="min-h-24 rounded-md border bg-background p-3 text-sm" aria-live="polite">
                {translation ||
                    (conversationMode === "companion-audio"
                        ? "Your translation will appear here."
                        : "Your companion’s translation will appear here.")}
            </p>
        </section>
    );
}
