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
    return (
        <main class="app-shell">
            <section class="translator home-page" aria-labelledby="app-title">
                <p class="eyebrow">Live translation tools</p>
                <h1 id="app-title">Vox</h1>
                <p class="lede">Choose the translation experience that fits your conversation.</p>
                <div class="mode-links">
                    {translationModes.map(({ href, title, description }) => (
                        <a class="mode-link" href={href}>
                            <strong>{title}</strong>
                            <span>{description}</span>
                        </a>
                    ))}
                </div>
            </section>
        </main>
    );
}
