import { A, useLocation } from "@solidjs/router";
import { createMemo, createSignal, onMount, Show } from "solid-js";

const navigationItems = [
    { to: "/conversation", label: "Conversation" },
    { to: "/speech-to-text", label: "Speech to text" },
    { to: "/speech-to-speech", label: "Speech to speech" },
    { to: "/recorder", label: "Recorder" },
] as const;

export default function Navigation() {
    const location = useLocation();
    const isActive = (path: string) => createMemo(() => location.pathname === path);
    const [displayName, setDisplayName] = createSignal<string>();

    onMount(() => {
        void fetch("/api/session")
            .then(async (response) => {
                if (!response.ok) {
                    return undefined;
                }
                return (await response.json()) as { name?: string };
            })
            .then((session) => setDisplayName(session?.name));
    });

    return (
        <nav class="page-navigation" aria-label="Translation modes">
            <A class="brand-link" href="/">
                Vox
            </A>
            <div class="navigation-links">
                {navigationItems.map(({ to, label }) => (
                    <A
                        class="navigation-link"
                        activeClass="active"
                        href={to}
                        aria-current={isActive(to)() ? "page" : undefined}
                    >
                        {label}
                    </A>
                ))}
            </div>
            <A
                class="navigation-link utility-link"
                activeClass="active"
                href="/history"
                aria-current={isActive("/history")() ? "page" : undefined}
            >
                History
            </A>
            <div class="account-actions">
                <Show when={displayName()}>{(name) => <span class="user-display-name">{name()}</span>}</Show>
                <form action="/auth/logout" method="post">
                    <button class="sign-out-button" type="submit">
                        Sign out
                    </button>
                </form>
            </div>
        </nav>
    );
}
