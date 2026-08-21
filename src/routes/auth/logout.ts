import { createFileRoute } from "@tanstack/react-router";
import { destroySession } from "~/server/auth";

export const Route = createFileRoute("/auth/logout")({
    server: {
        handlers: {
            POST: async ({ request }) =>
                new Response(null, {
                    status: 303,
                    headers: { Location: "/login", "Set-Cookie": await destroySession(request) },
                }),
        },
    },
});
