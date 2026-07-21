import { A } from "@solidjs/router";
import { createSignal, onMount, Show } from "solid-js";

const translationModes = [
    {
        href: "/conversation",
        title: "Conversation",
        description: "Translate a two-way conversation with spoken and written responses.",
    },
    {
        href: "/speech-to-text",
        title: "Speech to text",
        description: "Turn spoken language into readable text.",
    },
    {
        href: "/speech-to-speech",
        title: "Speech to speech",
        description: "Translate speech directly into spoken audio.",
    },
] as const;

export default function HomePage() {
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
        <main class="app-shell">
            <section class="translator home-page" aria-labelledby="app-title">
                <div class="account-actions home-account-actions">
                    <Show when={displayName()}>{(name) => <span class="user-display-name">{name()}</span>}</Show>
                    <form action="/auth/logout" method="post">
                        <button class="sign-out-button" type="submit">
                            Sign out
                        </button>
                    </form>
                </div>
                <p class="eyebrow">Live translation tools</p>
                <h1 id="app-title">Vox</h1>
                <p class="lede">Choose the translation experience that fits your conversation.</p>
                <div class="mode-links">
                    {translationModes.map(({ href, title, description }) => (
                        <A class="mode-link" href={href}>
                            <strong>{title}</strong>
                            <span>{description}</span>
                        </A>
                    ))}
                </div>
            </section>
        </main>
    );
}
