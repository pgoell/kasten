# Security

## Reporting a vulnerability

Report it privately through **Report a vulnerability** on the repository's
Security tab, not in a public issue.

## What kasten trusts

kasten has no login of its own. Whoever reaches `/api/*` or `/term/*` is
treated as the owner: they can read and change every note, mint agent tokens,
and type into a shell beside the vault. Put a login in front of everything
except `/agent/*` and `/.well-known/*`, which check a bearer token themselves.
Never publish the backend, frontend or shell ports directly.

Only the latest release gets fixes.
