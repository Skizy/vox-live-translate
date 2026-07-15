import { createMemo, For, Show } from "solid-js";
import { type ConversationMessage, getConversationHistory } from "./conversation/conversationHistory";
import Navigation from "./Navigation";

function getTimestamp() {
    const pathParts = window.location.pathname.split("/");
    const timestamp = Number(pathParts[pathParts.length - 1]);
    return Number.isSafeInteger(timestamp) ? timestamp : undefined;
}

function getMessageText(message: ConversationMessage) {
    return message.side === "me"
        ? { primary: message.original, secondary: message.translation }
        : { primary: message.translation, secondary: message.original };
}

export default function ConversationHistoryDetailPage() {
    const conversation = createMemo(() =>
        getConversationHistory().find(({ timestamp }) => timestamp === getTimestamp()),
    );

    return (
        <main class="app-shell">
            <Navigation />
            <section class="translator conversation-history-detail" aria-labelledby="conversation-title">
                <a class="back-link" href="/history">
                    ← All conversations
                </a>
                <Show
                    when={conversation()}
                    fallback={
                        <>
                            <p class="eyebrow">Saved conversation</p>
                            <h1 id="conversation-title">Not found</h1>
                            <p class="empty-history">This conversation is no longer available in local storage.</p>
                        </>
                    }
                >
                    {(savedConversation) => (
                        <>
                            <p class="eyebrow">
                                {savedConversation().myLanguage.toUpperCase()} ↔{" "}
                                {savedConversation().companionLanguage.toUpperCase()}
                            </p>
                            <h1 id="conversation-title">Conversation</h1>
                            <section class="chat-messages" aria-label="Conversation messages">
                                <For each={savedConversation().conversation}>
                                    {(message) => {
                                        const text = getMessageText(message);
                                        return (
                                            <article classList={{ "chat-message": true, mine: message.side === "me" }}>
                                                <span class="chat-message-sender">
                                                    {message.side === "me" ? "You" : "Companion"}
                                                </span>
                                                <p>{text.primary || "—"}</p>
                                                <Show when={text.secondary}>
                                                    <p class="chat-message-translation">{text.secondary}</p>
                                                </Show>
                                            </article>
                                        );
                                    }}
                                </For>
                            </section>
                        </>
                    )}
                </Show>
            </section>
        </main>
    );
}
