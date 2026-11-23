#!/usr/bin/env bash
# Runs the always-flow journeys named in features/*.md, then the journeys given as arguments
# (passed to `bunx playwright test`), on the e2e harness. Evidence goes to .verify/<UTC time>/.
set -euo pipefail

root=$(git rev-parse --show-toplevel)
here="$root/.claude/skills/verify"
out="$root/.verify/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$out"

projects() {
  docker ps -a --filter "label=com.docker.compose.project.working_dir=$root" \
    --format '{{.Label "com.docker.compose.project"}}' | grep -E '^kasten-e2e-[0-9a-f]{8}$' | sort -u || true
}
before=$(projects)

# A run killed before Playwright's teardown leaves its compose project up; remove only those.
cleanup() {
  local name
  for name in $(comm -13 <(echo "$before") <(projects)); do
    docker compose -p "$name" -f "$root/compose.yaml" -f "$root/e2e/harness/compose.e2e.yml" \
      down -v --remove-orphans >/dev/null 2>&1 || true
    echo "verify: removed the compose project $name this run left"
  done
}
trap cleanup EXIT
trap 'exit 130' INT TERM

(cd "$root/frontend" && bun install --frozen-lockfile >/dev/null)
(cd "$root/e2e" && bun install --frozen-lockfile >/dev/null)
(cd "$root" && uv sync --frozen -q && mise run fe:build >"$out/build.log" 2>&1)

files=()
titles=()
while IFS= read -r line; do
  files+=("journeys/${line%% › *}")
  titles+=("${line#* › }")
done < <(sed -n 's/^- Journey: //p' "$here"/features/*.md)

grep=$(printf '%s\n' "${titles[@]}" | sed 's/[][\.*^$+?(){}|/]/\\&/g' | paste -sd '|')
cd "$root/e2e"

listed=$(bunx playwright test "${files[@]}" -g "$grep" --list | sed -n 's/^Total: \([0-9]*\) test.*/\1/p')
if [ "$listed" != "${#titles[@]}" ]; then
  echo "verify: the map names ${#titles[@]} journeys but $listed tests match; fix a renamed - Journey: line" >&2
  exit 1
fi

timeout 600 bunx playwright test "${files[@]}" -g "$grep" --reporter=list 2>&1 | tee "$out/always.log"
if [ "$#" -gt 0 ]; then
  timeout 600 bunx playwright test "$@" --reporter=list 2>&1 | tee "$out/touched.log"
fi
echo "verify: ${#titles[@]} always-flows passed${1:+ and the touched journeys}; evidence in $out"
