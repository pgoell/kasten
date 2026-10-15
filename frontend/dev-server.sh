#!/bin/sh
# The hosted dev frontend's entry point, run by compose.dev.yml.
#
# node_modules is a bind mount that outlives the container, and vite never
# reinstalls, so a package added to bun.lock while dev runs stayed missing
# until someone restarted the container by hand (#328). This installs at start,
# then watches bun.lock and installs again whenever it changes. Polling its
# mtime, because the alpine image has no inotify tools.
set -u

stamp() { stat -c %Y bun.lock; }

# A failed install exits nonzero, so the logs end on bun's error rather than on
# a vite that serves the page without the package.
install() {
  bun install --frozen-lockfile || exit $?
}

start() {
  bun run dev &
  vite=$!
}

# bun passes SIGTERM on to vite. Without this trap the shell is PID 1, which
# ignores TERM, and `docker compose stop` waits its full 10 s and then kills.
vite=
trap '[ -n "$vite" ] && kill "$vite" 2>/dev/null && wait "$vite"; exit 0' TERM INT

install
seen=$(stamp)
start

while sleep 2; do
  if ! kill -0 "$vite" 2>/dev/null; then
    # vite quit on its own. Pass its status on and let `restart:` bring the
    # container back.
    wait "$vite"
    exit $?
  fi
  now=$(stamp)
  if [ "$now" != "$seen" ]; then
    echo "dev-server: bun.lock changed, installing and restarting vite"
    kill "$vite"
    wait "$vite"
    seen=$now
    install
    start
  fi
done
