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
tar -czf "$ARCHIVE" .output

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
release_dir="$remote_dir/releases/$(date +%Y%m%d%H%M%S)-$$"

mv "$staging_dir" "$release_dir"
ln -sfn "$release_dir" "$remote_dir/current"

if [ -f "$remote_dir/server.pid" ]; then
    old_pid=$(cat "$remote_dir/server.pid")
    if kill -0 "$old_pid" 2>/dev/null; then
        kill "$old_pid"
        # Give the prior server a moment to stop cleanly before binding PORT.
        for _ in 1 2 3 4 5; do
            kill -0 "$old_pid" 2>/dev/null || break
            sleep 1
        done
    fi
fi

if [ -f "$remote_dir/.env" ]; then
    set -a
    . "$remote_dir/.env"
    set +a
fi

if command -v bun >/dev/null 2>&1; then
    bun_bin=$(command -v bun)
elif [ -x "$HOME/.bun/bin/bun" ]; then
    bun_bin="$HOME/.bun/bin/bun"
else
    printf '%s\n' 'Bun is required on the remote server but was not found.' >&2
    exit 1
fi

cd "$remote_dir"
nohup env PORT="$port" "$bun_bin" "$remote_dir/current/.output/server/index.mjs" \
    >> "$remote_dir/server.log" 2>&1 < /dev/null &
new_pid=$!
echo "$new_pid" > "$remote_dir/server.pid"

sleep 1
if ! kill -0 "$new_pid" 2>/dev/null; then
    printf '%s\n' 'The deployed server exited during startup. Recent log output:' >&2
    tail -n 50 "$remote_dir/server.log" >&2 || true
    exit 1
fi
REMOTE_SCRIPT

rm -f "$ARCHIVE"
trap - EXIT HUP INT TERM
printf 'Deployed to %s:%s (port %s)\n' "$HOST" "$REMOTE_DIR" "$PORT"
