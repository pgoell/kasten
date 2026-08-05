import { BOLD, HIGHLIGHT, ITALIC, type MarkSpec, STRIKE } from "@/lib/format-commands";

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
  togglePreview(): void;
  closeNote(): void;
  showHelp(): void;
  focusTree(): void;
  /** The folder the prompt opens on, which only the file tree knows. */
  createNote(startPath?: string): void;
}

export interface LeaderBinding {
  /** The keys pressed after the leader, in order. Usually one. */
  key: string;
  label: string;
  command: keyof EditorCommands;
}

export const LEADER: readonly LeaderBinding[] = [
  { key: "b", label: "Toggle the file tree", command: "toggleTree" },
  // Two letters, the way Obsidian and every vim config spell a create: `c` for
  // the group and `f` for the thing. Both readers of this table handle the
  // sequence, so nothing else has to be single-key from here on.
  { key: "cf", label: "Create a note", command: "createNote" },
  // Tab used to be the way into the tree, and binding it to indent took that
  // away. This is the way back in, and it unfolds the panel first.
  { key: "e", label: "Focus the file tree", command: "focusTree" },
  { key: "p", label: "Toggle live preview", command: "togglePreview" },
  { key: "q", label: "Save and close the note", command: "closeNote" },
  { key: "?", label: "Show the keys", command: "showHelp" },
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
 * Display only, the way TREE is: `indentWithTab` carries the binding itself.
 * It sits here so the panel and the reference page keep describing every key
 * the editor answers, and not only the ones registered through vim.
 */
export const INDENT: readonly { key: string; label: string }[] = [
  { key: "Tab", label: "Indent the line, nesting a list item" },
  { key: "Shift Tab", label: "Lift the line back out" },
];

/**
 * What the keys do inside the file tree.
 *
 * Display only. The panel resolves its keys by name in one switch, so there is
 * nothing here for it to read; this exists so the help panel and the reference
 * page describe the same tree the code implements.
 */
export const TREE: readonly { key: string; label: string }[] = [
  { key: "j / k", label: "Move the cursor down or up" },
  { key: "h", label: "Collapse the folder, or go to its parent" },
  { key: "l", label: "Expand the folder, or open the note" },
  { key: "Enter", label: "Open the note under the cursor" },
  { key: "gg / G", label: "Go to the first or last row" },
  { key: "q", label: "Close the file tree" },
  { key: "Escape", label: "Back to the editor" },
];
