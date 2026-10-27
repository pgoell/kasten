---
type: How-to Guide
title: Cut a release
description: Run one command on a clean, up to date main. It picks the next version from the commits and publishes the release, and the workflow deploys it.
tags: [release, versioning, deploy, ci]
status: stable
---

# Cut a release

Production deploys when a GitHub release is published. Nothing else deploys it,
and nothing about it is built on the box. The tag is the version. No file holds
it.

## 1. Check main

Cut from `main` with a clean tree, at the tip of `origin/main`. Off `main`,
with uncommitted changes, or not at the tip, the command stops and says why.

```sh
git checkout main && git pull
```

## 2. See the version

```sh
mise run release -- --dry-run
```

It prints the next version and creates nothing. It reads the
[Conventional Commits](https://www.conventionalcommits.org) since the last
`X.Y.Z` tag, and the highest bump in them wins:

| What is in the range | The next version |
|---|---|
| Anything with `!` after the type, or a `BREAKING CHANGE:` footer | major, `1.0.0` |
| At least one `feat` | minor, `0.3.0` |
| `fix`, `perf`, `refactor`, `build` or `revert` | patch, `0.2.1` |
| Only `docs`, `test`, `chore`, `ci` or `style`, or a subject that is not a Conventional Commit | no release |

kasten is below `1.0.0`, so a minor bump is still allowed to break things. That
is the version being pre-1.0, not a licence to skip the `!`.

If nothing in the range is releasable, the command says `nothing to release since 0.3.0`
and creates nothing. Commits that change nothing a user or an operator can
observe are not a reason to cut a release on their own.

## 3. Publish

```sh
mise run release
```

It creates the release `0.3.0` at the commit `main` points to, with the notes
GitHub writes from the commits since the last release. The subjects become those
notes, which is why they are worth writing carefully. The tag is the version and
nothing else, no `v`.

## 4. Watch it land

```sh
gh run watch
```

The workflow checks the tag first. It must be `X.Y.Z`, with no `v`, no suffix and
no leading zeros, and the next patch, minor or major after the last release tag. If it is not, the workflow
stops before anything is built or pushed. See
[When the tag check fails](#when-the-tag-check-fails).

Then it builds each image twice, for `linux/amd64` on `ubuntu-latest` and for
`linux/arm64` on `ubuntu-24.04-arm`, side by side, and pushes the pair to GHCR as
one image tagged with the version and `latest`. The last job sends the tag to the
VPS over SSH, and the deploy script there pulls, migrates, restarts and waits for
the backend healthcheck. It is an amd64 box, so it pulls the amd64 half, built
from the same Dockerfile lines and the same pinned binaries as before arm64 was
added.

An image whose sources have not changed since the last release is not rebuilt.
The workflow diffs this tag against the one before it, and where nothing that
goes into an image has moved, it copies the earlier image to this release's tag
inside the registry instead. The shell image is the one this usually catches:
it is the slowest of the three and it changes least, and copying it takes
seconds where building it takes four minutes.

The copy also needs the earlier image to carry both architectures. Releases
from before arm64 was built carry amd64 alone, so no release copies from one of
them.

The backend is never copied. Its version is written in at build, so a copied
image would report the old tag. Every release builds it. The frontend is copied
when its sources are unchanged. The release that brings in the change to
`frontend/openapi.json` still rebuilds it, and copies resume after. A release no
longer moves that file, because `scripts/dump_openapi.py` pins its version at
`0.0.0`.

The digest a copied image carries is the one that was already running under the
earlier tag, rather than a fresh build of the same sources, so a release that
changes nothing about a component deploys the exact bytes that were serving
before it.

Confirm what is actually serving, on the box:

```sh
docker exec kasten-backend-prod \
  python -c "import importlib.metadata as m; print(m.version('kasten-backend'))"
```

Not `curl` against the public address. Everything there sits behind
oauth2-proxy, so an unauthenticated request for `openapi.json` is answered with
a 302 to the sign-in page and never with the version.

## When the tag check fails

The workflow stops before anything is pushed. Delete the release and its tag,
then run the command again:

```sh
gh release delete 0.3.0 --cleanup-tag --yes
mise run release
```

Deleting is safe because no image went out under that tag. If the check fails
again, look at `git tag` before retrying: a tag the commits do not imply was
made by hand.

## Rolling back

Run the `Deploy production` workflow by hand with `tag` set to an older release.
It skips the build and the tag check, and redeploys images that already exist:

```sh
gh workflow run "Deploy production" -f tag=0.2.0
```

The backend then reports `0.2.0` again, because the number travelled with the
image.

## Related

* [Deploy to the VPS](deploy-to-the-vps.md): the runbook for both environments, bootstrap through rollback
* [Two environments](/explanation/environments.md): what the two environments are and why they are wired that way
* [Regenerate the API types](regenerate-the-api-types.md): the step that rebuilds the frontend types after an endpoint changes
* [Run the checks](run-the-checks.md): the tests and linters CI runs on the release branch
