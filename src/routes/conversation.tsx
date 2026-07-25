import Navigation from "~/components/Navigation";
import { ConversationControls } from "~/features/conversation/ConversationControls";
import { LanguageFields } from "~/features/conversation/LanguageFields";
import { type ConversationMode, conversationModeOptions, languageLabel } from "~/features/conversation/types";
import { useConversation } from "~/features/conversation/useConversation";

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
                <label class="field conversation-mode" for="conversation-mode-select">
                    <span>Conversation Mode</span>
                    <select
                        id="conversation-mode-select"
                        value={conversation.conversationMode()}
                        disabled={conversation.isConversing() || conversation.isConnecting()}
                        onInput={(event) =>
                            conversation.setConversationMode(event.currentTarget.value as ConversationMode)
                        }
                    >
                        {conversationModeOptions.map(([value, label]) => (
                            <option value={value}>{label}</option>
                        ))}
                    </select>
                </label>

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

                {conversation.isConversing() && conversation.detectedCompanionLanguage() && (
                    <p class="detected-language" aria-live="polite">
                        {languageLabel(conversation.detectedCompanionLanguage() ?? "")} (detected)
                    </p>
                )}

                {conversation.isConversing() && (
                    <ConversationControls
                        phase={conversation.phase}
                        translation={conversation.companionTranslation}
                        conversationMode={conversation.conversationMode}
                        isCompanionLanguageReady={conversation.isCompanionLanguageReady}
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
