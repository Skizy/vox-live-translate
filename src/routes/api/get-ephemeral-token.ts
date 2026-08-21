import { GoogleGenAI } from "@google/genai";
import { createFileRoute } from "@tanstack/react-router";
import { requireSession } from "~/server/auth";
import { db } from "~/server/db";
import { issuedEphemeralTokens } from "~/server/db/schema";

const liveTranslateModel = "models/gemini-3.5-live-translate-preview";
const tokenLifetimeMilliseconds = 2 * 60 * 1000;

export const Route = createFileRoute("/api/get-ephemeral-token")({
    server: {
        handlers: {
            POST: async ({ request }) => {
                const session = await requireSession(request);
                if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
                const body = await request.json().catch(() => undefined);
                const targetLanguageCode =
                    typeof body?.targetLanguageCode === "string" ? body.targetLanguageCode.trim() : "";
                if (!targetLanguageCode)
                    return Response.json({ error: "targetLanguageCode is required" }, { status: 400 });
                const apiKey = process.env.GEMINI_API_KEY;
                if (!apiKey) return Response.json({ error: "GEMINI_API_KEY is not configured" }, { status: 500 });
                try {
                    const issuedAt = Date.now();
                    const expiresAt = issuedAt + tokenLifetimeMilliseconds;
                    const token = await new GoogleGenAI({ apiKey }).authTokens.create({
                        config: {
                            uses: 1,
                            expireTime: new Date(expiresAt).toISOString(),
                            newSessionExpireTime: new Date(Date.now() + 60_000).toISOString(),
                            liveConnectConstraints: {
                                model: liveTranslateModel,
                                config: { translationConfig: { targetLanguageCode, echoTargetLanguage: false } },
                            },
                            httpOptions: { apiVersion: "v1alpha" },
                            lockAdditionalFields: [],
                        },
                    });
                    if (!token.name) throw new Error("Gemini did not return an ephemeral token");
                    await db.insert(issuedEphemeralTokens).values({
                        token: token.name,
                        userId: session.userId,
                        targetLanguageCode,
                        issuedAt: new Date(issuedAt),
                        expiresAt: new Date(expiresAt),
                    });
                    return Response.json({ token: token.name }, { headers: { "Cache-Control": "no-store" } });
                } catch (error) {
                    console.error("Failed to create Gemini ephemeral token", error);
                    return Response.json({ error: "Failed to create Gemini ephemeral token" }, { status: 502 });
                }
            },
        },
    },
});
