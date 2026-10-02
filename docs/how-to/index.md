# How-to guides

Recipes for jobs you already know you need. Each one assumes you have kasten
running; if you do not, start with [Self-host on a server](/tutorials/self-host-on-a-server.md)
to run it for real, or [Getting started](/tutorials/getting-started.md) to work
on its code.

* [Add a database migration](add-a-database-migration.md) - generate, review and apply an Alembic migration against the dev database
* [Back up and restore](back-up-and-restore.md): know the three things a self-hosted kasten holds, copy them nightly with tar or push the vault's history with jj, and bring them back
* [Capture from your phone](capture-from-your-phone.md) - install the capture page on Android and share links and text into today's dump, or put it on an iPhone's home screen
* [Connect an agent](connect-an-agent.md): mint, list and revoke a token, point Claude Code, codex, another MCP client or curl at the vault, install the skill where MCP is off, or send claude.ai and chatgpt.com through the OAuth flow
* [Cut a release](cut-a-release.md) - pick the next version from the commits, bump it, tag it and watch it deploy
* [Deploy to the VPS](deploy-to-the-vps.md): the maintainer's own deployment, as a worked example: bootstrap dev and prod on the box, on amd64 or arm64, deploy day to day, and prove the shell is still behind its gate
* [Import an Anki deck](import-an-anki-deck.md) - turn an .apkg export into markdown notes, and know what does not survive the trip
* [Recover an earlier version of a note](recover-an-earlier-version.md) - read back or restore a note as it was before a save overwrote it
* [Regenerate the API types](regenerate-the-api-types.md) - rebuild the frontend's TypeScript types after changing a backend endpoint
* [Run the checks](run-the-checks.md) - run the linters, tests and type checks, and get past the two ways the git hooks go wrong
* [Self-host kasten](self-host-kasten.md): run kasten on one machine of your own, amd64 or arm64, behind basic auth, oauth2-proxy or Tailscale
* [Troubleshoot a self-hosted kasten](troubleshoot-self-hosting.md): find why the stack will not start, get a certificate, let you in, save a note or open a terminal
* [Upgrade kasten](upgrade-kasten.md): move to a new release, pinned or on latest, check it, and roll back
* [Write a practice exam](write-a-practice-exam.md) - put a set of questions in the vault so kasten can ask them one at a time and score the sitting

Why the two environments are built in opposite ways is
[Two environments](/explanation/environments.md), not a how-to.
