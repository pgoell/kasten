---
type: How-to Guide
title: Regenerate the API types
description: Rebuild the frontend's TypeScript types after changing a backend endpoint.
tags: [openapi, frontend, backend, codegen]
status: stable
---

# Regenerate the API types

The frontend does not hand-write the shapes it fetches. `frontend/src/lib/api-types.ts`
is generated from the backend's OpenAPI schema, so a change to a FastAPI route
or response model has to be pushed through to the client.

Run this whenever you add, remove or reshape an endpoint:

```sh
mise run fe:types
```

That dumps the schema from `kasten_backend.main` to `frontend/openapi.json`,
then generates `frontend/src/lib/api-types.ts` from it. Commit both files.

Check the result with:

```sh
mise run fe:typecheck
```

A route you changed but did not regenerate shows up here as a type error in
whatever calls it.

## Why the generator runs through bunx

`openapi-typescript` builds its output with the TypeScript compiler API and
declares a peer of TypeScript 5. The frontend is on TypeScript 7. Installed as
a devDependency the peer would resolve against the project and the generator
would die on an undefined `ts.factory`, so `scripts/gen_frontend_types.sh` runs
it through `bunx` instead. That installs it in bun's own cache, outside the
project, where it gets the TypeScript 5 it wants while the frontend keeps
TypeScript 7. The indirection goes away when the generator supports TypeScript 7.

## Related

* [HTTP API](/reference/http-api.md) - the endpoints the schema is built from
