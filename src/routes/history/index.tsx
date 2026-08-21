import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import Navigation from "~/components/Navigation";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { getConversationHistory } from "~/features/conversation/conversationHistory";

export const Route = createFileRoute("/history/")({ component: ConversationHistoryPage });
function formatConversationDate(timestamp: number) {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(timestamp);
}
function ConversationHistoryPage() {
    const [conversations, setConversations] = useState<ReturnType<typeof getConversationHistory>>([]);
    useEffect(() => setConversations([...getConversationHistory()].reverse()), []);
    return (
        <main className="min-h-svh">
            <Navigation />
            <section className="mx-auto w-full max-w-5xl space-y-6 p-6">
                <div>
                    <p className="text-sm text-muted-foreground">Saved conversations</p>
                    <h1 className="text-3xl font-semibold">History</h1>
                </div>
                {conversations.length ? (
                    <div className="grid gap-3">
                        {conversations.map((conversation) => (
                            <Link
                                key={conversation.timestamp}
                                to="/history/$timestamp"
                                params={{ timestamp: String(conversation.timestamp) }}
                            >
                                <Card className="transition-colors hover:bg-accent">
                                    <CardHeader>
                                        <CardTitle className="text-base">
                                            {formatConversationDate(conversation.timestamp)}
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="text-sm text-muted-foreground">
                                        {conversation.myLanguage.toUpperCase()} ↔{" "}
                                        {conversation.companionLanguage.toUpperCase()}
                                    </CardContent>
                                </Card>
                            </Link>
                        ))}
                    </div>
                ) : (
                    <p className="text-muted-foreground">Your completed conversations will appear here.</p>
                )}
            </section>
        </main>
    );
}
