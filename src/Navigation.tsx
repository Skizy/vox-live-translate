const navigationItems = [
    { href: "/conversation", label: "Conversation" },
    { href: "/history", label: "History" },
    { href: "/speech-to-text", label: "Speech to text" },
    { href: "/speech-to-speech", label: "Speech to speech" },
] as const;

export default function Navigation() {
    const pathname = window.location.pathname;

    return (
        <nav class="page-navigation" aria-label="Translation modes">
            <a class="brand-link" href="/">
                Vox
            </a>
            <div class="navigation-links">
                {navigationItems.map(({ href, label }) => (
                    <a
                        classList={{ "navigation-link": true, active: pathname === href }}
                        href={href}
                        aria-current={pathname === href ? "page" : undefined}
                    >
                        {label}
                    </a>
                ))}
            </div>
        </nav>
    );
}
