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
```

The generated production server is a Nitro Node-compatible application and is launched with Bun by `just start`.
