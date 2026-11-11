---
type: Reference
title: "Configuration: push reminders"
description: The VAPID key push reminders are signed with, and the zone a todo's reminder time is read in.
resource: backend/src/kasten_backend/config.py
tags: [config, push, reminders, phone]
status: stable
---

# Configuration: push reminders

Part of [Configuration](/reference/configuration.md), whose rules for env files
hold here too.

## KASTEN_PUSH_PRIVATE_KEY

The VAPID private key every push is signed with: 32 bytes in unpadded
base64url, the form `web-push generate-vapid-keys` prints. Unset by default,
which turns push off: the sender never starts, so no reminder or timer rings, `GET /api/push` answers
`"public_key": null`, and `/settings` says push is not set up.

The public key a browser subscribes with is derived from it, so there is no
setting for that. Make a pair with:

```sh
docker exec kasten-backend-prod python -m kasten_backend.push
```

It prints the `KASTEN_PUSH_PRIVATE_KEY=` line to put in the env file, and the
public key as a comment. A new key leaves every subscribed device behind: each
has to subscribe again in `/settings`.

## KASTEN_TIMEZONE

The zone a todo's `⏰ 2026-11-12 09:00` is read in. Default `Europe/Berlin`.
The server's clock runs in UTC, so the zone is named here rather than taken
from it. Any name in the IANA database works. The morning push, the goals push
and the quiet hours set in `/settings` are read in it too, and so is the day a
reminder's **Done** stamps and **Tomorrow** moves to.

## Related

* [Get reminders on your phone](/how-to/phone/install-on-your-phone.md#get-reminders-on-this-device): subscribe a device
* [HTTP API: todos](/reference/http-api/todos.md#get-apipush): the push routes
