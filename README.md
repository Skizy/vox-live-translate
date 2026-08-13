# Vox SolidStart

A Solid PWA for live speech translation with Gemini Live Translate.

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

Vox is a SolidStart progressive web app. SolidStart provides file-based UI and HTTP routes; its Nitro output runs as the Node-compatible server in production. The server owns long-lived credentials and account state, while the browser owns microphone capture, Gemini Live connections, audio playback, and local transcript history.

```mermaid
flowchart TD
    Browser[Browser PWA]
    SolidStart[SolidStart and Nitro server]
    Google[Google Identity Services]
    Gemini[Gemini Live Translate]
    Postgres[(PostgreSQL)]

    Browser -->|Sign-in credential| SolidStart
    SolidStart -->|Verify ID token| Google
    SolidStart -->|Users, sessions, issued tokens| Postgres
    Browser -->|Authenticated request for short-lived token| SolidStart
    SolidStart -->|Create constrained ephemeral token| Gemini
    Browser -->|PCM audio and live responses using ephemeral token| Gemini
```

### Application layers

| Area                           | Location                                                                                          | Responsibilities                                                                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application shell and routing  | `src/app.tsx`, `src/routes/`, `src/middleware.ts`                                                 | Registers the service worker, renders SolidStart file routes, and enforces authentication before protected pages and API routes execute.                                        |
| Translation experiences        | `src/routes/speech-to-text.tsx`, `src/routes/speech-to-speech.tsx`, `src/routes/conversation.tsx` | Own page-level state, acquire the microphone, create Gemini sessions, render translations, and release browser resources when a mode stops or unmounts.                         |
| Shared live-translation client | `src/lib/liveTranslation.ts`                                                                      | Requests an ephemeral token from the server and opens a constrained Gemini Live connection in the browser.                                                                      |
| Audio pipeline                 | `src/features/audio/`                                                                             | Captures mono microphone audio through an `AudioWorklet`, converts float samples to 16-bit PCM, base64-encodes PCM for Gemini, and decodes returned PCM for Web Audio playback. |
| Conversation domain            | `src/features/conversation/`                                                                      | Coordinates two translation streams, routes microphone data according to the active speaker, queues translated audio, and records local transcripts.                            |
| Authentication and persistence | `src/server/auth.ts`, `src/server/db/`                                                            | Verifies Google credentials, creates and destroys sessions, and accesses PostgreSQL through Drizzle ORM.                                                                        |
| PWA/static assets              | `public/`                                                                                         | Provides the manifest, service worker, icons, and Android Digital Asset Links document.                                                                                         |

### Routes and access control

`src/routes/` is the route contract. Page files provide the translation and history screens; route handlers implement authentication and API endpoints.

| Endpoint or route                                                          | Purpose                                                                                                | Access                                            |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| `/login`                                                                   | Loads Google Identity Services with the configured OAuth client ID.                                    | Public                                            |
| `POST /auth-callback`                                                      | Checks Google's CSRF token, verifies the Google ID token, upserts the user, and creates a Vox session. | Public callback                                   |
| `POST /auth/logout`                                                        | Deletes the current server-side session and clears its cookie.                                         | Public endpoint; safely handles an absent session |
| `GET /api/auth-config`                                                     | Returns the public Google OAuth client ID used by the login page.                                      | Public                                            |
| `GET /api/session`                                                         | Returns the authenticated user's display name.                                                         | Authenticated                                     |
| `POST /api/get-ephemeral-token`                                            | Mints a one-use, constrained Gemini Live token for a requested target language.                        | Authenticated                                     |
| `/`, `/speech-to-text`, `/speech-to-speech`, `/conversation`, `/history/*` | Translation and transcript UI.                                                                         | Authenticated                                     |

The request middleware permits only login/callback, PWA/static resources, and the auth configuration endpoint without a session. Unauthenticated API calls receive `401`; unauthenticated page requests redirect to `/login` with the original destination in `next`.

### Authentication and trust boundaries

Google Identity Services uses redirect UX and posts the credential to `POST /auth-callback`. The server validates the Google token's audience against `GOOGLE_CLIENT_ID`, requires a verified email, and then creates a random 32-byte session token. The browser receives that token only as the `vox_session` HTTP-only, `SameSite=Lax` cookie; PostgreSQL stores a SHA-256 hash, user ID, and expiry rather than the raw token. Sessions expire after seven days.

`GEMINI_API_KEY` never reaches the browser. After the browser presents a valid Vox session, `POST /api/get-ephemeral-token` uses the server-side API key to mint a Gemini token that is limited to one use, expires after two minutes, constrains new sessions to the Live Translate model and requested target language, and is recorded with its issuing user in PostgreSQL. The browser uses that ephemeral token to connect directly to Gemini, so real-time audio does not proxy through the Vox server.

### Live translation data flow

```mermaid
sequenceDiagram
    participant User
    participant Browser
    participant Vox as Vox server
    participant Gemini

    User->>Browser: Start a translation mode and grant microphone access
    Browser->>Vox: POST /api/get-ephemeral-token
    Vox->>Gemini: Create constrained one-use token
    Gemini-->>Vox: Ephemeral token
    Vox-->>Browser: Token with no-store response
    Browser->>Gemini: Open Live Translate session
    Browser->>Browser: Capture mono audio with AudioWorklet and encode PCM
    Browser->>Gemini: Stream PCM audio
    Gemini-->>Browser: Incremental text or 24 kHz PCM translation
    Browser->>Browser: Render text or schedule decoded PCM playback
```

Speech-to-text requests text responses and appends incremental output transcription. Speech-to-speech requests audio responses and schedules each returned PCM chunk after the previously scheduled chunk to avoid gaps. Both modes refresh their Live session roughly every 110 seconds, before the ephemeral token's two-minute lifetime, and ignore messages from superseded sessions.

Conversation mode normally opens two Live sessions: one translates the local speaker into the companion language and one translates the companion into the local language. A single microphone stream is routed to exactly one session at a time: it feeds the companion stream while listening, the local-speaker stream while the **I am speaking** control is held, and silence while translated playback completes. In automatic companion-language mode, the companion stream first identifies the incoming language; the app then opens the local-speaker stream using that detected language. Conversation audio is queued during push-to-talk and played after release, preventing the microphone from receiving its own translated output.

### Stored data

| Store                                               | Contents                                                                                  | Lifetime and scope                                                                                                          |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL `users`                                  | Google subject ID, email, name, picture, and timestamps.                                  | Server-side account record.                                                                                                 |
| PostgreSQL `sessions`                               | Hashed session token, associated user, creation time, and expiry.                         | Server-side; expires after seven days or is deleted at logout.                                                              |
| PostgreSQL `issued_ephemeral_tokens`                | Gemini ephemeral token identifier, issuing user, target language, issue time, and expiry. | Server-side issuance record; tokens themselves are short-lived.                                                             |
| Browser `localStorage` (`vox.conversation-history`) | Conversation timestamp, selected languages, original transcriptions, and translations.    | Per browser/device only; not associated with or synchronized to the signed-in account. Clearing browser storage removes it. |

### Production topology

The generated Nitro server runs in the `app` container. Compose starts PostgreSQL privately in the `db` container, runs Drizzle migrations once through `migrate` after the database health check succeeds, and starts `app` only after migration completes. The app exposes `APP_PORT` (default `5080`) on `127.0.0.1`, allowing an external Nginx instance to terminate TLS and proxy requests without directly exposing the container port. PostgreSQL persists in the named `vox-live-translate-postgres-data` volume.

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
