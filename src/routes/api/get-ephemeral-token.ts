import { GoogleGenAI } from "@google/genai";
import type { APIEvent } from "@solidjs/start/server";
import { requireSession } from "~/server/auth";

export async function POST(event: APIEvent) {
    if (!requireSession(event)) {
        return Response.json({ error: "Authentication required" }, { status: 401 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return Response.json({ error: "GEMINI_API_KEY is not configured" }, { status: 500 });
    }

    try {
        const client = new GoogleGenAI({ apiKey });
        const token = await client.authTokens.create({
            config: {
                uses: 1,
                expireTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
                newSessionExpireTime: new Date(Date.now() + 60 * 1000).toISOString(),
                httpOptions: { apiVersion: "v1alpha" },
            },
        });
        return Response.json({ token: token.name }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
        console.error("Failed to create Gemini ephemeral token", error);
        return Response.json({ error: "Failed to create Gemini ephemeral token" }, { status: 502 });
    }
}
