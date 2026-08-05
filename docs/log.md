# Directory Update Log

## 2026-08-05

* **Creation**: Started this bundle. Structure follows Diátaxis, file format follows OKF v0.2.
* **Removal**: Deleted 14 documents describing Sieve, a newsletter digest platform that shares no code with kasten. They were `docs/vision.md`, five ADRs under `docs/adr/`, five architecture pages under `docs/architecture/`, and two files under `docs/superpowers/`.
* **Creation**: Added [Getting started](/tutorials/getting-started.md).
* **Creation**: Added [Add a database migration](/how-to/add-a-database-migration.md), [Regenerate the API types](/how-to/regenerate-the-api-types.md) and [Run the checks](/how-to/run-the-checks.md).
* **Creation**: Added [mise tasks](/reference/mise-tasks.md), [HTTP API](/reference/http-api.md) and [Configuration](/reference/configuration.md).
* **Creation**: Added [The vault and the derived index](/explanation/vault-and-derived-index.md) and [Two environments](/explanation/environments.md).
* **Update**: [HTTP API](/reference/http-api.md) gained `GET /api/files/{path}`, which reads one note, and lost the line saying note content is not exposed.
* **Update**: [HTTP API](/reference/http-api.md) gained `PUT /api/files/{path}`, which writes one note back to the vault, and lost the line saying nothing writes yet.
* **Update**: [Getting started](/tutorials/getting-started.md) gained a step that opens a note and edits it. Its "what you cannot do yet" section no longer claims that clicking a note does nothing and that saving is missing.
* **Update**: [Getting started](/tutorials/getting-started.md) describes the save state as the ring in the status bar rather than the words "Saved" and "Unsaved changes", which the bar no longer carries.
* **Creation**: Added [Recover an earlier version of a note](/how-to/recover-an-earlier-version.md), now that a save is recorded in the vault's jj repo.
* **Update**: [HTTP API](/reference/http-api.md) says what a write records in jj, and that a vault without a repo is written to just the same.
* **Update**: [Getting started](/tutorials/getting-started.md) gained an optional step that gives the vault a history.
* **Update**: [The vault and the derived index](/explanation/vault-and-derived-index.md) gained the consequence that a note's history lives with the note and not in a table.
* **Creation**: Added [Live preview and the vim mode](/explanation/live-preview.md), now that the editor renders markdown rather than colouring it.
* **Update**: [Getting started](/tutorials/getting-started.md) says the note is rendered, and that `i` shows the markdown behind the line as well as starting insert mode.
* **Update**: [Getting started](/tutorials/getting-started.md) says tables, images and code fences keep their syntax, which live preview does not render.
* **Update**: [Live preview and the vim mode](/explanation/live-preview.md) says why the mode effect is dispatched a microtask late, after a synchronous dispatch was found to kill the vim plugin on leaving visual mode.
* **Creation**: Added [Editor keys](/reference/editor-keys.md), now that space is the leader key and the editor carries formatting commands and a navigable file tree.
* **Update**: [Getting started](/tutorials/getting-started.md) folds the tree with space then `b` rather than Ctrl+B, which now means bold, and points at the new keys page.
* **Update**: [Editor keys](/reference/editor-keys.md) gained `<leader>e`, which moves the focus to the file tree, and a section on Tab and Shift+Tab. The file tree section no longer says Tab reaches the tree, because Tab now indents.
* **Update**: [Live preview and the vim mode](/explanation/live-preview.md) says why a drawn bullet leaves with the dash it stands in for while a drawn blockquote bar stays, and where a nested item's indent comes from once its spaces are hidden.
* **Update**: [Getting started](/tutorials/getting-started.md) says the editor holds the cursor from the moment the page loads, and reaches the tree with space then `e` rather than by clicking it.
* **Update**: [Getting started](/tutorials/getting-started.md) says the foot of the window carries the weekday, date, calendar week and time beside the save ring.
