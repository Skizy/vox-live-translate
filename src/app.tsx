import { MetaProvider, Title } from "@solidjs/meta";
import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { onMount, type ParentProps, Suspense } from "solid-js";
import "./app.css";

function AppRoot(props: ParentProps) {
    onMount(() => {
        if (!("serviceWorker" in navigator)) {
            return;
        }

        void navigator.serviceWorker.register("/service-worker.js").catch((error: unknown) => {
            console.error("Service worker registration failed", error);
        });
    });

    return (
        <MetaProvider>
            <Title>Vox Live Translate</Title>
            <Suspense>{props.children}</Suspense>
        </MetaProvider>
    );
}

export default function App() {
    return (
        <Router root={(props) => <AppRoot>{props.children}</AppRoot>}>
            <FileRoutes />
        </Router>
    );
}
