# Vox SolidStart

A SolidStart v2 refactor of Vox, a Solid PWA for live speech translation with Gemini Live Translate.

## Architecture

- `src/routes/` uses SolidStart's idiomatic file-based router for UI and API routes.
- `src/features/`, `src/components/`, and `src/lib/` contain browser-side translation features.
- `src/server/auth.ts` implements the in-memory mock user/session database used by the Google Identity Services callback.
- `public/` contains the PWA manifest, service worker, Android asset links, and icons.

The Google Identity Services client uses redirect UX and posts to `POST /auth-callback`. SolidStart route handlers provide `/api/auth-config`, `/api/get-ephemeral-token`, and `POST /auth/logout`.

## Setup

Create `.env` with:

```env
GOOGLE_CLIENT_ID=123456789012-abcdefghijklmnopqrstuvwxyz.apps.googleusercontent.com
GEMINI_API_KEY=your-server-side-key
```

`GOOGLE_CLIENT_ID` must be the complete OAuth web-client ID, including `.apps.googleusercontent.com`. The mock database and sessions are volatile and reset whenever the server restarts.

## Commands

```sh
just install
just dev
just build
just start
just typecheck
just deploy
```

The generated production server is a Nitro Node-compatible application and is launched with Bun by `just start`.

## Deployment

`just deploy` builds the app locally, compresses `.output`, `Dockerfile`, and `compose.yaml` into a tarball, uploads it over SCP, and starts the `vox-live-translate` Compose stack on `cont` at `~/deploy/vox-live-translate`. The remote server must have Docker with the Compose plugin, `tar`, and OpenSSL installed. The app is configured with `--restart unless-stopped`, publishes the selected port (default `5080`) only on `127.0.0.1` for Nginx to proxy, and runs alongside a private PostgreSQL 17 container.

PostgreSQL data persists in the `vox-live-translate-postgres-data` Docker volume. On the first deployment, a random database credential is stored in `~/deploy/vox-live-translate/database.env` with owner-only permissions; it remains separate from the application `.env`. If a local `.env` exists, deployment uploads it to the remote deployment directory. Otherwise, an existing remote `.env` is retained; deployment stops with a clear error if neither exists. Inspect services with `ssh cont 'docker compose -p vox-live-translate ps'`, the app with `ssh cont 'docker logs --tail 100 vox-live-translate'`, or Postgres with `ssh cont 'docker logs --tail 100 vox-live-translate-db'`. Override the destination or port when needed:

```sh
DEPLOY_HOST=cont DEPLOY_DIR=~/deploy/vox-live-translate PORT=3000 just deploy
```
