# Follow a wikilink

A `[[wikilink]]` in a note opens the note it names in the pane, by
Ctrl+click, by `gf` in vim's normal mode and by a tap on a phone.

## Sub-features

- `link-click` opens the named note by Ctrl+click.
- `link-gf` opens it by `gf`, at a heading or behind an alias.
- `link-tap` opens it by a tap on a phone.

## How to get to it (user POV)

- Ctrl+click the link's text.
- Put the cursor on the link and press `gf`.
- On a phone, tap the link.

## Driving it with the e2e harness

Preconditions:

- `run.sh` reaches `Running N tests`.

- Journey: notes/notes.spec.ts › following a wikilink opens the note it names
- **Ctrl+click.** The journey opens `Welcome` and Ctrl+clicks "Garden". End
  state: the tab `Garden` is selected and `.cm-content` holds "water the
  tomatoes".
- **gf and tap.** `run.sh notes/notes.spec.ts panes/links.spec.ts -g "gf on a link with an alias|a tap on the alias"`.

## Gotchas

- A link to a note that does not exist makes one in the inbox on `gf`: check
  the vault for a stray note after a gf journey.
- The live preview hides the brackets; click the link's text, not `[[`.
