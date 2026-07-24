export type ConversationPhase = "listening" | "speaking" | "playing" | "ending-play";

export const languageOptions = [
    ["en", "English"],
    ["ru", "Russian"],
    ["de", "German"],
    ["uk", "Ukrainian"],
    ["sr", "Serbian"],
] as const;

export const autoLanguageCode = "auto";

export function languageLabel(languageCode: string) {
    const configuredLanguage = languageOptions.find(([code]) => code === languageCode);
    if (configuredLanguage) return configuredLanguage[1];

    try {
        return new Intl.DisplayNames(["en"], { type: "language" }).of(languageCode) ?? languageCode;
    } catch {
        return languageCode;
    }
}
