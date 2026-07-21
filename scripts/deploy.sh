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
tar -czf "$ARCHIVE" .output Dockerfile

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
image_name=vox-live-translate:latest
release_dir="$remote_dir/releases/$(date +%Y%m%d%H%M%S)-$$"

if ! command -v docker >/dev/null 2>&1; then
    printf '%s\n' 'Docker is required on the remote server but was not found.' >&2
    exit 1
fi

if [ ! -f "$remote_dir/.env" ]; then
    printf '%s\n' "Missing required environment file: $remote_dir/.env" >&2
    exit 1
fi

mv "$staging_dir" "$release_dir"

# Build before replacing the running container so a failed image build does
# not interrupt the currently deployed version.
docker build --tag "$image_name" "$release_dir"
docker rm --force "$container_name" >/dev/null 2>&1 || true

docker run --detach \
    --name "$container_name" \
    --restart unless-stopped \
    --env-file "$remote_dir/.env" \
    --env "NITRO_HOST=0.0.0.0" \
    --env "PORT=$port" \
    --publish "127.0.0.1:$port:$port" \
    "$image_name" >/dev/null

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
