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
 * Keys that act inside the buffer, each carrying its own work, since the route has no view to write into.
 * Read `LEADER` in `leader-keys.ts` before adding a leader key: vim fires a complete match at once.
 */

export interface LeaderEdit {
  /** The keys pressed after the leader, as in `LEADER`. */
  key: string;
  label: string;
  run: (view: EditorView) => void;
}

/** Leader keys that edit the buffer, so they carry their work rather than a command name. */
export const LEADER_EDITS: readonly LeaderEdit[] = [
  // `=` is free: `gq` is spent on the quarter's note.
  { key: "=", label: "Tidy the markdown in this note", run: formatDocument },
  { key: "i", label: "Stamp an id on this todo", run: stampIdAtCursor },
  // `@` addresses somebody, the agent.
  { key: "@", label: "Send this todo to the agent, or take it back", run: agentTodoAtCursor },
  // Toggles: on a link it makes an image, on an image the link back, and on
  // neither it opens the list of images. Writes to the buffer, so it is not in `LEADER`.
  { key: "ci", label: "Toggle an image at the cursor", run: toggleImageAtCursor },
  // `c` for the group, `v` for the video. Not `v` alone: a bare `v` plays and pauses.
  {
    key: "cv",
    label: "Write this note's video transcript into it",
    run: (view) => void writeTranscript(view),
  },
  // Bare `x` is vim's cut.
  { key: "x", label: "Cycle the todo on this line", run: cycleTodoAtCursor },
  // `s` for state. `p` stands for in progress, since `d` is spent on done.
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
  // `v` for verify, since `r` is spent on rejected.
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
 * Formatting binds in insert and visual mode only, since vim keeps these keys in
 * normal mode. Shifted keys name the uppercase letter, so `<C-S-h>` can never fire.
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
  // Shift-h, since Chrome spends ctrl+h on its history.
  { key: "<C-S-H>", label: "Highlight", spec: HIGHLIGHT },
  { key: "<C-S-X>", label: "Strikethrough", spec: STRIKE },
];

/** Display only: `indentWithTab` carries the binding, and this lists it for the panel and docs. */
export const INDENT: readonly { key: string; label: string }[] = [
  { key: "Tab", label: "Indent the line, nesting a list item" },
  { key: "Shift Tab", label: "Lift the line back out" },
];

/** Display only: `editor-follow.ts` carries the mapping, since it reaches a view handler. */
export const FOLLOW: readonly { key: string; label: string }[] = [
  // Vim reads a bare Enter as `j^`, and off a link that is still what it does.
  { key: "gf / Enter", label: "Open the note the wikilink names" },
];
