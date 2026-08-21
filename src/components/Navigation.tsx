import { Link, useLocation } from "@tanstack/react-router";
import { Menu, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";

const navigationItems = [
    { to: "/conversation", label: "Conversation" },
    { to: "/speech-to-text", label: "Speech to text" },
    { to: "/speech-to-speech", label: "Speech to speech" },
    { to: "/recorder", label: "Recorder" },
] as const;

export default function Navigation() {
    const location = useLocation();

    const [displayName, setDisplayName] = useState<string>();
    const isHistoryPage = location.pathname.startsWith("/history");

    useEffect(() => {
        void fetch("/api/session")
            .then(async (response) => (response.ok ? ((await response.json()) as { name?: string }) : undefined))
            .then((session) => setDisplayName(session?.name));
    }, []);

    return (
        <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
            <Link to="/" className="text-lg font-semibold tracking-tight">
                Vox
            </Link>
            <nav className="hidden items-center gap-1 md:flex" aria-label="Translation modes">
                {navigationItems.map(({ to, label }) => (
                    <Link
                        key={to}
                        to={to}
                        className="rounded-2xl px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        activeProps={{ className: "bg-accent text-accent-foreground" }}
                    >
                        {label}
                    </Link>
                ))}
            </nav>
            <div className="flex items-center gap-2">
                {isHistoryPage ? (
                    <Link to="/conversation" className="text-sm text-muted-foreground hover:text-foreground md:hidden">
                        Back to translator
                    </Link>
                ) : (
                    <DropdownMenu>
                        <DropdownMenuTrigger
                            render={
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="md:hidden"
                                    aria-label="Choose translation mode"
                                />
                            }
                        >
                            <Menu />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                            <DropdownMenuGroup>
                                {navigationItems.map(({ to, label }) => (
                                    <DropdownMenuItem
                                        key={to}
                                        className={
                                            location.pathname === to ? "bg-accent text-accent-foreground" : undefined
                                        }
                                        render={<Link to={to} className="w-full" />}
                                    >
                                        {label}
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuGroup>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
                <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="Account menu" />}>
                        <UserRound />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuGroup>
                            <DropdownMenuLabel>{displayName ?? "Account"}</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <form action="/auth/logout" method="post">
                                <DropdownMenuItem render={<button className="w-full" type="submit" />}>
                                    Sign out
                                </DropdownMenuItem>
                            </form>
                        </DropdownMenuGroup>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </header>
    );
}
