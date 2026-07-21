import { randomBytes } from "node:crypto";
import { deleteCookie, getCookie, setCookie } from "@solidjs/start/http";
import type { FetchEvent } from "@solidjs/start/server";

const sessionCookieName = "vox_session";
const sessionLifetimeSeconds = 60 * 60 * 24 * 7;

type User = {
    id: string;
    email: string;
    name: string;
    picture?: string;
};

type Session = {
    userId: string;
    expiresAt: number;
};

// This in-memory store deliberately acts as the application's mock database.
const mockDatabase = {
    users: new Map<string, User>(),
    sessions: new Map<string, Session>(),
};

export function getSession(event: Pick<FetchEvent, "nativeEvent">) {
    const sessionId = getCookie(event.nativeEvent, sessionCookieName);
    const session = typeof sessionId === "string" ? mockDatabase.sessions.get(sessionId) : undefined;

    if (!session || session.expiresAt <= Date.now()) {
        if (typeof sessionId === "string") {
            mockDatabase.sessions.delete(sessionId);
        }
        return undefined;
    }

    return session;
}

export function requireSession(event: Pick<FetchEvent, "nativeEvent">) {
    return getSession(event) ?? null;
}

export function getAuthenticatedUser(event: Pick<FetchEvent, "nativeEvent">) {
    const session = getSession(event);
    return session ? mockDatabase.users.get(session.userId) : undefined;
}

export function createSession(event: Pick<FetchEvent, "nativeEvent">, user: User) {
    mockDatabase.users.set(user.id, user);
    const sessionId = randomBytes(32).toString("base64url");
    mockDatabase.sessions.set(sessionId, {
        userId: user.id,
        expiresAt: Date.now() + sessionLifetimeSeconds * 1000,
    });

    setCookie(event.nativeEvent, sessionCookieName, sessionId, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: sessionLifetimeSeconds,
        secure: import.meta.env.PROD,
    });
}

export function destroySession(event: Pick<FetchEvent, "nativeEvent">) {
    const sessionId = getCookie(event.nativeEvent, sessionCookieName);
    if (typeof sessionId === "string") {
        mockDatabase.sessions.delete(sessionId);
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
