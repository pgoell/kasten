# Search note content

The content search scans every note's lines for the typed words, lists the
hits, and opens the chosen note with the cursor on the matching line.

## Sub-features

- `search-keys` opens the search with `<leader>fg` and a hit with Enter.
- `search-palette` opens it from the palette with vim off and a hit by click.

## How to get to it (user POV)

- Press `<leader>fg`, type, press Enter on a hit.
- With vim off, Ctrl+Shift+P, `Search note content`, type, click a hit.

## Driving it with the e2e harness

Preconditions:

- `run.sh` reaches `Running N tests`.

- Journey: notes/finder.spec.ts › a content search opens the note on the line it matches
- **Search and open.** The journey presses `<leader>fg`, types "Line 240 of
  filler" and presses Enter on the hit the backend answers. End state: the tab
  `Long note` is selected and the line with the cursor holds "Line 240 of
  filler", in view.
- **Palette, vim off.** `run.sh notes/search/content-search.spec.ts -g "with vim off"`.

## Gotchas

- A todo's words are in the store, not its note, so the search does not find
  them.
- Several journeys in `notes/search/` answer the search from a route of their
  own; for proof of the backend's answer use the journey above.
