import { getCookie } from "@solidjs/start/http";
import type { APIEvent } from "@solidjs/start/server";
import { createSession, verifyGoogleCredential } from "~/server/auth";

export async function POST(event: APIEvent) {
    if (!process.env.GOOGLE_CLIENT_ID) {
        return new Response("Google authentication is not configured", { status: 500 });
    }

    const form = await event.request.formData();
    const csrfToken = form.get("g_csrf_token");
    const csrfCookie = getCookie(event.nativeEvent, "g_csrf_token");
    const credential = form.get("credential");

    if (typeof csrfToken !== "string" || csrfToken !== csrfCookie || typeof credential !== "string") {
        return new Response("Invalid Google Sign-In request", { status: 400 });
    }

    try {
        const user = await verifyGoogleCredential(credential);
        if (!user) {
            return new Response("Google credential could not be verified", { status: 401 });
        }

        createSession(event, user);
        return new Response(null, { status: 303, headers: { Location: "/" } });
    } catch (error) {
        console.error("Google authentication failed", error);
        return new Response("Google authentication failed", { status: 502 });
    }
}
