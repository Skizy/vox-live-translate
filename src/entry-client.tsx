// @refresh reload
import { mount, StartClient } from "@solidjs/start/client";

const root = document.getElementById("app");

if (!root) {
    throw new Error("Application root is missing.");
}

mount(() => <StartClient />, root);
