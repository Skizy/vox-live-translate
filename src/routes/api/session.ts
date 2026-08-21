import { createFileRoute } from "@tanstack/react-router";
import { getAuthenticatedUser } from "~/server/auth";

export const Route = createFileRoute("/api/session")({
    server: {
        handlers: {
            GET: async ({ request }) => {
                const user = await getAuthenticatedUser(request);
                if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });
                return Response.json({ name: user.name }, { headers: { "Cache-Control": "no-store" } });
            },
        },
    },
});
