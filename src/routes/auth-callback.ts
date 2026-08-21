import { createFileRoute } from "@tanstack/react-router";
import { createSession, getRequestCookie, verifyGoogleCredential } from "~/server/auth";

export const Route = createFileRoute("/auth-callback")({
    server: {
        handlers: {
            POST: async ({ request }) => {
                if (!process.env.GOOGLE_CLIENT_ID)
                    return new Response("Google authentication is not configured", { status: 500 });
                const form = await request.formData();
                const csrfToken = form.get("g_csrf_token");
                const credential = form.get("credential");
                if (
                    typeof csrfToken !== "string" ||
                    csrfToken !== getRequestCookie(request, "g_csrf_token") ||
                    typeof credential !== "string"
                )
                    return new Response("Invalid Google Sign-In request", { status: 400 });
                try {
                    const user = await verifyGoogleCredential(credential);
                    if (!user) return new Response("Google credential could not be verified", { status: 401 });
                    return new Response(null, {
                        status: 303,
                        headers: { Location: "/", "Set-Cookie": await createSession(user) },
                    });
                } catch (error) {
                    console.error("Google authentication failed", error);
                    return new Response("Google authentication failed", { status: 502 });
                }
            },
        },
    },
});
