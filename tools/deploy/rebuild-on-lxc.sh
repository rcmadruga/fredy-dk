#!/usr/bin/env bash
#
# Redeploys this fork on LXC 116, as the user/root that normally manages the Fredy container.
#
# By default it runs a released image: every merge labelled `release` publishes
# ghcr.io/rcmadruga/fredy-dk:<upstream>-dk.<n> (see doc/releasing-dk.md), so there is nothing to
# build here - no checkout, no Chromium download, and a rollback is just an older version:
#
#   ./rebuild-on-lxc.sh                          newest DK release (asked from the GitHub API)
#   VERSION=29.2.1-dk.1 ./rebuild-on-lxc.sh      a specific release, e.g. to roll back
#   ./rebuild-on-lxc.sh --build                  build master locally, the old way (for something
#                                                not released yet)
#
# A pinned version, never :latest: docker.yml also pushes :latest on every master commit, so
# :latest means "master right now", not "the last release".
#
# The package is public, so no `docker login` is needed. If it is ever made private again, run
# `docker login ghcr.io -u rcmadruga` once with a token that has read:packages.
#
# What it does, in order:
#   1. Shows free disk space (a pull or a build both need headroom).
#   2. Finds the currently-running Fredy container and prints its volume mounts,
#      so you can eyeball that the names below match your setup.
#   3. Pulls the release image (or, with --build, updates ~/fredy-dk and builds fredy-dk:local).
#      This happens BEFORE the old container is stopped, so a failed pull costs no downtime.
#   4. Stops (does NOT remove) the old container, so it's still there to roll back to.
#   5. Starts a new container named fredy-new, reusing the same named volumes and
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

REPO="rcmadruga/fredy-dk"
REPO_URL="https://github.com/$REPO.git"
REGISTRY_IMAGE="ghcr.io/$REPO"
CHECKOUT_DIR="$HOME/fredy-dk"
LOCAL_IMAGE="fredy-dk:local"
NEW_CONTAINER="fredy-new"
ENV_FILE="${ENV_FILE:-$HOME/fredy.env}"

BUILD_LOCALLY=false
for arg in "$@"; do
  case "$arg" in
    --build) BUILD_LOCALLY=true ;;
    -h | --help)
      sed -n '2,40p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg (see --help)"
      exit 1
      ;;
  esac
done

echo "== 1. Disk space =="
df -h /

echo
echo "== 2. Currently running Fredy container =="
# Excludes $NEW_CONTAINER itself from both detection attempts. Without this, a previous run whose
# promotion step (3, at the end) was skipped leaves "fredy-new" as the container actually serving
# traffic, and the grep fallback below would happily pick it as the "old" one too - then step 5
# stops it and step 6 force-removes it, destroying the live container this run was meant to replace,
# all before the new one is even built.
#
# Every pipeline here ends in `|| true`: under `set -e -o pipefail` a grep with no match would
# otherwise kill the script silently, before it printed anything. OLD_CONTAINER from the
# environment is honoured, as the message below promises.
#
# Three kinds of image can be behind the live container: one of our releases (any tag of
# $REGISTRY_IMAGE), a local build ($LOCAL_IMAGE), or upstream's image on the very first run. The
# release check matches on the image name rather than `--filter ancestor=`, because ancestor needs
# the exact tag and the live one is whichever release was deployed last.
if [ -z "${OLD_CONTAINER:-}" ]; then
  OLD_CONTAINER="$(docker ps -a --format '{{.Names}} {{.Image}}' | awk -v img="$REGISTRY_IMAGE" -v skip="$NEW_CONTAINER" 'index($2, img) == 1 && $1 != skip { print $1; exit }' || true)"
fi
if [ -z "${OLD_CONTAINER:-}" ]; then
  OLD_CONTAINER=""
  for image in "$LOCAL_IMAGE" "ghcr.io/orangecoding/fredy:master"; do
    OLD_CONTAINER="$(docker ps -a --filter "ancestor=$image" --format '{{.Names}}' | grep -vx "$NEW_CONTAINER" | head -n1 || true)"
    [ -n "$OLD_CONTAINER" ] && break
  done
fi
if [ -z "$OLD_CONTAINER" ]; then
  OLD_CONTAINER="$(docker ps -a --format '{{.Names}}' | grep -i fredy | grep -vx "$NEW_CONTAINER" | head -n1 || true)"
fi

if [ -z "$OLD_CONTAINER" ]; then
  echo "Could not auto-detect a Fredy container other than $NEW_CONTAINER itself."
  echo "If the only fredy-named container docker knows about IS $NEW_CONTAINER, a previous"
  echo "deploy's promotion step (3, at the end) was probably never run, and it is quietly the"
  echo "one serving traffic right now. List containers yourself to check:"
  docker ps -a
  echo "Then either rename it out of the way first, or re-run with OLD_CONTAINER=<name> $0."
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
if [ "$BUILD_LOCALLY" = true ]; then
  echo "== 3. Building master locally (this can take a while - includes the Chromium download) =="
  if [ -d "$CHECKOUT_DIR/.git" ]; then
    # fetch + reset rather than pull: a pull refuses after master was ever rewritten upstream.
    git -C "$CHECKOUT_DIR" fetch origin master
    git -C "$CHECKOUT_DIR" reset --hard origin/master
  else
    git clone "$REPO_URL" "$CHECKOUT_DIR"
  fi
  git -C "$CHECKOUT_DIR" log -1 --oneline
  docker build -t "$LOCAL_IMAGE" "$CHECKOUT_DIR"
  IMAGE="$LOCAL_IMAGE"
else
  if [ -z "${VERSION:-}" ]; then
    # The newest GitHub release's tag. No jq on the LXC, so the field is cut out with sed.
    VERSION="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | sed -nE 's/.*"tag_name":[[:space:]]*"([^"]+)".*/\1/p' | head -n1 || true)"
    if [ -z "$VERSION" ]; then
      echo "Could not read the newest release from the GitHub API."
      echo "Pass one explicitly: VERSION=<version> $0   (or build locally: $0 --build)"
      exit 1
    fi
  fi
  IMAGE="$REGISTRY_IMAGE:$VERSION"
  echo "== 3. Pulling $IMAGE =="
  if ! docker pull "$IMAGE"; then
    echo "Pull failed. If the package was made private, log in once:"
    echo "  docker login ghcr.io -u rcmadruga   (token with read:packages)"
    exit 1
  fi
fi

echo
echo "== 4. Stopping old container (not removing) =="
docker stop "$OLD_CONTAINER"

echo
echo "== 5. Starting new container: $NEW_CONTAINER ($IMAGE) =="
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
  ${ENV_ARGS[@]+"${ENV_ARGS[@]}"} "$IMAGE"

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

1. Open http://<this-LXC-IP>:9998 in a browser, log in, and check that the
   footer shows the version you deployed ($IMAGE).

2. If it looks good, retire the old container and promote the new one:
     docker rm $OLD_CONTAINER
     docker rename $NEW_CONTAINER $OLD_CONTAINER

3. If something's wrong, roll back right away:
     docker stop $NEW_CONTAINER
     docker start $OLD_CONTAINER
   or, after promoting, deploy an older release:
     VERSION=<older version> $0
======================================================================
EOF
