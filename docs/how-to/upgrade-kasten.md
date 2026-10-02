---
type: How-to Guide
title: Upgrade kasten
description: Move a self-hosted kasten to a new release, pinned or following latest, check it came up, and roll back to the release before.
tags: [upgrade, release, self-host]
status: stable
---

# Upgrade kasten

For [the self-host stack](/how-to/self-host-kasten.md), run in
`deploy/selfhost/` of your clone. Each release is a git tag such as `0.31.0`,
and the three images carry the same tag.

## 1. Read the release notes

Every release is on [the releases page](https://github.com/pgoell/kasten/releases),
with the pull requests it carries. Read each one between your release and the
new one. Look for a `!` after the type, `feat!:`, which marks a breaking change,
and for any that touch `deploy/selfhost/`.

The release you run now is in the bar at the foot of the window.

## 2. Back up

```sh
tar -C data -czf ../kasten-before-upgrade.tar.gz vault agent
```

[Back up and restore](/how-to/back-up-and-restore.md) has the rest.

## 3. Move the files and the images together

The compose file and Caddyfile can change with a release, so check out the same
tag the images will run:

```sh
git fetch --tags
git checkout 0.31.0
```

Then set the images. With `KASTEN_IMAGE_TAG=0.31.0` in `.env`, change the
number. With `KASTEN_IMAGE_TAG=latest`, leave it; `latest` is always the newest
release.

```sh
docker compose pull
docker compose up -d
```

Compose recreates the containers whose image changed and leaves the vault, the
token store and the volumes as they were.

## 4. Check it

```sh
docker compose ps
docker compose logs backend --tail 50
```

Every service should be up, and the backend and frontend `healthy` within a
minute. Reload the notebook and read the version in the foot bar. If a
release changed the gate or the routes, run the curls in
[Check the gate](/how-to/self-host-kasten.md#6-check-the-gate) again.

## Roll back

Go back to the tag you came from, for both the files and the images. Tags up
to 0.29.0 have no `deploy/selfhost/`, so go no further back than the first
release that does.

```sh
git checkout 0.30.0
# set KASTEN_IMAGE_TAG=0.30.0 in .env, even if it said latest
docker compose pull
docker compose up -d
```

There is no database to migrate back, and the notes stay plain markdown. If the
new release did damage notes,
[Recover an earlier version of a note](/how-to/recover-an-earlier-version.md)
undoes it from jj, and the tar from step 2 is the last resort.

## Clean up

Old images stay on disk after an upgrade. Once the new release runs well,
remove every image no container uses:

```sh
docker image prune -a
```

## Related

* [Back up and restore](/how-to/back-up-and-restore.md): the backup step 2 points at
* [Requirements](/reference/requirements.md): the disk an upgrade needs while two sets of images sit side by side
* [Cut a release](/how-to/cut-a-release.md): how a release is made, from the other side
