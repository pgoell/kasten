#!/usr/bin/env bash
# Regenerate the frontend's OpenAPI-derived types from the backend schema.
set -euo pipefail

# openapi-typescript builds its output through the TypeScript compiler API and
# needs TypeScript 5, while the frontend is on TypeScript 7. Installing it as a
# frontend devDependency therefore cannot work: pnpm satisfies its peer from the
# project and the generator dies on an undefined `ts.factory`. Running it here,
# in its own throwaway environment with both versions pinned exactly, keeps the
# frontend on TypeScript 7 and the generator on the version it supports. Drop
# this indirection once openapi-typescript supports TypeScript 7.
OPENAPI_TYPESCRIPT="openapi-typescript@7.13.0"
GENERATOR_TYPESCRIPT="typescript@5.9.3"

cd "$(dirname "$0")/.."

echo "Dumping OpenAPI schema from kasten_backend.main..."
uv run --directory backend python ../scripts/dump_openapi.py > frontend/openapi.json.tmp
mv frontend/openapi.json.tmp frontend/openapi.json

echo "Generating TypeScript types with $OPENAPI_TYPESCRIPT on $GENERATOR_TYPESCRIPT..."
mkdir -p frontend/src/lib
# `dlx` runs the binary in the current directory, so both paths are given
# relative to the repo root rather than to frontend/.
pnpm dlx \
  --package "$GENERATOR_TYPESCRIPT" \
  --package "$OPENAPI_TYPESCRIPT" \
  openapi-typescript frontend/openapi.json -o frontend/src/lib/api-types.ts

echo "Done: frontend/src/lib/api-types.ts"
