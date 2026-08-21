import { redirect } from "@tanstack/react-router";
import { createMiddleware, createStart } from "@tanstack/react-start";
import { getSession } from "~/server/auth";

const publicPaths = new Set([
    "/.well-known/assetlinks.json",
    "/auth-callback",
    "/auth/logout",
    "/favicon.ico",
    "/login",
    "/manifest.json",
    "/service-worker.js",
    "/api/auth-config",
]);

function isPublicPath(pathname: string) {
    return (
        publicPaths.has(pathname) ||
        pathname.startsWith("/assets/") ||
        pathname.startsWith("/@") ||
        pathname.startsWith("/icons/")
    );
}

const authentication = createMiddleware().server(async ({ next, request }) => {
    const url = new URL(request.url);
    if (isPublicPath(url.pathname) || (await getSession(request))) return next();
    if (url.pathname.startsWith("/api/")) return Response.json({ error: "Authentication required" }, { status: 401 });
    throw redirect({ href: `/login?next=${encodeURIComponent(`${url.pathname}${url.search}`)}` });
});

export const startInstance = createStart(() => ({ requestMiddleware: [authentication] }));
