# Test Vox PWA

A small authenticated live speech translation PWA served by Bun and ready to act as the web target for a Trusted Web Activity.

## Project actions

```bash
just install
just start
```

The app is served from `public/` by `src/server.ts`.

## Authentication

Application functionality is protected with HTTP Basic Authentication.

Set credentials before starting the server:

```bash
cp .env.example .env
```

Then edit `.env`, replace `BASIC_AUTH_PASSWORD` with a strong value, and set `GEMINI_API_KEY` to the server-side Gemini API key used to mint short-lived Live API tokens.

The server returns `401 Authentication required` for protected routes when credentials are missing or invalid. If `BASIC_AUTH_USERNAME` or `BASIC_AUTH_PASSWORD` is not configured, protected routes return `500 Basic authentication is not configured` instead of allowing access.

The following TWA/PWA discovery assets remain public so Android and browsers can verify and install the app:

- `/.well-known/assetlinks.json`
- `/manifest.json`
- `/service-worker.js`
- `/icons/*`

## Live translation

The browser never receives the long-lived Gemini API key. When the user presses the listen button, the authenticated client calls `POST /api/get-ephemeral-token`. The Bun server exchanges `GEMINI_API_KEY` for a short-lived token, then the browser uses that token to open a native WebSocket connection to `models/gemini-3.5-live-translate-preview`.

The client captures microphone audio, converts it to 16kHz mono 16-bit PCM chunks, streams it to Gemini, and plays returned 24kHz mono 16-bit PCM audio. The user can choose English (`en`), Russian (`ru`), German (`de`), Ukrainian (`uk`), or Serbian (`sr`) before starting a session.

## TWA web-side files

- `public/manifest.json` provides the installable PWA manifest.
- `public/service-worker.js` provides a valid fetch handler while avoiding caches for protected app functionality.
- `public/icons/icon-192.png` and `public/icons/icon-512.png` provide app icons, including a 512×512 maskable icon.
- `public/.well-known/assetlinks.json` links the domain to Android package `me.mestick.vox`.

## Production checklist

- Serve the app over HTTPS in production.
- Ensure `https://your-domain/.well-known/assetlinks.json` is publicly reachable with `Content-Type: application/json`.
- Keep the package name and SHA-256 fingerprint in `assetlinks.json` aligned with the Android app signing certificate.
- Keep `public/manifest.json` up to date with the production name, theme, start URL, scope, and icons.
- Configure strong `BASIC_AUTH_USERNAME` and `BASIC_AUTH_PASSWORD` values in the production environment.
- Configure `GEMINI_API_KEY` only on the server; never expose it in browser code.
- Run Lighthouse against the production domain when it is ready.
