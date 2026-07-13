# Test Vox

A SolidJS PWA for live speech translation with Gemini Live Translate. The frontend is built with Vite; Bun hosts the production bundle and the authenticated endpoint that creates short-lived Gemini tokens.

## Development

```bash
just install
just start
```

`just start` runs the Vite development server. The production API is not provided by Vite, so start the Bun service separately when developing functionality that requests a Gemini token:

```bash
just build
just serve
```

## Production

Build the frontend and serve the generated `dist/` directory:

```bash
just build
just serve
```

The Bun server serves the Vite build and handles `POST /api/get-ephemeral-token`. It expects these environment variables:

- `BASIC_AUTH_USERNAME`
- `BASIC_AUTH_PASSWORD`
- `GEMINI_API_KEY`

Copy `.env.example` to `.env`, then provide strong Basic Auth credentials and a server-side Gemini API key. The long-lived Gemini key is never exposed to the browser.

## Project actions

```bash
just install  # install dependencies
just start    # run Vite's development server
just build    # create dist/
just serve    # host dist/ and the authenticated API with Bun
just check    # run Biome checks
```

## PWA and TWA assets

Files in `public/` are copied unchanged to `dist/` by Vite. This includes the web manifest, service worker, Android asset links, and icons required by the PWA/TWA integration.

For production, serve the application over HTTPS and keep `public/.well-known/assetlinks.json`, `public/manifest.json`, and the Android signing configuration aligned.
