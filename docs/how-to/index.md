# How-to guides

Recipes for jobs you already know you need. Each one assumes you have kasten
running; if you do not, start with [Getting started](/tutorials/getting-started.md).

* [Add a database migration](add-a-database-migration.md) - generate, review and apply an Alembic migration against the dev database
* [Recover an earlier version of a note](recover-an-earlier-version.md) - read back or restore a note as it was before a save overwrote it
* [Regenerate the API types](regenerate-the-api-types.md) - rebuild the frontend's TypeScript types after changing a backend endpoint
* [Run the checks](run-the-checks.md) - run the linters, tests and type checks, and get past the two ways the git hooks go wrong

Deploying is documented next to the compose files it describes, in
[deploy/README.md](../../deploy/README.md).
