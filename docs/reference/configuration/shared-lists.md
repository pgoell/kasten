---
type: Reference
title: "Configuration: the shared lists"
description: The two settings of the shared lists app, the host it is served on and whether its ticks write the done log line.
resource: backend/src/kasten_backend/config.py
tags: [config, share]
status: stable
---

# Configuration: the shared lists

Part of [Configuration](/reference/configuration.md), whose rules for env files
and defaults hold here too.

## KASTEN_SHARE_HOST

The `Host` of the shared lists app, `liste.pgoell.com` on the box; empty, the
default, turns the check off. There the backend answers `404` outside `/share/`, before any route runs. That is the [second lock](/explanation/shared-lists.md#two-locks).

## KASTEN_SHARE_LOGS_DONE

Whether a tick through the shared lists app writes the done log line a tick in
the todo pane writes, under `## Done` in today's daily note, and an untick drops
it. `true`, the default, logs shopping items with the rest of the day; `false`
leaves a tick to its own list. See [POST /share/lists/{name}/tick](/reference/http-api/shared-lists.md#post-sharelistsnametick).
