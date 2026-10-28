import type { EditorView } from "@codemirror/view";
import {
  BOLD,
  formatDocument,
  HIGHLIGHT,
  ITALIC,
  type MarkSpec,
  STRIKE,
} from "@/lib/editor/format-commands";
import { toggleImageAtCursor } from "@/lib/image";
import { agentTodoAtCursor, cycleTodoAtCursor, stampIdAtCursor } from "@/lib/todo/todo-commands";
import { writeTranscript } from "@/lib/video/transcript";

/**
 * The keys that act inside the editor's buffer rather than on the window.
 *
 * Each carries its own work, a function or a mark spec, because the route has
 * no view to write into; `editor-commands.ts` registers them with vim and hands
 * each one the view the key was typed into. `INDENT` and `FOLLOW` are display
 * only: CodeMirror binds `INDENT` in `lib/editor/note-view.ts` and the gf mapping for
 * `FOLLOW` sits in `lib/editor/editor-follow.ts`. The leader edits share the key
 * space of `LEADER` in `leader-keys.ts`, so read both when adding a key: vim
 * fires a complete match without waiting for the next press.
 */

export interface LeaderEdit {
  /** The keys pressed after the leader, as in `LEADER`. */
  key: string;
  label: string;
  run: (view: EditorView) => void;
}

/**
 * Leader keys that edit the buffer, so they name no command on `EditorCommands`.
 *
 * Every row of `LEADER` names something the route provides, and the route has
 * no view to write into. These carry the work itself instead, the way `FORMAT`
 * carries its spec, and `editor-commands.ts` hands each one the view the key
 * was typed into.
 */
export const LEADER_EDITS: readonly LeaderEdit[] = [
  // `=` is vim's own key for putting the formatting right, and `gq`, the other
  // one, is spent on the quarter's note.
  { key: "=", label: "Tidy the markdown in this note", run: formatDocument },
  // `i` is free after the leader, and cannot collide with vim's own `i`, which
  // needs no leader in front of it.
  { key: "i", label: "Stamp an id on this todo", run: stampIdAtCursor },
  // `@` for the agent, the mark that addresses somebody. Free after the leader,
  // and vim's own `@`, which replays a macro, needs no leader in front of it.
  { key: "@", label: "Send this todo to the agent, or take it back", run: agentTodoAtCursor },
  // The `c` group's shape, `ci` for create image, though the key toggles rather
  // than only creates: pressed on a link it makes an image of it, pressed on an
  // image it hands the link back, and pressed on neither it writes the brackets
  // and opens the list of images to fill them with. It sits here rather than in
  // `LEADER` because all three of those are writes to the buffer.
  { key: "ci", label: "Toggle an image at the cursor", run: toggleImageAtCursor },
  // `c` for the group and `v` for the video, the thing being taken in, the way
  // `cw` takes the web. Not under `v`: a bare `v` plays and pauses, and vim
  // fires a full match without waiting to see whether `vt` was meant.
  {
    key: "cv",
    label: "Write this note's video transcript into it",
    run: (view) => void writeTranscript(view),
  },
  // `x` is what obsidian-tasks, vim's own checkbox plugins and every todo.txt
  // binding spell a tick, and bare `x` in normal mode is vim's own cut.
  { key: "x", label: "Cycle the todo on this line", run: cycleTodoAtCursor },
  // The states the walk does not reach, and the two it does, each on one key.
  // `s` for state, and the group shape `cf`, `rf` and `ff` already have. The
  // second letter is the state's own first letter, `p` standing for in
  // progress because `d` is spent on done.
  { key: "so", label: "Set this todo to open", run: (view) => cycleTodoAtCursor(view, "open") },
  { key: "sp", label: "Set this todo to doing", run: (view) => cycleTodoAtCursor(view, "doing") },
  { key: "sx", label: "Set this todo to done", run: (view) => cycleTodoAtCursor(view, "done") },
  {
    key: "sb",
    label: "Set this todo to blocked",
    run: (view) => cycleTodoAtCursor(view, "blocked"),
  },
  {
    key: "sw",
    label: "Set this todo to waiting on somebody",
    run: (view) => cycleTodoAtCursor(view, "waiting"),
  },
  // `v` for verify, the one state not on its own first letter: `r` is spent on
  // rejected.
  {
    key: "sv",
    label: "Set this todo to waiting for review",
    run: (view) => cycleTodoAtCursor(view, "review"),
  },
  {
    key: "sr",
    label: "Set this todo to rejected",
    run: (view) => cycleTodoAtCursor(view, "rejected"),
  },
];

export interface FormatBinding {
  /** Vim's spelling of the key, not the browser's. */
  key: string;
  label: string;
  spec: MarkSpec;
}

/**
 * Formatting is bound in insert and visual mode only.
 *
 * Vim owns all three of these in normal mode, where they page up, walk the
 * jump list and decrement a number. Ours carry a context and the built-ins do
 * not, so normal mode keeps every one of them.
 *
 * The shifted pair name an uppercase letter, because vim builds its key name
 * from `KeyboardEvent.key` and that is the uppercase letter while shift is
 * held. `<C-S-h>` looks right and can never fire.
 */
/** Vim's spelling of a key is for vim. This is the one on the keyboard. */
export function readable(key: string) {
  return key
    .replace(/^<|>$/g, "")
    .replace("C-", "Ctrl ")
    .replace("S-", "Shift ")
    .replace(/-/g, " ");
}

export const FORMAT: readonly FormatBinding[] = [
  { key: "<C-b>", label: "Bold", spec: BOLD },
  { key: "<C-i>", label: "Italic", spec: ITALIC },
  // Highlight sits on shift-h rather than ctrl+h, which Chrome spends on its
  // history window and a page cannot reliably take back.
  { key: "<C-S-H>", label: "Highlight", spec: HIGHLIGHT },
  { key: "<C-S-X>", label: "Strikethrough", spec: STRIKE },
];

/**
 * Indenting, which is a plain CodeMirror binding rather than a vim one.
 *
 * Display only, the way `TREE` in `key-bindings.ts` is: `indentWithTab` carries
 * the binding itself. It sits here so the panel and the reference page keep
 * describing every key the editor answers, and not only the ones registered
 * through vim.
 */
export const INDENT: readonly { key: string; label: string }[] = [
  { key: "Tab", label: "Indent the line, nesting a list item" },
  { key: "Shift Tab", label: "Lift the line back out" },
];

/**
 * Following a wikilink, which is vim's own go-to-file rather than a leader key.
 *
 * Display only, the way INDENT is: `lib/editor/editor-follow.ts` carries the mapping, because
 * what it reaches is a handler on the view and not one of the commands above.
 */
export const FOLLOW: readonly { key: string; label: string }[] = [
  // Vim reads a bare Enter as `j^`, and off a link that is still what it does.
  { key: "gf / Enter", label: "Open the note the wikilink names" },
];
