import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { db } from "./db";
import { sessions, users } from "./db/schema";

const sessionCookieName = "vox_session";
const sessionLifetimeSeconds = 60 * 60 * 24 * 7;

type User = { id: string; email: string; name: string; picture?: string };

function hashSessionToken(token: string) {
    return createHash("sha256").update(token).digest("base64url");
}

function getCookie(request: Request, name: string) {
    const cookie = request.headers.get("cookie") ?? "";
    return cookie
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${name}=`))
        ?.slice(name.length + 1);
}

function sessionCookie(value: string, maxAge = sessionLifetimeSeconds) {
    return `${sessionCookieName}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${import.meta.env.PROD ? "; Secure" : ""}`;
}

export async function getSession(request: Request) {
    const sessionId = getCookie(request, sessionCookieName);
    if (!sessionId) return undefined;
    const [session] = await db
        .select({ userId: sessions.userId, expiresAt: sessions.expiresAt })
        .from(sessions)
        .where(
            and(
                eq(sessions.tokenHash, hashSessionToken(decodeURIComponent(sessionId))),
                gt(sessions.expiresAt, new Date()),
            ),
        )
        .limit(1);
    return session;
}

export async function requireSession(request: Request) {
    return (await getSession(request)) ?? null;
}

export async function getAuthenticatedUser(request: Request) {
    const session = await getSession(request);
    if (!session) return undefined;
    const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
    return user;
}

export async function createSession(user: User) {
    await db
        .insert(users)
        .values(user)
        .onConflictDoUpdate({
            target: users.id,
            set: { email: user.email, name: user.name, picture: user.picture, updatedAt: new Date() },
        });
    const sessionId = randomBytes(32).toString("base64url");
    await db.insert(sessions).values({
        tokenHash: hashSessionToken(sessionId),
        userId: user.id,
        expiresAt: new Date(Date.now() + sessionLifetimeSeconds * 1000),
    });
    return sessionCookie(sessionId);
}

export async function destroySession(request: Request) {
    const sessionId = getCookie(request, sessionCookieName);
    if (sessionId)
        await db.delete(sessions).where(eq(sessions.tokenHash, hashSessionToken(decodeURIComponent(sessionId))));
    return sessionCookie("", 0);
}

export function getRequestCookie(request: Request, name: string) {
    return getCookie(request, name);
}

export async function verifyGoogleCredential(credential: string) {
    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    if (!googleClientId) return undefined;
    const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
    if (!response.ok) return undefined;
    const token = (await response.json()) as {
        aud?: string;
        email?: string;
        email_verified?: string;
        name?: string;
        picture?: string;
        sub?: string;
    };
    if (token.aud !== googleClientId || !token.sub || !token.email || token.email_verified !== "true") return undefined;
    return {
        id: token.sub,
        email: token.email,
        name: token.name || token.email,
        picture: token.picture,
    } satisfies User;
}
