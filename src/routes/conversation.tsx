import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import Navigation from "~/components/Navigation";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { ConversationControls } from "~/features/conversation/ConversationControls";
import { updateConversationLabel } from "~/features/conversation/conversationHistory";
import { LanguageFields } from "~/features/conversation/LanguageFields";
import { type ConversationMode, conversationModeOptions, languageLabel } from "~/features/conversation/types";
import { useConversation } from "~/features/conversation/useConversation";

export const Route = createFileRoute("/conversation")({ component: ConversationPage });

function ConversationPage() {
    const conversation = useConversation();
    const [conversationLabel, setConversationLabel] = useState("");
    const controlsDisabled = conversation.isConversing || conversation.isConnecting;

    function saveConversationLabel() {
        if (conversation.lastConversationTimestamp === undefined) return;
        updateConversationLabel(conversation.lastConversationTimestamp, conversationLabel);
    }

    return (
        <main className="min-h-svh bg-background">
            <Navigation />
            <section className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6" aria-labelledby="app-title">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <p className="text-sm font-medium text-muted-foreground">Two-way live speech translation</p>
                        <h1 id="app-title" className="text-3xl font-bold tracking-tight">
                            Vox
                        </h1>
                    </div>
                    <Link className="text-sm text-muted-foreground hover:text-foreground" to="/history">
                        History
                    </Link>
                </div>
                <p className="text-muted-foreground">
                    Choose both languages to translate your companion’s speech as text and your speech as audio.
                </p>

                <LanguageFields
                    myLanguageCode={conversation.myLanguageCode}
                    setMyLanguageCode={conversation.setMyLanguageCode}
                    companionLanguageCode={conversation.companionLanguageCode}
                    setCompanionLanguageCode={conversation.setCompanionLanguageCode}
                    disabled={controlsDisabled}
                />
                <label className="grid gap-2 text-sm font-medium" htmlFor="conversation-mode-select">
                    <span>Conversation Mode</span>
                    <Select
                        value={conversation.conversationMode}
                        disabled={controlsDisabled}
                        onValueChange={(value) => conversation.setConversationMode(value as ConversationMode)}
                    >
                        <SelectTrigger id="conversation-mode-select" className="w-full">
                            <SelectValue>
                                {(value) =>
                                    conversationModeOptions.find(([mode]) => mode === value)?.[1] ?? "Select a mode"
                                }
                            </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {conversationModeOptions.map(([value, label]) => (
                                    <SelectItem key={value} value={value}>
                                        {label}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </label>

                <Button
                    className="w-full sm:w-auto"
                    type="button"
                    disabled={conversation.isConnecting}
                    onClick={() =>
                        conversation.isConversing
                            ? conversation.stopConversation()
                            : void conversation.startConversation()
                    }
                >
                    {conversation.isConnecting
                        ? "Connecting…"
                        : conversation.isConversing
                          ? "Stop conversation"
                          : "Start conversation"}
                </Button>

                {conversation.isConversing && conversation.detectedCompanionLanguage && (
                    <p className="text-sm text-muted-foreground" aria-live="polite">
                        {languageLabel(conversation.detectedCompanionLanguage)} (detected)
                    </p>
                )}

                {conversation.isConversing && (
                    <ConversationControls
                        phase={conversation.phase}
                        translation={conversation.companionTranslation}
                        conversationMode={conversation.conversationMode}
                        isCompanionLanguageReady={conversation.isCompanionLanguageReady}
                        beginSpeaking={conversation.beginSpeaking}
                        finishSpeaking={conversation.finishSpeaking}
                    />
                )}

                <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
                    {conversation.status}
                </p>

                {conversation.lastConversationTimestamp !== undefined && (
                    <form
                        className="flex flex-col gap-2 sm:flex-row"
                        onSubmit={(event) => {
                            event.preventDefault();
                            saveConversationLabel();
                        }}
                    >
                        <label className="sr-only" htmlFor="conversation-label">
                            Conversation label
                        </label>
                        <Input
                            id="conversation-label"
                            value={conversationLabel}
                            onChange={(event) => setConversationLabel(event.target.value)}
                            placeholder="Label this conversation (optional)"
                        />
                        <Button type="submit">Save label</Button>
                    </form>
                )}
            </section>
        </main>
    );
}
