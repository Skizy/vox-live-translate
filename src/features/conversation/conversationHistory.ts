export type ConversationMessage = {
    side: "me" | "companion";
    original: string;
    translation: string;
};

export type StoredConversation = {
    timestamp: number;
    myLanguage: string;
    companionLanguage: string;
    conversation: ConversationMessage[];
};

const STORAGE_KEY = "vox.conversation-history";

export function getConversationHistory(): StoredConversation[] {
    try {
        const value = window.localStorage.getItem(STORAGE_KEY);
        if (!value) return [];

        const history: unknown = JSON.parse(value);
        return Array.isArray(history) ? (history as StoredConversation[]) : [];
    } catch (error) {
        console.warn("[Vox] Could not read conversation history", error);
        return [];
    }
}

function writeHistory(history: StoredConversation[]) {
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch (error) {
        console.warn("[Vox] Could not save conversation history", error);
    }
}

export function createConversationHistory(myLanguage: string, companionLanguage: string) {
    const conversation: StoredConversation = {
        timestamp: Date.now(),
        myLanguage,
        companionLanguage,
        conversation: [],
    };
    const history = getConversationHistory();
    history.push(conversation);
    writeHistory(history);

    let activeMessage: ConversationMessage | undefined;

    function persist() {
        writeHistory(history);
    }

    return {
        addInput(side: ConversationMessage["side"], text: string) {
            if (!text) return;

            if (activeMessage?.side === side) {
                activeMessage.original += text;
            } else {
                activeMessage = { side, original: text, translation: "" };
                conversation.conversation.push(activeMessage);
            }
            persist();
        },
        addOutput(side: ConversationMessage["side"], text: string) {
            if (!text) return;

            if (!activeMessage || activeMessage.side !== side) {
                activeMessage = { side, original: "", translation: text };
                conversation.conversation.push(activeMessage);
            } else {
                activeMessage.translation += text;
            }
            persist();
        },
    };
}
