#!/usr/bin/env bash
# Regenerate the frontend's OpenAPI-derived types from the backend schema.
set -euo pipefail

# openapi-typescript builds its output through the TypeScript compiler API and
# declares a `typescript: ^5.x` peer, while the frontend is on TypeScript 7.
# Installing it as a frontend devDependency therefore cannot work: the peer
# resolves against the project and the generator dies on an undefined
# `ts.factory`. bunx installs it into bun's own cache instead, outside the
# project, so the peer resolves to a TypeScript 5 the generator supports and
# the frontend keeps TypeScript 7. Drop this indirection once
# openapi-typescript supports TypeScript 7.
OPENAPI_TYPESCRIPT="openapi-typescript@7.13.0"

cd "$(dirname "$0")/.."

echo "Dumping OpenAPI schema from kasten_backend.main..."
uv run --directory backend python ../scripts/dump_openapi.py > frontend/openapi.json.tmp
mv frontend/openapi.json.tmp frontend/openapi.json

echo "Generating TypeScript types with $OPENAPI_TYPESCRIPT..."
mkdir -p frontend/src/lib
# bunx runs the binary in the current directory, so both paths are given
# relative to the repo root rather than to frontend/.
bunx "$OPENAPI_TYPESCRIPT" frontend/openapi.json -o frontend/src/lib/api-types.ts

echo "Done: frontend/src/lib/api-types.ts"
