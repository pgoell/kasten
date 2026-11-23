# Open a note

The note finder lists the vault's notes by name and opens the chosen one in the
focused pane, its tab selected and its text in the editor.

## Sub-features

- `open-finder` opens a note from the finder by keys.
- `open-tree` opens a note from the file tree.
- `open-thumb` opens the finder from the phone's thumb row.

## How to get to it (user POV)

- Press `<leader>ff` (Space, f, f) in normal mode, type a name, press Enter.
- Click a note in the file tree.
- On a phone, tap `find` in the thumb row.

## Driving it with the e2e harness

Preconditions:

- `run.sh` reaches `Running N tests`.

- Journey: notes/finder.spec.ts › the finder opens the note it finds
- **Open by finder.** `findNote(page, "Garden")` presses `<leader>ff`, fills the
  `Find note` dialog's combobox and presses Enter. End state: the tab
  `Garden` is selected and `.cm-content` holds "water the tomatoes".
- **Phone.** `run.sh notes/finder.spec.ts -g "thumb row"` runs the thumb row
  journey.

## Gotchas

- Keys sent before the editor holds the focus are lost on a loaded box;
  `findNote` waits for `.cm-content:focus`.
- The first load parses the whole bundle and can take past 5 s; `openApp`
  waits 15 s for the tree.
