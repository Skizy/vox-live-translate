import { GoogleGenAI, type LiveServerMessage, type Modality, type Session } from "@google/genai";
import { err, ok, ResultAsync } from "neverthrow";
import { match, P } from "ts-pattern";

const MODEL = "models/gemini-3.5-live-translate-preview";

function toError(error: unknown) {
    return error instanceof Error ? error : new Error("An unknown error occurred.");
}

function extractToken(payload: unknown) {
    return match(payload)
        .with({ token: P.string }, ({ token }) =>
            token ? ok(token) : err(new Error("Token response did not include a token.")),
        )
        .otherwise(() => err(new Error("Token response did not include a token.")));
}

export function getEphemeralToken(targetLanguageCode: string): ResultAsync<string, Error> {
    console.info("[Vox] Requesting Gemini ephemeral token", { targetLanguageCode });

    return ResultAsync.fromPromise(
        fetch("/api/get-ephemeral-token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ targetLanguageCode }),
        }),
        toError,
    )
        .andThen((response) => {
            console.info("[Vox] Gemini token response", response.status, response.statusText);
            if (!response.ok) {
                console.warn("[Vox] Token request failed", {
                    status: response.status,
                    statusText: response.statusText,
                });
                return err(new Error("Could not create a Gemini Live token."));
            }

            return ResultAsync.fromPromise(response.json(), toError).andThen(extractToken);
        })
        .mapErr((error) => {
            console.warn("[Vox] Could not request or parse a Gemini token", error);
            return error;
        });
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
