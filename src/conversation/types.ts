export type ConversationPhase = "listening" | "speaking" | "playing" | "ending-play";

export const languageOptions = [
    ["en", "English"],
    ["ru", "Russian"],
    ["de", "German"],
    ["uk", "Ukrainian"],
    ["sr", "Serbian"],
] as const;
