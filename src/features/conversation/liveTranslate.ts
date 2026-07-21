import { GoogleGenAI, type LiveServerMessage, type Modality, type Session } from "@google/genai";

const MODEL = "models/gemini-3.5-live-translate-preview";

export async function getEphemeralToken(targetLanguageCode: string) {
    console.info("[Vox] Requesting Gemini ephemeral token", { targetLanguageCode });
    const response = await fetch("/api/get-ephemeral-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetLanguageCode }),
    });
    console.info("[Vox] Gemini token response", response.status, response.statusText);

    if (!response.ok) {
        console.warn("[Vox] Token request failed", { status: response.status, statusText: response.statusText });
        throw new Error("Could not create a Gemini Live token.");
    }

    const { token } = (await response.json()) as { token?: string };
    if (!token) {
        console.warn("[Vox] Token response did not contain a token");
        throw new Error("Token response did not include a token.");
    }

    return token;
}

type ConnectLiveTranslateOptions = {
    token: string;
    targetLanguageCode: string;
    responseModalities: Modality[];
    onMessage: (message: LiveServerMessage) => void;
    isCurrent: () => boolean;
    onUnexpectedClose: (message: string) => void;
};

export function connectLiveTranslate({
    token,
    targetLanguageCode,
    responseModalities,
    onMessage,
    isCurrent,
    onUnexpectedClose,
}: ConnectLiveTranslateOptions): Promise<Session> {
    console.info("[Vox] Opening Gemini session", { targetLanguageCode, responseModalities });
    const ai = new GoogleGenAI({ apiKey: token });

    return ai.live.connect({
        model: MODEL,
        config: {
            responseModalities,
            translationConfig: { targetLanguageCode, echoTargetLanguage: false },
        },
        callbacks: {
            onopen: () => {
                console.info("[Vox] Gemini session opened", { targetLanguageCode, responseModalities });
            },
            onmessage: (message) => {
                if (!isCurrent()) {
                    console.info("[Vox] Ignoring message from a stale Gemini session", { targetLanguageCode });
                    return;
                }

                console.debug(`[Vox] Gemini message (${targetLanguageCode})`, message);
                onMessage(message);
            },
            onerror: (event) => console.error("[Vox] Gemini Live session error", { targetLanguageCode, event }),
            onclose: (event) => {
                const reason = event.reason ? `: ${event.reason}` : "";
                const message = `Translation connection closed (${event.code}${reason}).`;
                console.warn("[Vox] Gemini session closed", { targetLanguageCode, event });

                if (!isCurrent()) {
                    console.info("[Vox] Ignoring close from a stale Gemini session", { targetLanguageCode });
                    return;
                }

                onUnexpectedClose(message);
            },
        },
    });
}
