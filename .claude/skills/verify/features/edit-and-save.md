# Edit and save a note

A line typed into the editor reaches the note's file on disk, with vim on or
off and by touch, with no save key.

## Sub-features

- `edit-vim` types in insert mode and saves on leaving it.
- `edit-plain` types with vim off.
- `edit-touch` types on a phone.
- `edit-undo` puts the old text back on disk with `u`.

## How to get to it (user POV)

- Open a note, press `G`, `o` and type, then Escape (vim on).
- Click into the note and type (vim off).
- Tap into the note on a phone and type.

## Driving it with the e2e harness

Preconditions:

- `run.sh` reaches `Running N tests`.

- Journey: notes/saving/edits.spec.ts › an edit reaches the file on disk
- **Type and leave insert mode.** The journey opens `Welcome`, presses
  Escape, `G`, `o`, types "A line typed by the e2e test." and presses Escape.
  End state: `Welcome.md` in the journey's vault holds the line.
- **Vim off and touch.** `run.sh notes/saving/edits.spec.ts -g "vim off|by touch|u after an edit"`.

## Gotchas

- The first save stamps frontmatter (`id`, `created`, `modified`) on top of
  the note: compare the body (`bodyOf` in `e2e/harness/app.ts`), not the
  whole file.
- A save is not instant: read the file with `expect.poll`, never after a
  fixed wait.
