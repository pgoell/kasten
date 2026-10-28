#!/usr/bin/env bash
# Run tests on a clock that crosses local midnight while they run (#1315).
#
# A test that reads today once and compares it with a date the code stamps
# later fails here. The frontend runs twice, once per mode of
# `cross-midnight.ts`; the backend once, with the code's clock a day ahead of
# the test's (the `cross_midnight` fixture in `backend/tests/conftest.py`).
#
# Arguments name test files: a `.py` one goes to pytest, any other to vitest.
# With none, every unit, frame and backend test runs.
set -u
cd "$(dirname "$0")/../.."

web=()
py=()
for arg in "$@"; do
  case "$arg" in
    *.py) py+=("${arg#backend/}") ;;
    *) web+=("${arg#frontend/}") ;;
  esac
done

status=0
if [ $# -eq 0 ] || [ ${#web[@]} -gt 0 ]; then
  for mode in load test; do
    echo "== frontend, clock mode $mode"
    (cd frontend && VITE_KASTEN_CROSS_MIDNIGHT=$mode bunx vitest run --project unit --project frame "${web[@]}") || status=1
  done
fi
if [ $# -eq 0 ] || [ ${#py[@]} -gt 0 ]; then
  echo "== backend, the code's clock a day ahead"
  KASTEN_CROSS_MIDNIGHT=1 uv run pytest -q "${py[@]/#/backend/}" || status=1
fi
exit $status
