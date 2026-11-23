# Add a todo

The todo pane's prompt takes a typed todo with its due date, priority and tag,
shows the line the vault gets, and on Enter writes the todo to the store, filed
under today's note.

## Sub-features

- `todo-prompt` adds a todo from the pane's `a` prompt.
- `todo-preview` shows the line before it is written.

## How to get to it (user POV)

- Press `<leader>gt` to open the todo pane, then `a`, type, Enter.

## Driving it with the e2e harness

Preconditions:

- `run.sh` reaches `Running N tests`.

- Journey: todos/pane/panel.spec.ts › takes the focus, previews the line the vault gets, and Enter adds it to today's note
- **Add.** The journey opens the pane, presses `a`, types
  `call the dentist due:<in 3 days> !high #health` and presses Enter. End
  state: the store's list for today's note (`GET /api/todos` through the
  journey's stack) holds the line with a new `🆔 kt-` id.

## Gotchas

- Todos live in Postgres, not in the note's lines: read the store, not the
  file.
- The store's field order differs from the typed order; compare the parsed
  line, as the journey does.
