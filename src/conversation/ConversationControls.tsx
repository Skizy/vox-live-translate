import type { Accessor } from "solid-js";
import type { ConversationPhase } from "./types";

type ConversationControlsProps = {
    phase: Accessor<ConversationPhase>;
    translation: Accessor<string>;
    beginSpeaking: () => void;
    finishSpeaking: () => void;
};

export function ConversationControls(props: ConversationControlsProps) {
    return (
        <section class="conversation" aria-label="Conversation controls">
            <button
                class="speaking-button"
                type="button"
                disabled={props.phase() !== "listening"}
                onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    props.beginSpeaking();
                }}
                onPointerUp={(event) => {
                    props.finishSpeaking();
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                        event.currentTarget.releasePointerCapture(event.pointerId);
                    }
                }}
                onPointerCancel={props.finishSpeaking}
                onLostPointerCapture={props.finishSpeaking}
            >
                {props.phase() === "speaking" ? "Release to translate" : "I am speaking"}
            </button>
            <p class="speaking-hint">Hold while you speak. Your translated audio plays after you release.</p>
            <p class="translation" aria-live="polite">
                {props.translation() || "Your companion’s translation will appear here."}
            </p>
        </section>
    );
}
