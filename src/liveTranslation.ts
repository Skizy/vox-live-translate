export const MODEL = "models/gemini-3.5-live-translate-preview";

export async function getEphemeralToken() {
    const response = await fetch("/api/get-ephemeral-token", { method: "POST" });

    if (!response.ok) {
        throw new Error("Could not create a Gemini Live token.");
    }

    const { token } = (await response.json()) as { token?: string };

    if (!token) {
        throw new Error("Token response did not include a token.");
    }

    return token;
}
