// @refresh reload
import { createHandler, StartServer } from "@solidjs/start/server";

export default createHandler(() => (
    <StartServer
        document={({ assets, children, scripts }) => (
            <html lang="en">
                <head>
                    <meta charset="utf-8" />
                    <meta name="viewport" content="width=device-width, initial-scale=1" />
                    <meta name="theme-color" content="#2563eb" />
                    <meta
                        name="description"
                        content="A simple live speech translation PWA powered by Gemini Live Translate."
                    />
                    <link rel="manifest" href="/manifest.json" />
                    <link rel="icon" href="/icons/icon.svg" type="image/svg+xml" />
                    {assets}
                </head>
                <body>
                    <div id="app">{children}</div>
                    {scripts}
                </body>
            </html>
        )}
    />
));
