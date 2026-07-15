import { onMount } from "solid-js";
import ConversationHistoryDetailPage from "./ConversationHistoryDetailPage";
import ConversationHistoryPage from "./ConversationHistoryPage";
import ConversationPage from "./ConversationPage";
import HomePage from "./HomePage";
import SpeechToSpeechPage from "./SpeechToSpeechPage";
import SpeechToTextPage from "./SpeechToTextPage";

export default function App() {
    onMount(() => {
        if (!("serviceWorker" in navigator)) {
            console.warn("[Vox] Service workers are not supported by this browser");
            return;
        }

        void navigator.serviceWorker.register("/service-worker.js").catch((error: unknown) => {
            console.error("Service worker registration failed", error);
        });
    });

    switch (window.location.pathname) {
        case "/conversation":
            return <ConversationPage />;
        case "/history":
            return <ConversationHistoryPage />;
        case "/speech-to-text":
            return <SpeechToTextPage />;
        case "/speech-to-speech":
            return <SpeechToSpeechPage />;
        default:
            if (window.location.pathname.startsWith("/history/")) {
                return <ConversationHistoryDetailPage />;
            }
            return <HomePage />;
    }
}
