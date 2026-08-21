import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";
import "~/app.css";

export const Route = createRootRoute({
    head: () => ({
        meta: [
            { charSet: "utf-8" },
            { name: "viewport", content: "width=device-width, initial-scale=1" },
            { name: "theme-color", content: "#09090b" },
            { name: "description", content: "Live speech translation powered by Gemini Live Translate." },
            { title: "Vox Live Translate" },
        ],
        links: [
            { rel: "manifest", href: "/manifest.json" },
            { rel: "icon", href: "/icons/icon.svg", type: "image/svg+xml" },
        ],
    }),
    component: RootComponent,
});

function RootComponent() {
    useEffect(() => {
        if (!("serviceWorker" in navigator)) return;
        void navigator.serviceWorker
            .register("/service-worker.js")
            .catch((error: unknown) => console.error("Service worker registration failed", error));
    }, []);
    return (
        <RootDocument>
            <Outlet />
        </RootDocument>
    );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
    return (
        <html className="dark" lang="en">
            <head>
                <HeadContent />
            </head>
            <body>
                {children}
                <Scripts />
            </body>
        </html>
    );
}
