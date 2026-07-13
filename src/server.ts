import { timingSafeEqual } from "node:crypto";
import { GoogleGenAI } from "@google/genai";

const publicDir = new URL("../dist/", import.meta.url);
const authRealm = "Test Vox";
const authUsername = process.env.BASIC_AUTH_USERNAME;
const authPassword = process.env.BASIC_AUTH_PASSWORD;
const geminiApiKey = process.env.GEMINI_API_KEY;
const geminiClient = geminiApiKey ? new GoogleGenAI({ apiKey: geminiApiKey }) : undefined;

const publicPaths = new Set(["/.well-known/assetlinks.json", "/manifest.json", "/service-worker.js"]);

const mimeTypes: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
};

function contentType(pathname: string) {
    const extension = pathname.match(/\.[^.]+$/)?.[0] ?? "";
    return mimeTypes[extension] ?? "application/octet-stream";
}

function unauthorized() {
    return new Response("Authentication required", {
        status: 401,
        headers: {
            "Cache-Control": "no-store",
            "WWW-Authenticate": `Basic realm="${authRealm}", charset="UTF-8"`,
        },
    });
}

function serverMisconfigured() {
    return new Response("Basic authentication is not configured", {
        status: 500,
        headers: {
            "Cache-Control": "no-store",
            "Content-Type": "text/plain; charset=utf-8",
        },
    });
}

function safeCompare(left: string, right: string) {
    const leftBytes = new TextEncoder().encode(left);
    const rightBytes = new TextEncoder().encode(right);

    if (leftBytes.length !== rightBytes.length) {
        return false;
    }

    return timingSafeEqual(leftBytes, rightBytes);
}

function isPublicPath(pathname: string) {
    return publicPaths.has(pathname) || pathname.startsWith("/icons/");
}

function isAuthorized(request: Request) {
    if (!authUsername || !authPassword) {
        return false;
    }

    const authorization = request.headers.get("Authorization");

    if (!authorization?.startsWith("Basic ")) {
        return false;
    }

    const encodedCredentials = authorization.slice("Basic ".length).trim();
    let credentials: string;

    try {
        credentials = atob(encodedCredentials);
    } catch {
        return false;
    }

    const separator = credentials.indexOf(":");

    if (separator === -1) {
        return false;
    }

    const username = credentials.slice(0, separator);
    const password = credentials.slice(separator + 1);

    return safeCompare(username, authUsername) && safeCompare(password, authPassword);
}

function jsonResponse(body: unknown, init?: ResponseInit) {
    return new Response(JSON.stringify(body), {
        ...init,
        headers: {
            "Cache-Control": "no-store",
            "Content-Type": "application/json; charset=utf-8",
            ...init?.headers,
        },
    });
}

async function createEphemeralToken() {
    if (!geminiClient) {
        return jsonResponse({ error: "GEMINI_API_KEY is not configured" }, { status: 500 });
    }

    try {
        const token = await geminiClient.authTokens.create({
            config: {
                uses: 1,
                expireTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
                newSessionExpireTime: new Date(Date.now() + 60 * 1000).toISOString(),
                httpOptions: { apiVersion: "v1alpha" },
            },
        });

        return jsonResponse({ token: token.name });
    } catch (error) {
        console.error("Failed to create Gemini ephemeral token", error);
        return jsonResponse({ error: "Failed to create Gemini ephemeral token" }, { status: 502 });
    }
}

function logRequest(request: Request, response: Response) {
    const url = new URL(request.url);
    console.log(`[${new Date().toISOString()}] ${request.method} ${url.pathname}${url.search} -> ${response.status}`);
}

async function handleRequest(request: Request) {
    const url = new URL(request.url);

    if (!isPublicPath(url.pathname)) {
        if (!authUsername || !authPassword) {
            return serverMisconfigured();
        }

        if (!isAuthorized(request)) {
            return unauthorized();
        }
    }

    if (url.pathname === "/api/get-ephemeral-token") {
        if (request.method !== "POST") {
            return jsonResponse({ error: "Method not allowed" }, { status: 405, headers: { Allow: "POST" } });
        }

        return createEphemeralToken();
    }

    return serveStatic(url.pathname);
}

async function serveStatic(pathname: string) {
    const safePath = pathname === "/" ? "/index.html" : pathname;
    const filePath = new URL(`.${decodeURIComponent(safePath)}`, publicDir);

    if (!filePath.href.startsWith(publicDir.href)) {
        return new Response("Forbidden", { status: 403 });
    }

    const file = Bun.file(filePath);

    if (!(await file.exists())) {
        return new Response("Not found", { status: 404 });
    }

    return new Response(file, {
        headers: {
            "Cache-Control":
                safePath === "/service-worker.js"
                    ? "no-cache"
                    : isPublicPath(safePath)
                      ? "public, max-age=3600"
                      : "no-store",
            "Content-Type": contentType(safePath),
        },
    });
}

const port = Number(process.env.PORT ?? 5080);

Bun.serve({
    port,
    hostname: "127.0.0.1",
    async fetch(request) {
        const response = await handleRequest(request);
        logRequest(request, response);
        return response;
    },
});

console.log(`Vite production server running at http://localhost:${port}`);
console.log(
    authUsername && authPassword
        ? "Basic authentication is enabled."
        : "Basic authentication is not configured. Set BASIC_AUTH_USERNAME and BASIC_AUTH_PASSWORD.",
);
