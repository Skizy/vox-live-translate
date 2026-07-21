import type { APIEvent } from "@solidjs/start/server";
import { destroySession } from "~/server/auth";

export async function POST(event: APIEvent) {
    await destroySession(event);
    return new Response(null, { status: 303, headers: { Location: "/login" } });
}
