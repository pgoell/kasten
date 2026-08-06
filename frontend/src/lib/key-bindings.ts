import { BOLD, HIGHLIGHT, ITALIC, type MarkSpec, STRIKE } from "@/lib/format-commands";

/**
 * Every binding the app owns, in one table.
 *
 * Four things read this: the vim registrations in `editor-commands.ts`, the
 * file tree in `file-explorer.tsx`, the help panel behind `<leader>?`, and the
 * reference page in `docs/`. Keeping one table is what stops those four
 * drifting apart. The first two resolve the keys; the other two describe them.
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
  /** The note to rename, which the tree knows and the editor leaves to the route. */
  renameNote(startPath?: string): void;
  /** Open the finder, which ranks the whole vault and needs nothing to start from. */
  findNote(): void;
  /** Open search over note content, which starts from nowhere the way the finder does. */
  searchNotes(): void;
  /** Show what links to the open note. Needs one open, as its opposite does. */
  showBacklinks(): void;
  /** Show what the open note links to, which is that pair read the other way. */
  showLinksOut(): void;
  /** Start a tab holding one empty pane, and go to it. */
  createTab(): void;
  /** Put an empty pane beside this one, and move to it. */
  splitRight(): void;
  /** Put an empty pane under this one, and move to it. */
  splitDown(): void;
  /** Move to the next pane of this tab, wrapping at the end. */
  nextPane(): void;
  nextTab(): void;
  prevTab(): void;
  /** Go to one tab by position, counting from zero. `TAB_KEYS` names the keys. */
  goToTab(index: number): void;
}

/**
 * What the file tree reaches for, which is the leader's commands and one more.
 *
 * `renameFolder` sits out of `EditorCommands` because that interface is the
 * table a `LeaderBinding` names a command in, and no leader sequence names this
 * one. The tree is the only place that can point at a folder, so the tree is
 * the only place the command exists, and its key is a bare `r`.
 */
export interface TreeCommands extends EditorCommands {
  renameFolder(startPath: string): void;
}

/**
 * The commands a leader sequence can name, which is every one taking no
 * argument.
 *
 * `goToTab` is the exception and is left out: it names a tab by number, and the
 * ten keys that reach it are `TAB_KEYS` rather than rows of this table. Saying
 * so here is what lets the file tree run any binding it resolves by calling it
 * with nothing.
 */
export type LeaderCommand = Exclude<keyof EditorCommands, "goToTab">;

export interface LeaderBinding {
  /** The keys pressed after the leader, in order. Usually one. */
  key: string;
  label: string;
  command: LeaderCommand;
}

export const LEADER: readonly LeaderBinding[] = [
  { key: "b", label: "Toggle the file tree", command: "toggleTree" },
  // Two letters, the way Obsidian and every vim config spell a create: `c` for
  // the group and `f` for the thing. Both the editor and the tree resolve a
  // sequence, so nothing else has to be single-key from here on.
  { key: "cf", label: "Create a note", command: "createNote" },
  // The other half of the `c` group. A tab is a thing you create, so it belongs
  // beside the note rather than under a group of its own.
  { key: "ct", label: "Create a tab", command: "createTab" },
  // Tab used to be the way into the tree, and binding it to indent took that
  // away. This is the way back in, and it unfolds the panel first.
  { key: "e", label: "Focus the file tree", command: "focusTree" },
  // Telescope spells `find_files` this way, and the shape matches `cf` and `rf`
  // beside it: the group letter, then the thing.
  { key: "ff", label: "Find a note", command: "findNote" },
  // Telescope spells `live_grep` this way, and it lands beside `ff` for the
  // reason the two belong together: one finds a note by its name, the other by
  // what is written in it.
  { key: "fg", label: "Search note content", command: "searchNotes" },
  // `g` for go, then the direction. Obsidian calls the pair backlinks and
  // outgoing links, and `b` and `o` are those two words. Neither can be a bare
  // letter: `b` folds the tree away and `o` opens a line in vim.
  { key: "gb", label: "Show what links here", command: "showBacklinks" },
  { key: "go", label: "Show what this note links to", command: "showLinksOut" },
  // tmux's own next-pane key. Cycling and not `hjkl`: which pane is left of
  // this one is a question about rectangles on screen, and the tree these are
  // laid out from does not answer it. Walking them in order needs no geometry
  // at all.
  //
  // ponytail: cycle rather than move directionally, upgrade to `<leader>wh`
  // and friends off `getBoundingClientRect` if three panes ever make this a
  // guessing game.
  { key: "o", label: "Move to the next pane", command: "nextPane" },
  { key: "p", label: "Toggle live preview", command: "togglePreview" },
  // One key doing the whole retreat, because there is one obvious thing to
  // shut at any moment: the note, then the pane it sat in, then the tab that
  // pane was the last of. Pressing it repeatedly walks back out.
  { key: "q", label: "Close the note, then the pane, then the tab", command: "closeNote" },
  // `rf` beside `cf`: same shape, the group letter then the thing, so renaming
  // a file sits next to creating one rather than somewhere else entirely.
  { key: "rf", label: "Rename the note", command: "renameNote" },
  // tmux walks its windows with `n` and `p`, and both are spent here: `p` is
  // live preview and `n` is too close to it to be worth the confusion. `h` and
  // `l` are the directions vim already reads as left and right.
  { key: "th", label: "Go to the previous tab", command: "prevTab" },
  { key: "tl", label: "Go to the next tab", command: "nextTab" },
  // tmux's own split keys, kept because they are the two this app is imitating
  // and because the shape of each character says which way the pane divides.
  // Both are shifted, which is no obstacle: vim names a key by
  // `KeyboardEvent.key`, and `?` below has been one all along.
  { key: "%", label: "Split the pane left and right", command: "splitRight" },
  { key: '"', label: "Split the pane top and bottom", command: "splitDown" },
  { key: "?", label: "Show the keys", command: "showHelp" },
];

/**
 * The digits that jump straight to a tab, in the order the tabs sit in.
 *
 * tmux's arrangement, and the keyboard's: `1` through `9` are the first nine
 * and `0` is the tenth, because that is where the key is on the row rather than
 * what the character means. An eleventh tab is reached with `th` and `tl`.
 *
 * Its own table rather than ten rows in `LEADER`, because every binding there
 * names a command taking nothing and these ten name one command taking a
 * number. `editor-commands.ts` registers them in a loop of their own.
 */
export const TAB_KEYS: readonly string[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];

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
 * Following a wikilink, which is vim's own go-to-file rather than a leader key.
 *
 * Display only, the way INDENT is: `editor.tsx` carries the mapping, because
 * what it reaches is a handler on the view and not one of the commands above.
 */
export const FOLLOW: readonly { key: string; label: string }[] = [
  { key: "gf", label: "Open the note the wikilink names" },
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
  // Bare letters, not leader sequences: the tree's own keys are single presses.
  // `<leader>cf` and `<leader>rf` still reach these from anywhere, and `r` is
  // the only way to a folder, which is a thing only the tree can point at.
  { key: "c", label: "New note in the folder the cursor is in" },
  { key: "f", label: "Find a note by name" },
  // `s` and not `g`: `g` opens `gg` here, so it cannot be a command of its own.
  { key: "s", label: "Search every note's content" },
  { key: "r", label: "Rename the note or folder under the cursor" },
  { key: "q", label: "Close the file tree" },
  { key: "Escape", label: "Back to the editor" },
];
