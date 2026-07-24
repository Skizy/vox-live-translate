# Vox SolidStart

A SolidStart v2 refactor of Vox, a Solid PWA for live speech translation with Gemini Live Translate.

## Features

- **Live speech-to-text translation** — speak into the microphone and read the continuously updated translation.
- **Live speech-to-speech translation** — speak naturally and hear the translated audio as it arrives.
- **Two-way conversation mode** — choose your language and your companion's language; read your companion's translated speech and hold **I am speaking** to send your speech for translated audio playback.
- **Supported target languages** — English, Russian, German, Ukrainian, and Serbian.
- **Conversation history** — browse previous conversation transcripts, including their language pair, timestamp, speakers, original text, and translations.
- **Google sign-in and secure sessions** — all app routes require an authenticated Google account; sessions are stored server-side and delivered in HTTP-only cookies.
- **PWA assets** — includes a web app manifest, service worker, icons, and Android asset links.

### How translation modes work

| Mode             | Input                                                    | Result                                                   |
| ---------------- | -------------------------------------------------------- | -------------------------------------------------------- |
| Speech to text   | Microphone                                               | Live translated text                                     |
| Speech to speech | Microphone                                               | Streamed translated audio                                |
| Conversation     | Companion's microphone audio or your push-to-talk speech | Companion translation as text; your translation as audio |

Conversation history is stored only in the browser's `localStorage`. It is not synced to the signed-in account, so clearing browser storage removes the locally saved entries.

## Requirements

- A Google OAuth web client ID for sign-in.
- A Gemini API key capable of creating Live Translate sessions.
- PostgreSQL for users, sessions, and issued translation tokens.
- A modern browser with microphone access, `AudioContext`, and `AudioWorklet` support. Microphone access normally requires HTTPS (or `localhost` during development).

## Architecture

- `src/routes/` uses SolidStart's idiomatic file-based router for UI and API routes.
- `src/features/`, `src/components/`, and `src/lib/` contain browser-side translation features.
- `src/server/auth.ts` persists Google users and sessions through the Drizzle ORM PostgreSQL layer in `src/server/db/`.
- `public/` contains the PWA manifest, service worker, Android asset links, and icons.

The Google Identity Services client uses redirect UX and posts to `POST /auth-callback`. SolidStart route handlers provide `/api/auth-config`, `/api/get-ephemeral-token`, and `POST /auth/logout`.

## Setup

Create `.env` with:

```env
GOOGLE_CLIENT_ID=123456789012-abcdefghijklmnopqrstuvwxyz.apps.googleusercontent.com
GEMINI_API_KEY=your-server-side-key
DATABASE_URL=postgresql://vox:development@localhost:5432/vox
```

`GOOGLE_CLIENT_ID` must be the complete OAuth web-client ID, including `.apps.googleusercontent.com`. Use `just db-migrate` to apply Drizzle migrations to the database configured by `DATABASE_URL` before running the app locally.

## Commands

```sh
just install
just dev
just build
just start
just typecheck
just db-generate
just db-migrate
just deploy
```

The generated production server is a Nitro Node-compatible application and is launched with Bun by `just start`.

## Deployment

`just deploy` builds the app locally, compresses `.output`, `Dockerfile`, and `compose.yaml` into a tarball, uploads it over SCP, and starts the `vox-live-translate` Compose stack on `cont` at `~/deploy/vox-live-translate`. The remote server must have Docker with the Compose plugin, `tar`, and OpenSSL installed. The app is configured with `--restart unless-stopped`, publishes the selected port (default `5080`) only on `127.0.0.1` for Nginx to proxy, and runs alongside a private PostgreSQL 17 container.

PostgreSQL data persists in the `vox-live-translate-postgres-data` Docker volume. On the first deployment, a random database credential is stored in `~/deploy/vox-live-translate/database.env` with owner-only permissions; it remains separate from the application `.env`. The one-shot `migrate` Compose service applies Drizzle migrations before the app starts. If a local `.env` exists, deployment uploads it to the remote deployment directory. Otherwise, an existing remote `.env` is retained; deployment stops with a clear error if neither exists. Inspect services with `ssh cont 'docker compose -p vox-live-translate ps'`, the app with `ssh cont 'docker logs --tail 100 vox-live-translate'`, migrations with `ssh cont 'docker logs vox-live-translate-migrate'`, or Postgres with `ssh cont 'docker logs --tail 100 vox-live-translate-db'`. Override the destination or port when needed:

```sh
DEPLOY_HOST=cont DEPLOY_DIR=~/deploy/vox-live-translate PORT=3000 just deploy
```
