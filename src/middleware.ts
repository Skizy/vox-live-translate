import { createMiddleware } from "@solidjs/start/middleware";
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
        pathname.startsWith("/_build/") ||
        pathname.startsWith("/@") ||
        pathname.startsWith("/icons/")
    );
}

export default createMiddleware({
    onRequest(event) {
        const url = new URL(event.request.url);
        if (isPublicPath(url.pathname) || getSession(event)) {
            return;
        }

        if (url.pathname.startsWith("/api/")) {
            return Response.json({ error: "Authentication required" }, { status: 401 });
        }

        const next = `${url.pathname}${url.search}`;
        return Response.redirect(new URL(`/login?next=${encodeURIComponent(next)}`, url), 302);
    },
});
