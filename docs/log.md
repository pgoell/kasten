# Directory Update Log

## 2026-08-05

* **Creation**: Started this bundle. Structure follows Diátaxis, file format follows OKF v0.2.
* **Removal**: Deleted 14 documents describing Sieve, a newsletter digest platform that shares no code with kasten. They were `docs/vision.md`, five ADRs under `docs/adr/`, five architecture pages under `docs/architecture/`, and two files under `docs/superpowers/`.
* **Creation**: Added [Getting started](/tutorials/getting-started.md).
* **Creation**: Added [Add a database migration](/how-to/add-a-database-migration.md), [Regenerate the API types](/how-to/regenerate-the-api-types.md) and [Run the checks](/how-to/run-the-checks.md).
* **Creation**: Added [mise tasks](/reference/mise-tasks.md), [HTTP API](/reference/http-api.md) and [Configuration](/reference/configuration.md).
* **Creation**: Added [The vault and the derived index](/explanation/vault-and-derived-index.md) and [Two environments](/explanation/environments.md).
* **Update**: [HTTP API](/reference/http-api.md) gained `GET /api/files/{path}`, which reads one note, and lost the line saying note content is not exposed.
