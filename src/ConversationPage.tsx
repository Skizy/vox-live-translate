import { ConversationControls } from "./conversation/ConversationControls";
import { LanguageFields } from "./conversation/LanguageFields";
import { useConversation } from "./conversation/useConversation";
import Navigation from "./Navigation";

export default function ConversationPage() {
    const conversation = useConversation();

    return (
        <main class="app-shell">
            <Navigation />
            <section class="translator" aria-labelledby="app-title">
                <p class="eyebrow">Two-way live speech translation</p>
                <h1 id="app-title">Vox</h1>
                <p class="lede">
                    Choose both languages to translate your companion’s speech as text and your speech as audio.
                </p>

                <LanguageFields
                    myLanguageCode={conversation.myLanguageCode}
                    setMyLanguageCode={conversation.setMyLanguageCode}
                    companionLanguageCode={conversation.companionLanguageCode}
                    setCompanionLanguageCode={conversation.setCompanionLanguageCode}
                    disabled={() => conversation.isConversing() || conversation.isConnecting()}
                />

                <button
                    class="primary-button"
                    type="button"
                    disabled={conversation.isConnecting()}
                    onClick={() =>
                        conversation.isConversing()
                            ? conversation.stopConversation()
                            : void conversation.startConversation()
                    }
                >
                    {conversation.isConnecting()
                        ? "Connecting…"
                        : conversation.isConversing()
                          ? "Stop conversation"
                          : "Start conversation"}
                </button>

                {conversation.isConversing() && (
                    <ConversationControls
                        phase={conversation.phase}
                        translation={conversation.companionTranslation}
                        beginSpeaking={conversation.beginSpeaking}
                        finishSpeaking={conversation.finishSpeaking}
                    />
                )}

                <p class="status" role="status" aria-live="polite">
                    {conversation.status()}
                </p>
            </section>
        </main>
    );
}
