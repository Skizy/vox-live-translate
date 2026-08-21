import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";

type GoogleIdentity = {
    accounts: {
        id: {
            initialize: (configuration: { client_id: string; login_uri: string; ux_mode: "redirect" }) => void;
            renderButton: (parent: HTMLElement, options: Record<string, string | number>) => void;
        };
    };
};
declare global {
    interface Window {
        google?: GoogleIdentity;
    }
}

export const Route = createFileRoute("/login")({ component: LoginPage });

function LoginPage() {
    const button = useRef<HTMLDivElement>(null);
    const [error, setError] = useState<string>();
    useEffect(() => {
        let script: HTMLScriptElement | undefined;
        let cancelled = false;
        async function loadGoogleSignIn() {
            try {
                const response = await fetch("/api/auth-config");
                const configuration = (await response.json()) as { clientId?: string; error?: string };
                if (!response.ok || !configuration.clientId)
                    throw new Error(configuration.error ?? "Google Sign-In is unavailable.");
                const clientId = configuration.clientId;
                script = document.createElement("script");
                script.src = "https://accounts.google.com/gsi/client";
                script.async = true;
                script.onload = () => {
                    if (!cancelled && window.google && button.current) {
                        window.google.accounts.id.initialize({
                            client_id: clientId,
                            login_uri: `${window.location.origin}/auth-callback`,
                            ux_mode: "redirect",
                        });
                        window.google.accounts.id.renderButton(button.current, {
                            type: "standard",
                            theme: "filled_blue",
                            size: "large",
                            text: "signin_with",
                            shape: "pill",
                        });
                    }
                };
                script.onerror = () =>
                    setError("Google Sign-In could not be loaded. Check your connection and try again.");
                document.head.append(script);
            } catch (reason) {
                setError(reason instanceof Error ? reason.message : "Google Sign-In is unavailable.");
            }
        }
        void loadGoogleSignIn();
        return () => {
            cancelled = true;
            script?.remove();
        };
    }, []);
    return (
        <main className="grid min-h-svh place-items-center p-6">
            <Card className="w-full max-w-md">
                <CardHeader>
                    <p className="text-sm font-medium text-muted-foreground">Vox Live Translate</p>
                    <CardTitle className="text-3xl">Welcome</CardTitle>
                    <CardDescription>Sign in with your Google account to use the translation tools.</CardDescription>
                </CardHeader>
                <CardContent>
                    {error ? (
                        <p className="text-sm text-destructive" role="alert">
                            {error}
                        </p>
                    ) : (
                        <div ref={button} className="min-h-11" />
                    )}
                </CardContent>
            </Card>
        </main>
    );
}
