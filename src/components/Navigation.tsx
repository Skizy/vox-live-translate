import { A, useLocation, useNavigate } from "@solidjs/router";
import { createMemo, createSignal, onMount, Show } from "solid-js";

const navigationItems = [
    { to: "/conversation", label: "Conversation" },
    { to: "/speech-to-text", label: "Speech to text" },
    { to: "/speech-to-speech", label: "Speech to speech" },
    { to: "/recorder", label: "Recorder" },
] as const;

export default function Navigation() {
    const location = useLocation();
    const navigate = useNavigate();
    const isActive = (path: string) => createMemo(() => location.pathname === path);
    const isHistoryPage = createMemo(() => location.pathname.startsWith("/history"));
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
            <Show
                when={isHistoryPage()}
                fallback={
                    <label class="mobile-mode-menu">
                        <span class="visually-hidden">Translation mode</span>
                        <select
                            aria-label="Translation mode"
                            value={location.pathname}
                            onChange={(event) => void navigate(event.currentTarget.value)}
                        >
                            {navigationItems.map(({ to, label }) => (
                                <option value={to}>{label}</option>
                            ))}
                        </select>
                    </label>
                }
            >
                <A class="mobile-history-back-link" href="/conversation">
                    Back to translator
                </A>
            </Show>
            <details class="account-menu">
                <summary class="avatar-button" aria-label="Account menu">
                    <svg aria-hidden="true" viewBox="0 0 24 24">
                        <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4.42 0-8 2.01-8 4.5V20h16v-1.5c0-2.49-3.58-4.5-8-4.5Z" />
                    </svg>
                </summary>
                <div class="account-menu-content">
                    <Show when={displayName()}>{(name) => <span class="user-display-name">{name()}</span>}</Show>
                    <form action="/auth/logout" method="post">
                        <button class="sign-out-button" type="submit">
                            Sign out
                        </button>
                    </form>
                </div>
            </details>
        </nav>
    );
}
