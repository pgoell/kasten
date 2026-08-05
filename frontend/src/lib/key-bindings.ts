import { BOLD, ITALIC, type MarkSpec, STRIKE } from "@/lib/format-commands";

/**
 * Every binding the app owns, in one table.
 *
 * Three things read this: the vim registrations in `editor-commands.ts`, the
 * help panel behind `<leader>?`, and the reference page in `docs/`. Keeping one
 * table is what stops those three drifting apart.
 */

/** What the leader keys reach for. The route supplies these. */
export interface EditorCommands {
  toggleTree(): void;
}

export interface LeaderBinding {
  /** The key pressed after the leader. */
  key: string;
  label: string;
  command: keyof EditorCommands;
}

export const LEADER: readonly LeaderBinding[] = [
  { key: "b", label: "Toggle the file tree", command: "toggleTree" },
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
 */
export const FORMAT: readonly FormatBinding[] = [
  { key: "<C-b>", label: "Bold", spec: BOLD },
  { key: "<C-i>", label: "Italic", spec: ITALIC },
  { key: "<C-S-x>", label: "Strikethrough", spec: STRIKE },
];
