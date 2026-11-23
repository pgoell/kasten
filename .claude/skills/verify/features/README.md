# kasten verification map

The flows of kasten that must always work, one file each. `run.sh` reads the
`- Journey:` line of each file and runs those journeys; it fails unless each
title matches exactly one test and every one passes.

## Baseline preconditions

- Docker answers and the image `kasten-postgres:17` exists (the Doctor in
  [SKILL.md](../SKILL.md)).
- Each journey starts from a copy of `e2e/vault`: `Welcome.md` links to
  `[[Garden]]` and holds the words "front door", `02 Projects/Garden.md` holds
  the todo "water the tomatoes", and `Long note.md` holds "Line 240 of filler".

## Driving conventions

- Journeys use ARIA roles and names (`getByRole("tab", { name, selected: true })`)
  and read the vault on disk or the API, never a mock of the app.
- A journey file and title are literal: keep the `- Journey:` line equal to the
  test's title when a journey is renamed, or `run.sh` stops.

## Features

- [Open a note](./open-a-note.md): the finder opens a note into the editor.
- [Edit and save](./edit-and-save.md): a typed line reaches the file on disk.
- [Follow a wikilink](./follow-a-wikilink.md): a link opens the note it names.
- [Add a todo](./add-a-todo.md): the todo prompt writes a todo to the store.
- [Search](./search.md): a content search opens the note on the matching line.
