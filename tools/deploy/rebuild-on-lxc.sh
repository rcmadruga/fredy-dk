#!/usr/bin/env bash
#
# Rebuilds and redeploys this fork on LXC 116, as the user/root that normally manages
# the Fredy container. Pulls the latest commit from master, builds a local image, and
# swaps it in - the whole point being that `docker pull ghcr.io/orangecoding/fredy` no
# longer applies once the checkout carries patches the upstream image doesn't have.
# Re-run this any time master has a new commit to try.
#
# What it does, in order:
#   1. Shows free disk space (Chromium download needs headroom).
#   2. Finds the currently-running Fredy container and prints its volume mounts,
#      so you can eyeball that the names below match your setup.
#   3. Clones (first run) or pulls (later runs) rcmadruga/fredy-dk into ~/fredy-dk.
#   4. Builds a local image from that checkout - this replaces `docker pull
#      ghcr.io/orangecoding/fredy:master`, which no longer matches a patched fork.
#   5. Stops (does NOT remove) the old container, so it's still there to roll back to.
#   6. Starts a new container named fredy-new, reusing the same named volumes and
#      port, and tails its logs so you can watch it come up.
#
# Environment for the new container - NOT carried over from the old one, so anything the app needs
# has to be supplied here every time:
#   - UDDANNELSESSTATISTIK_API_KEY: turns on the Denmark school layer. Passed through from your shell
#     when set (by name, so the value never appears in the process list or in this script's output):
#       UDDANNELSESSTATISTIK_API_KEY=... ./rebuild-on-lxc.sh
#   - ENV_FILE (default ~/fredy.env, used only if it exists): a `KEY=value` per line file handed to
#     `docker run --env-file`, so a key is written down once instead of exported on every rebuild.
#     Keep it private: chmod 600 ~/fredy.env
#
# It does NOT touch the old container beyond stopping it, and does NOT rename/remove
# anything at the end - that's a manual step after you've confirmed the new one works
# in the browser (see the printed instructions at the end).
#
# Override the detected volume names if the auto-detect below guesses wrong, e.g.:
#   CONF_VOLUME=my_conf DB_VOLUME=my_db ./rebuild-on-lxc.sh

set -euo pipefail

REPO_URL="https://github.com/rcmadruga/fredy-dk.git"
CHECKOUT_DIR="$HOME/fredy-dk"
IMAGE_TAG="fredy-dk:local"
NEW_CONTAINER="fredy-new"
ENV_FILE="${ENV_FILE:-$HOME/fredy.env}"

echo "== 1. Disk space =="
df -h /

echo
echo "== 2. Currently running Fredy container =="
OLD_CONTAINER="$(docker ps -a --filter "ancestor=ghcr.io/orangecoding/fredy:master" --format '{{.Names}}' | head -n1)"
if [ -z "$OLD_CONTAINER" ]; then
  OLD_CONTAINER="$(docker ps -a --format '{{.Names}}' | grep -i fredy | head -n1 || true)"
fi

if [ -z "$OLD_CONTAINER" ]; then
  echo "Could not auto-detect a running Fredy container. List them yourself:"
  docker ps -a
  echo "Then re-run with OLD_CONTAINER=<name> $0"
  exit 1
fi
echo "Found container: $OLD_CONTAINER"

MOUNTS_JSON="$(docker inspect "$OLD_CONTAINER" --format '{{json .Mounts}}')"
echo "Mounts: $MOUNTS_JSON"

CONF_VOLUME="${CONF_VOLUME:-$(echo "$MOUNTS_JSON" | grep -o '"Name":"[^"]*","Source":"[^"]*","Destination":"/conf"' | sed -E 's/.*"Name":"([^"]*)".*/\1/' || true)}"
DB_VOLUME="${DB_VOLUME:-$(echo "$MOUNTS_JSON" | grep -o '"Name":"[^"]*","Source":"[^"]*","Destination":"/db"' | sed -E 's/.*"Name":"([^"]*)".*/\1/' || true)}"

if [ -z "$CONF_VOLUME" ] || [ -z "$DB_VOLUME" ]; then
  echo "Could not auto-detect the /conf and /db volume names from the mounts above."
  echo "Re-run as: CONF_VOLUME=<name> DB_VOLUME=<name> $0"
  exit 1
fi
echo "conf volume: $CONF_VOLUME"
echo "db volume:   $DB_VOLUME"

echo
echo "== 3. Fetching code =="
if [ -d "$CHECKOUT_DIR/.git" ]; then
  git -C "$CHECKOUT_DIR" pull origin master
else
  git clone "$REPO_URL" "$CHECKOUT_DIR"
fi
git -C "$CHECKOUT_DIR" log -1 --oneline

echo
echo "== 4. Building local image (this can take a while - includes the Chromium download) =="
docker build -t "$IMAGE_TAG" "$CHECKOUT_DIR"

echo
echo "== 5. Stopping old container (not removing) =="
docker stop "$OLD_CONTAINER"

echo
echo "== 6. Starting new container: $NEW_CONTAINER =="
docker rm -f "$NEW_CONTAINER" >/dev/null 2>&1 || true

# Extra `docker run` arguments, built up so each source of environment is reported (names only, never
# values) before the container starts.
ENV_ARGS=()
if [ -f "$ENV_FILE" ]; then
  ENV_ARGS+=(--env-file "$ENV_FILE")
  echo "Environment file:  $ENV_FILE ($(grep -cE '^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE" || true) variables)"
fi
if [ -n "${UDDANNELSESSTATISTIK_API_KEY:-}" ]; then
  # `-e NAME` with no value copies it from this shell, so it is not on the command line.
  ENV_ARGS+=(-e UDDANNELSESSTATISTIK_API_KEY)
fi
if [ -n "${UDDANNELSESSTATISTIK_API_KEY:-}" ] || { [ -f "$ENV_FILE" ] && grep -qE '^[[:space:]]*UDDANNELSESSTATISTIK_API_KEY=.+' "$ENV_FILE"; }; then
  echo "School layer key:  set"
else
  echo "School layer key:  NOT set - the Denmark school layer will stay off (see the header of this script)"
fi

docker run -d --name "$NEW_CONTAINER" --restart unless-stopped -p 9998:9998 \
  -v "$CONF_VOLUME":/conf -v "$DB_VOLUME":/db \
  ${ENV_ARGS[@]+"${ENV_ARGS[@]}"} "$IMAGE_TAG"

echo
echo "Tailing logs - Ctrl+C once it looks healthy (server listening, no fatal errors)."
echo "======================================================================"
docker logs -f "$NEW_CONTAINER" &
LOG_PID=$!
sleep 30
kill "$LOG_PID" 2>/dev/null || true

cat <<EOF

======================================================================
Next steps (manual, on purpose - nothing further is automated):

1. Open http://<this-LXC-IP>:9998 in a browser, log in, and check the
   job form's provider picker for "Boligsiden".

2. Try a test job with this search URL and run it once:
     https://api.boligsiden.dk/search/cases?addressTypes=villa,condo&zipCodes=5000

3. If it looks good, retire the old container and promote the new one:
     docker rm $OLD_CONTAINER
     docker rename $NEW_CONTAINER $OLD_CONTAINER

4. If something's wrong, roll back:
     docker stop $NEW_CONTAINER
     docker start $OLD_CONTAINER
======================================================================
EOF
