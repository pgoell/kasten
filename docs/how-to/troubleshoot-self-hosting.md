---
type: How-to Guide
title: Troubleshoot a self-hosted kasten
description: Find out why the self-host stack will not start, will not get a certificate, will not let you in, will not save, or shows a blank terminal.
tags: [self-host, troubleshooting, caddy, deploy]
status: stable
---

# Troubleshoot a self-hosted kasten

For [the self-host stack](/how-to/self-host-kasten.md), from
`deploy/selfhost/`. Most answers start in the logs:

```sh
docker compose ps
docker compose logs caddy --tail 50
docker compose logs backend --tail 50
```

An agent that will not connect has its own table, in
[Connect an agent](/how-to/connect-an-agent.md#when-it-does-not-work).

## The stack will not start

**`required variable KASTEN_DOMAIN is missing a value`**, or the same for
`KASTEN_GATE`. Both have no default on purpose. Set them in `.env` beside
`compose.yaml`.

**Caddy exits with `File to import not found: gates/<name>.caddy`.**
`KASTEN_GATE` names a gate with no file. It must be `basicauth`, `oauth2-proxy`
or `tailscale`, spelled as the files in `gates/` are.

**Caddy exits with `username and password cannot be empty or missing`.**
`KASTEN_BASIC_AUTH_USER` is set and `KASTEN_BASIC_AUTH_HASH` is empty. Set the
hash.

**Compose warns that a variable is not set**, naming a run of letters from the
bcrypt hash. The hash is not in single quotes, so compose read each `$` in it
as a variable and broke the hash. Quote it:
`KASTEN_BASIC_AUTH_HASH='$2a$14$...'`.

## No certificate

Caddy's log says why. For basic auth and oauth2-proxy, Let's Encrypt must reach
the machine at `KASTEN_DOMAIN` on port 80 or 443:

* `KASTEN_DOMAIN` is your name, not the example's `kasten.example.com`.
* `dig +short <your-host>` prints the machine's public address.
* Ports 80 and 443 are open in every firewall on the way, the cloud provider's
  included.
* `KASTEN_HTTP_PORT` and `KASTEN_HTTPS_PORT` are 80 and 443, or something in
  front forwards those to them.

Too many failed tries and Let's Encrypt makes you wait. Fix the cause before you
restart Caddy again.

For the tailscale gate, MagicDNS and HTTPS certificates must be on in the
Tailscale admin console, and `COMPOSE_FILE` must name
`compose.tailscale.yaml` so Caddy can reach tailscaled.

## You cannot get in

**The browser asks for the password again and again.** Behind basic auth,
the user name or hash is empty or wrong. With both empty, Caddy starts and
refuses every login. A hash that compose broke without a warning, because the
part after a `$` began with a digit, `.` or `/`, looks the same. Make a new
hash and keep it in single quotes.

**`502` on every page behind oauth2-proxy.** oauth2-proxy is not running.
`COMPOSE_PROFILES=oauth2-proxy` is missing from `.env`, or
`allowed-emails.txt` is missing and oauth2-proxy stopped at once. Read
`docker compose logs oauth2-proxy`. If `allowed-emails.txt` is a directory,
compose made it when the file was missing: `sudo rmdir allowed-emails.txt`,
write the file, and `docker compose up -d`.

**oauth2-proxy signs you in and then refuses you.** Your address is not in
`allowed-emails.txt`, or the provider gives a different one.
`docker compose logs oauth2-proxy` says why it refused.

**`502` on everything, with any gate, right after a start.** The backend or
frontend is not up yet. `docker compose ps` shows `starting` until the health
check passes.

**No answer at all behind the tailscale gate.** You are outside the tailnet,
which is the gate working. From inside, check `KASTEN_BIND_ADDRESS` is the
address `tailscale ip -4` prints.

## Notes do not save

**`Permission denied` in the backend log.** The containers run as uid and
gid 1000, and `data/` belongs to someone else. Give it to them:

```sh
sudo chown -R 1000:1000 data
```

**The backend warns `has no .jj directory, so saves are not recorded in any
history`.** Notes save, with no way back to an earlier version. Run step 4 of
[Self-host kasten](/how-to/self-host-kasten.md#4-give-the-vault-a-history).

**The backend logs `jj ... failed`.** The note saved, but jj did not record it.
The rest of the line is jj's own complaint. Run
`docker compose exec backend jj -R /vault status` to see it again.

## The page does not follow changes on disk

A note edited in the shell, or by an agent, should show up in an open tab on
its own. If it never does, something between the browser and
the backend is buffering `/api/events`. The stack's own Caddy leaves it alone;
look at whatever sits in front of it, and see
[Reverse-proxy routes](/reference/reverse-proxy-routes.md) for what it must not
do.

## The terminal is blank or refuses

**`Could not reach the shell at /term/ws.`** The WebSocket never opened. The
shell container is down (`docker compose ps`), the `/term/*` route is missing,
or the gate refused the upgrade because the session ran out. Reload the page,
sign in, and open the terminal again.

**`The shell closed the connection`.** The shell was there and ended. Open the
terminal again.

**The shell restarts again and again**, with
`mkdir: cannot create directory '//.config': Permission denied` in
`docker compose logs shell`. `KASTEN_UID` is not 1000, and the shell image has
no user for any other uid. Remove `KASTEN_UID` and `KASTEN_GID` from `.env`,
give `data/` to 1000 as above, and `docker compose up -d`.

**Claude Code, codex or dsh asks you to log in.** That happens once per shell
home. The `shell-home` volume keeps it across restarts and upgrades; if it asks
every time, the volume is being removed, which `docker compose down -v` does.

## Related

* [Self-host kasten](/how-to/self-host-kasten.md): the setup these checks assume
* [Connect an agent](/how-to/connect-an-agent.md#when-it-does-not-work): agents, tokens and connectors
* [Configuration](/reference/configuration.md): every variable named here
* [Security model](/explanation/security-model.md): why the gate refuses what it refuses
