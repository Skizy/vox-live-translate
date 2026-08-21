import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";

const translationModes = [
    {
        to: "/conversation",
        title: "Conversation",
        description: "Translate a two-way conversation with spoken and written responses.",
    },
    { to: "/speech-to-text", title: "Speech to text", description: "Turn spoken language into readable text." },
    { to: "/speech-to-speech", title: "Speech to speech", description: "Translate speech directly into spoken audio." },
    { to: "/recorder", title: "Recorder", description: "Record a timestamped translation transcript on this device." },
] as const;

export const Route = createFileRoute("/")({ component: HomePage });

function HomePage() {
    return (
        <main className="mx-auto flex min-h-svh w-full max-w-4xl flex-col justify-center gap-8 p-6">
            <div className="space-y-3">
                <p className="text-sm font-medium text-muted-foreground">Live translation tools</p>
                <h1 className="text-4xl font-bold tracking-tight">Vox</h1>
                <p className="max-w-2xl text-muted-foreground">
                    Choose the translation experience that fits your conversation.
                </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
                {translationModes.map(({ to, title, description }) => (
                    <Link key={to} to={to} className="outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <Card className="h-full transition-colors hover:bg-accent">
                            <CardHeader>
                                <CardTitle>{title}</CardTitle>
                                <CardDescription>{description}</CardDescription>
                            </CardHeader>
                        </Card>
                    </Link>
                ))}
            </div>
        </main>
    );
}
