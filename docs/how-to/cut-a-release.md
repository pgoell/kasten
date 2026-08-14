---
type: How-to Guide
title: Cut a release
description: Pick the next version from the commits, bump it, tag it and let the workflow deploy.
tags: [release, versioning, deploy, ci]
status: stable
---

# Cut a release

Production deploys when a GitHub release is published. Nothing else deploys it,
and nothing about it is built on the box. This is the whole sequence.

## 1. Read what changed

```sh
git log --oneline $(git describe --tags --abbrev=0)..main
```

The subjects are [Conventional Commits](https://www.conventionalcommits.org),
so they already say what kind of release this is:

| What is in the range | The next version |
|---|---|
| Anything with `!`, or a `BREAKING CHANGE` footer | major, `1.0.0` |
| At least one `feat` | minor, `0.3.0` |
| Only `fix`, `perf`, `docs`, `refactor`, `test`, `chore`, `ci`, `build`, `style` | patch, `0.2.1` |

kasten is below `1.0.0`, so a minor bump is still allowed to break things. That
is the version being pre-1.0, not a licence to skip the `!`.

Commits that change nothing a user or an operator can observe, `docs` and `test`
above all, are not on their own a reason to cut anything.

## 2. Bump the version

One place holds it:

```toml
# backend/pyproject.toml
version = "0.3.0"
```

The backend reads it back off the installed package, so `main.py` carries no
copy to forget. Two things follow from the bump:

```sh
mise run fe:types     # the version is in the dumped schema
mise run test         # proves the bump did not break the install
```

Commit both files, open the pull request, and let CI go green. The bump belongs
in the same branch as the work it releases, or in one of its own if the work has
already landed.

## 3. Tag and publish

Once it is on `main`:

```sh
git checkout main && git pull
gh release create 0.3.0 --generate-notes
```

The tag is the version and nothing else, no `v`. `--generate-notes` writes the
body from the commits since the last release, which is why the subjects are
worth writing carefully.

## 4. Watch it land

```sh
gh run watch
```

The workflow checks the tag against `backend/pyproject.toml` first and stops
there if the two disagree, so a forgotten bump costs a retag rather than a
release that lies about which version it is. Then it builds the three images on
`ubuntu-latest`, pushes them to GHCR tagged with the version and `latest`, and
the self-hosted runner pulls, migrates, restarts and waits for the backend
healthcheck.

An image whose sources have not changed since the last release is not rebuilt.
The workflow diffs this tag against the one before it, and where nothing that
goes into an image has moved, it copies the earlier image to this release's tag
inside the registry instead. The shell image is the one this usually catches:
it is the slowest of the three and it changes least, and copying it takes
seconds where building it takes four minutes.

Two things follow. The version bump lands in `backend/pyproject.toml`,
`uv.lock` and `frontend/openapi.json`, so the backend and the frontend are
rebuilt on every release by construction. And the digest a copied image carries
is the one that was already running under the earlier tag, rather than a fresh
build of the same sources, so a release that changes nothing about a component
deploys the exact bytes that were serving before it.

Confirm what is actually serving, on the box:

```sh
docker exec kasten-backend-prod \
  python -c "import importlib.metadata as m; print(m.version('kasten-backend'))"
```

Not `curl` against the public address. Everything there sits behind
oauth2-proxy, so an unauthenticated request for `openapi.json` is answered with
a 302 to the sign-in page and never with the version.

## When the tag and the version disagree

The build fails before anything is pushed. Bump `backend/pyproject.toml` on
`main`, then move the release onto the new commit:

```sh
gh release delete 0.3.0 --cleanup-tag --yes
gh release create 0.3.0 --generate-notes
```

Deleting and recreating is safe as long as no images were pushed under that tag,
and the check runs before the push for that reason.

## Rolling back

Run the `Deploy production` workflow by hand with `tag` set to an older release.
It skips the build and redeploys images that already exist:

```sh
gh workflow run "Deploy production" -f tag=0.2.0
```

The backend then reports `0.2.0` again, because the number travelled with the
image.

## Related

* [Deploy to the VPS](deploy-to-the-vps.md) - the runbook for both environments, bootstrap through rollback
* [Two environments](/explanation/environments.md) - what the two environments are and why they are wired that way
* [Regenerate the API types](regenerate-the-api-types.md) - the step 2 command, and why it runs through bunx
* [Run the checks](run-the-checks.md) - the tests and linters CI runs on the release branch
