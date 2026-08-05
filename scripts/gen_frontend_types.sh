#!/usr/bin/env bash
# Regenerate the frontend's OpenAPI-derived types from the backend schema.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "Dumping OpenAPI schema from kasten_backend.main..."
uv run --directory backend python ../scripts/dump_openapi.py > frontend/openapi.json.tmp
mv frontend/openapi.json.tmp frontend/openapi.json

echo "Generating TypeScript types..."
mkdir -p frontend/src/lib
pnpm -C frontend exec openapi-typescript ./openapi.json -o ./src/lib/api-types.ts

echo "Done: frontend/src/lib/api-types.ts"
