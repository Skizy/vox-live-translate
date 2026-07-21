import { createSignal, onCleanup, onMount, Show } from "solid-js";

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

export default function LoginPage() {
    let googleButton: HTMLDivElement | undefined;
    const [error, setError] = createSignal<string>();

    onMount(() => {
        let script: HTMLScriptElement | undefined;
        let cancelled = false;

        async function loadGoogleSignIn() {
            try {
                const response = await fetch("/api/auth-config");
                const configuration = (await response.json()) as { clientId?: string; error?: string };

                if (!response.ok || !configuration.clientId) {
                    throw new Error(configuration.error ?? "Google Sign-In is unavailable.");
                }

                const clientId = configuration.clientId;
                script = document.createElement("script");
                script.src = "https://accounts.google.com/gsi/client";
                script.async = true;
                script.onload = () => {
                    if (cancelled || !window.google || !googleButton) {
                        return;
                    }

                    window.google.accounts.id.initialize({
                        client_id: clientId,
                        login_uri: `${window.location.origin}/auth-callback`,
                        ux_mode: "redirect",
                    });
                    window.google.accounts.id.renderButton(googleButton, {
                        type: "standard",
                        theme: "filled_blue",
                        size: "large",
                        text: "signin_with",
                        shape: "pill",
                    });
                };
                script.onerror = () =>
                    setError("Google Sign-In could not be loaded. Check your connection and try again.");
                document.head.append(script);
            } catch (reason) {
                setError(reason instanceof Error ? reason.message : "Google Sign-In is unavailable.");
            }
        }

        void loadGoogleSignIn();

        onCleanup(() => {
            cancelled = true;
            script?.remove();
        });
    });

    return (
        <main class="login-shell">
            <section class="login-card" aria-labelledby="login-title">
                <p class="eyebrow">Vox Live Translate</p>
                <h1 id="login-title">Welcome</h1>
                <p class="lede">Sign in with your Google account to use the translation tools.</p>
                <Show when={error()} fallback={<div class="google-sign-in" ref={googleButton} />}>
                    <p class="auth-error" role="alert">
                        {error()}
                    </p>
                </Show>
            </section>
        </main>
    );
}
