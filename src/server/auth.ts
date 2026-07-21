import { createHash, randomBytes } from "node:crypto";
import { deleteCookie, getCookie, setCookie } from "@solidjs/start/http";
import type { FetchEvent } from "@solidjs/start/server";
import { and, eq, gt } from "drizzle-orm";
import { db } from "./db";
import { sessions, users } from "./db/schema";

const sessionCookieName = "vox_session";
const sessionLifetimeSeconds = 60 * 60 * 24 * 7;

type User = {
    id: string;
    email: string;
    name: string;
    picture?: string;
};

function hashSessionToken(token: string) {
    return createHash("sha256").update(token).digest("base64url");
}

export async function getSession(event: Pick<FetchEvent, "nativeEvent">) {
    const sessionId = getCookie(event.nativeEvent, sessionCookieName);
    if (typeof sessionId !== "string") {
        return undefined;
    }

    const [session] = await db
        .select({ userId: sessions.userId, expiresAt: sessions.expiresAt })
        .from(sessions)
        .where(and(eq(sessions.tokenHash, hashSessionToken(sessionId)), gt(sessions.expiresAt, new Date())))
        .limit(1);

    return session;
}

export async function requireSession(event: Pick<FetchEvent, "nativeEvent">) {
    return (await getSession(event)) ?? null;
}

export async function getAuthenticatedUser(event: Pick<FetchEvent, "nativeEvent">) {
    const session = await getSession(event);
    if (!session) {
        return undefined;
    }

    const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
    return user;
}

export async function createSession(event: Pick<FetchEvent, "nativeEvent">, user: User) {
    await db
        .insert(users)
        .values(user)
        .onConflictDoUpdate({
            target: users.id,
            set: {
                email: user.email,
                name: user.name,
                picture: user.picture,
                updatedAt: new Date(),
            },
        });

    const sessionId = randomBytes(32).toString("base64url");
    await db.insert(sessions).values({
        tokenHash: hashSessionToken(sessionId),
        userId: user.id,
        expiresAt: new Date(Date.now() + sessionLifetimeSeconds * 1000),
    });

    setCookie(event.nativeEvent, sessionCookieName, sessionId, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: sessionLifetimeSeconds,
        secure: import.meta.env.PROD,
    });
}

export async function destroySession(event: Pick<FetchEvent, "nativeEvent">) {
    const sessionId = getCookie(event.nativeEvent, sessionCookieName);
    if (typeof sessionId === "string") {
        await db.delete(sessions).where(eq(sessions.tokenHash, hashSessionToken(sessionId)));
    }
    deleteCookie(event.nativeEvent, sessionCookieName, { path: "/" });
}

export async function verifyGoogleCredential(credential: string) {
    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    if (!googleClientId) {
        return undefined;
    }

    const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
    if (!response.ok) {
        return undefined;
    }

    const token = (await response.json()) as {
        aud?: string;
        email?: string;
        email_verified?: string;
        name?: string;
        picture?: string;
        sub?: string;
    };

    if (token.aud !== googleClientId || !token.sub || !token.email || token.email_verified !== "true") {
        return undefined;
    }

    return {
        id: token.sub,
        email: token.email,
        name: token.name || token.email,
        picture: token.picture,
    } satisfies User;
}
