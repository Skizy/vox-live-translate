import { createMemo, For, Show } from "solid-js";
import { getConversationHistory } from "./conversation/conversationHistory";
import Navigation from "./Navigation";

function formatConversationDate(timestamp: number) {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(timestamp);
}

export default function ConversationHistoryPage() {
    const conversations = createMemo(() => [...getConversationHistory()].reverse());

    return (
        <main class="app-shell">
            <Navigation />
            <section class="translator history-page" aria-labelledby="history-title">
                <p class="eyebrow">Saved conversations</p>
                <h1 id="history-title">History</h1>
                <Show
                    when={conversations().length > 0}
                    fallback={<p class="empty-history">Your completed conversations will appear here.</p>}
                >
                    <div class="history-list">
                        <For each={conversations()}>
                            {(conversation) => (
                                <a class="history-item" href={`/history/${conversation.timestamp}`}>
                                    <span class="history-item-date">
                                        {formatConversationDate(conversation.timestamp)}
                                    </span>
                                    <strong>
                                        {conversation.myLanguage.toUpperCase()} ↔{" "}
                                        {conversation.companionLanguage.toUpperCase()}
                                    </strong>
                                    <span>{conversation.conversation.length} messages</span>
                                </a>
                            )}
                        </For>
                    </div>
                </Show>
            </section>
        </main>
    );
}
