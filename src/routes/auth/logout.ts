import type { APIEvent } from "@solidjs/start/server";
import { destroySession } from "~/server/auth";

export function POST(event: APIEvent) {
    destroySession(event);
    return new Response(null, { status: 303, headers: { Location: "/login" } });
}
