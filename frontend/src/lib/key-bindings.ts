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
