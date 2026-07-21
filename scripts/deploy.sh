#!/usr/bin/env sh
# Deploy the locally built Nitro output to the production host.
set -eu

HOST="${DEPLOY_HOST:-cont}"
REMOTE_DIR="${DEPLOY_DIR:-~/deploy/vox-live-translate}"
PORT="${PORT:-5080}"
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

case "$PORT" in
    *[!0-9]* | '')
        printf '%s\n' "PORT must be a numeric TCP port, got: $PORT" >&2
        exit 1
        ;;
esac

cd "$PROJECT_DIR"
bun run build

# Expand the remote home directory on the server rather than locally.
REMOTE_DIR="$(ssh "$HOST" sh -s -- "$REMOTE_DIR" <<'REMOTE_PATH'
case "$1" in
    '~/'*) printf '%s/%s' "$HOME" "${1#~/}" ;;
    /*) printf '%s' "$1" ;;
    *) printf '%s/%s' "$HOME" "$1" ;;
esac
REMOTE_PATH
)"
STAGING_DIR="$REMOTE_DIR/.incoming-$$"
ARCHIVE=$(mktemp "${TMPDIR:-/tmp}/vox-live-translate.XXXXXX.tar.gz")

# A single compressed transfer avoids per-file SCP overhead for build assets.
tar -czf "$ARCHIVE" .output Dockerfile compose.yaml package.json bun.lock drizzle.config.ts drizzle src/server/db/schema.ts

ssh "$HOST" "mkdir -p \"$REMOTE_DIR/releases\" && rm -rf \"$STAGING_DIR\" && mkdir -p \"$STAGING_DIR\""
trap 'rm -f "$ARCHIVE"; ssh "$HOST" "rm -rf \"$STAGING_DIR\"" 2>/dev/null || true' EXIT HUP INT TERM

scp "$ARCHIVE" "$HOST:$STAGING_DIR/release.tar.gz"
ssh "$HOST" "tar -xzf \"$STAGING_DIR/release.tar.gz\" -C \"$STAGING_DIR\" && rm \"$STAGING_DIR/release.tar.gz\""

# Keep secrets outside versioned release directories. Upload .env when it is
# available locally; otherwise an existing remote .env is retained.
if [ -f .env ]; then
    scp .env "$HOST:$REMOTE_DIR/.env"
fi

ssh "$HOST" sh -s -- "$REMOTE_DIR" "$STAGING_DIR" "$PORT" <<'REMOTE_SCRIPT'
set -eu

remote_dir=$1
staging_dir=$2
port=$3
container_name=vox-live-translate
project_name=vox-live-translate
release_dir="$remote_dir/releases/$(date +%Y%m%d%H%M%S)-$$"
database_env="$remote_dir/database.env"

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
    printf '%s\n' 'Docker with the Compose plugin is required on the remote server.' >&2
    exit 1
fi

if [ ! -f "$remote_dir/.env" ]; then
    printf '%s\n' "Missing required environment file: $remote_dir/.env" >&2
    exit 1
fi

if [ ! -f "$database_env" ]; then
    if ! command -v openssl >/dev/null 2>&1; then
        printf '%s\n' 'OpenSSL is required to create the PostgreSQL credential file.' >&2
        exit 1
    fi
    umask 077
    printf 'POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 32)" > "$database_env"
fi
chmod 600 "$database_env"

mv "$staging_dir" "$release_dir"
ln -s "$remote_dir/.env" "$release_dir/.env"

compose() {
    APP_PORT="$port" docker compose --project-name "$project_name" --env-file "$database_env" --file "$release_dir/compose.yaml" "$@"
}

# Build and pull before replacing the running app so a failed deployment does
# not interrupt the currently deployed version.
compose pull db
compose build app migrate
docker rm --force "$container_name" >/dev/null 2>&1 || true
compose up --detach

sleep 1
if [ "$(docker inspect --format '{{.State.Running}}' "$container_name")" != true ]; then
    printf '%s\n' 'The deployed container exited during startup. Recent log output:' >&2
    docker logs --tail 50 "$container_name" >&2 || true
    exit 1
fi

ln -sfn "$release_dir" "$remote_dir/current"
REMOTE_SCRIPT

rm -f "$ARCHIVE"
trap - EXIT HUP INT TERM
printf 'Deployed to %s:%s (port %s)\n' "$HOST" "$REMOTE_DIR" "$PORT"
