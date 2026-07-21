import type { APIEvent } from "@solidjs/start/server";
import { getAuthenticatedUser } from "~/server/auth";

export async function GET(event: APIEvent) {
    const user = await getAuthenticatedUser(event);
    if (!user) {
        return Response.json({ error: "Authentication required" }, { status: 401 });
    }

    return Response.json({ name: user.name }, { headers: { "Cache-Control": "no-store" } });
}
