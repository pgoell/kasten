# How-to guides

Recipes for jobs you already know you need. Each one assumes you have kasten
running; if you do not, start with [Getting started](/tutorials/getting-started.md).

* [Add a database migration](add-a-database-migration.md) - generate, review and apply an Alembic migration against the dev database
* [Connect an agent](connect-an-agent.md) - mint a token and point Claude Code, codex, Claude Desktop or curl at the vault from another machine
* [Cut a release](cut-a-release.md) - pick the next version from the commits, bump it, tag it and watch it deploy
* [Deploy to the VPS](deploy-to-the-vps.md) - bootstrap dev and prod on the box, deploy day to day, and prove the shell is still behind its gate
* [Import an Anki deck](import-an-anki-deck.md) - turn an .apkg export into markdown notes, and know what does not survive the trip
* [Recover an earlier version of a note](recover-an-earlier-version.md) - read back or restore a note as it was before a save overwrote it
* [Regenerate the API types](regenerate-the-api-types.md) - rebuild the frontend's TypeScript types after changing a backend endpoint
* [Run the checks](run-the-checks.md) - run the linters, tests and type checks, and get past the two ways the git hooks go wrong
* [Write a practice exam](write-a-practice-exam.md) - put a set of questions in the vault so kasten can ask them one at a time and score the sitting

Why the two environments are built in opposite ways is
[Two environments](/explanation/environments.md), not a how-to.
