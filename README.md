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

`just deploy` builds the app locally, compresses `.output` and the runtime `Dockerfile` into a tarball, uploads it over SCP, and builds/runs the `vox-live-translate` Docker container on `cont` at `~/deploy/vox-live-translate`. The remote server must have Docker and `tar` installed. The container is configured with `--restart unless-stopped`, uses the remote `.env` file, and publishes the selected port (default `5080`) only on `127.0.0.1` for Nginx to proxy.

If a local `.env` exists, deployment uploads it to the remote deployment directory. Otherwise, an existing remote `.env` is retained; deployment stops with a clear error if neither exists. Inspect a deployed server with `ssh cont 'docker logs --tail 100 vox-live-translate'`. Override the destination or port when needed:

```sh
DEPLOY_HOST=cont DEPLOY_DIR=~/deploy/vox-live-translate PORT=3000 just deploy
```
