import { A, useParams } from "@solidjs/router";
import { createSignal, For, onMount, Show } from "solid-js";
import Navigation from "~/components/Navigation";
import { type ConversationMessage, getConversationHistory } from "~/features/conversation/conversationHistory";

function getMessageText(message: ConversationMessage) {
    return message.side === "me"
        ? { primary: message.original, secondary: message.translation }
        : { primary: message.translation, secondary: message.original };
}

export default function ConversationHistoryDetailPage() {
    const params = useParams<{ timestamp: string }>();
    const [conversation, setConversation] = createSignal<ReturnType<typeof getConversationHistory>[number]>();

    onMount(() => {
        const timestamp = Number(params.timestamp);
        if (Number.isSafeInteger(timestamp)) {
            setConversation(
                getConversationHistory().find((savedConversation) => savedConversation.timestamp === timestamp),
            );
        }
    });

    return (
        <main class="app-shell">
            <Navigation />
            <section class="translator conversation-history-detail" aria-labelledby="conversation-title">
                <A class="back-link" href="/history">
                    ← All conversations
                </A>
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
