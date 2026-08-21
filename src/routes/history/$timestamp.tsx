import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import Navigation from "~/components/Navigation";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import {
    type ConversationMessage,
    getConversationHistory,
    updateConversationLabel,
} from "~/features/conversation/conversationHistory";

export const Route = createFileRoute("/history/$timestamp")({ component: ConversationHistoryDetailPage });
function getMessageText(message: ConversationMessage) {
    return message.side === "me"
        ? { primary: message.original, secondary: message.translation }
        : { primary: message.translation, secondary: message.original };
}
function ConversationHistoryDetailPage() {
    const { timestamp } = Route.useParams();
    const [conversation, setConversation] = useState<ReturnType<typeof getConversationHistory>[number]>();
    const [label, setLabel] = useState("");
    useEffect(() => {
        const value = Number(timestamp);
        if (Number.isSafeInteger(value)) {
            const savedConversation = getConversationHistory().find((item) => item.timestamp === value);
            setConversation(savedConversation);
            setLabel(savedConversation?.label ?? "");
        }
    }, [timestamp]);
    return (
        <main className="min-h-svh">
            <Navigation />
            <section className="mx-auto w-full max-w-5xl space-y-6 p-6">
                <Link to="/history" className="text-sm text-muted-foreground hover:text-foreground">
                    ← All conversations
                </Link>
                {conversation ? (
                    <>
                        <div>
                            <p className="text-sm text-muted-foreground">
                                {conversation.myLanguage.toUpperCase()} ↔ {conversation.companionLanguage.toUpperCase()}
                            </p>
                            <h1 className="text-3xl font-semibold">{conversation.label || "Conversation"}</h1>
                        </div>
                        <form
                            className="flex flex-col gap-2 sm:flex-row"
                            onSubmit={(event) => {
                                event.preventDefault();
                                if (updateConversationLabel(conversation.timestamp, label)) {
                                    setConversation((current) =>
                                        current ? { ...current, label: label.trim() || undefined } : current,
                                    );
                                }
                            }}
                        >
                            <label className="sr-only" htmlFor="conversation-label">
                                Conversation label
                            </label>
                            <Input
                                id="conversation-label"
                                value={label}
                                onChange={(event) => setLabel(event.target.value)}
                                placeholder="Label this conversation (optional)"
                            />
                            <Button type="submit">Save label</Button>
                        </form>
                        <section aria-label="Conversation messages" className="space-y-3">
                            {conversation.conversation.map((message) => {
                                const text = getMessageText(message);
                                return (
                                    <Card
                                        key={`${message.side}-${message.original}-${message.translation}`}
                                        className={message.side === "me" ? "ml-auto max-w-xl" : "mr-auto max-w-xl"}
                                    >
                                        <CardHeader>
                                            <CardTitle className="text-sm">
                                                {message.side === "me" ? "You" : "Companion"}
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent className="space-y-2 text-sm">
                                            <p>{text.primary || "—"}</p>
                                            {text.secondary && (
                                                <p className="text-muted-foreground">{text.secondary}</p>
                                            )}
                                        </CardContent>
                                    </Card>
                                );
                            })}
                        </section>
                    </>
                ) : (
                    <>
                        <div>
                            <p className="text-sm text-muted-foreground">Saved conversation</p>
                            <h1 className="text-3xl font-semibold">Not found</h1>
                        </div>
                        <p className="text-muted-foreground">
                            This conversation is no longer available in local storage.
                        </p>
                    </>
                )}
            </section>
        </main>
    );
}
