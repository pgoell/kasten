import type { EditorView } from "@codemirror/view";
import {
  BOLD,
  formatDocument,
  HIGHLIGHT,
  ITALIC,
  type MarkSpec,
  STRIKE,
} from "@/lib/format-commands";
import { cycleTodoAtCursor, stampIdAtCursor } from "@/lib/todo-commands";

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
  /**
   * Move a note into the vault's trash. The tree names one, the editor means
   * the one in the focused pane.
   */
  deleteNote(startPath?: string): void;
  /** Put the last deleted note or folder back where it was. */
  restoreDeleted(): void;
  /** Open the finder, which ranks the whole vault and needs nothing to start from. */
  findNote(): void;
  /** Open search over note content, which starts from nowhere the way the finder does. */
  searchNotes(): void;
  /** Open the todo overlay, which ranks every todo the vault holds. */
  findTodos(): void;
  /** Put the todo list in the focused pane, replacing whatever was there. */
  openTodos(): void;
  /** Show what links to the open note. Needs one open, as its opposite does. */
  showBacklinks(): void;
  /** Show what the open note links to, which is that pair read the other way. */
  showLinksOut(): void;
  /**
   * Open the note covering today at that grain, making it if the vault has none.
   *
   * Five members rather than one taking a period, because a `LeaderBinding`
   * names a command taking nothing, and five one-line rows in `LEADER` cost
   * less than the second table and the second vim loop the argument would
   * need. `periodic.ts` holds everything the five have in common.
   */
  openDaily(): void;
  openWeekly(): void;
  openMonthly(): void;
  openQuarterly(): void;
  openYearly(): void;
  /** Start a tab holding one empty pane, and go to it. */
  createTab(): void;
  /** Open a terminal in the focused pane, attached to a herdr session by name. */
  openTerminal(): void;
  /** Ask for a web address, and put the page it names in the inbox as a note. */
  importPage(): void;
  /** Put an empty pane beside this one, and move to it. */
  splitRight(): void;
  /** Put an empty pane under this one, and move to it. */
  splitDown(): void;
  /** Move to the next pane of this tab, wrapping at the end. */
  nextPane(): void;
  /** Move to the pane in that direction on screen, or stay put at the edge. */
  paneLeft(): void;
  paneDown(): void;
  paneUp(): void;
  paneRight(): void;
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
  /** Move a folder into the trash, and every note under it with it. */
  deleteFolder(startPath: string): void;
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
  // `s` for shell. The third member of the `c` group: `cf` is spent on a note
  // and `ct` on a tab, so the terminal takes the first letter of what it is.
  { key: "cs", label: "Open a terminal", command: "openTerminal" },
  // The other half of the `c` group. A tab is a thing you create, so it belongs
  // beside the note rather than under a group of its own.
  { key: "ct", label: "Create a tab", command: "createTab" },
  // The fourth of the `c` group, and a create like the rest of them: what it
  // leaves behind is a note. `w` for the web, the thing being made a note of,
  // the way `f` is a file and `s` a shell.
  { key: "cw", label: "Import a web page into the inbox", command: "importPage" },
  // The `d` group, shaped like `cf` and `rf`: the group letter, then the thing.
  // What it deletes is the note in the focused pane, and the tree's own `d`
  // reaches a note or a folder the cursor is on.
  { key: "df", label: "Delete the note", command: "deleteNote" },
  // Beside the delete rather than on a bare `u`, which vim owns as undo and
  // which this is not: a delete is a write to the vault and the buffer's undo
  // stack knows nothing about it. `u` for what the second letter means
  // everywhere else in the app.
  { key: "du", label: "Undo the last delete", command: "restoreDeleted" },
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
  // The third of the `f` group. A todo is another thing you go looking for by
  // name, so it sits beside the note and the line rather than under `g`, which
  // is where the pane holding the same list lives.
  { key: "ft", label: "Find a todo", command: "findTodos" },
  // `g` for go, then the direction. Obsidian calls the pair backlinks and
  // outgoing links, and `b` and `o` are those two words. Neither can be a bare
  // letter: `b` folds the tree away and `o` opens a line in vim.
  { key: "gb", label: "Show what links here", command: "showBacklinks" },
  // The rest of the `g` group is the five periodic notes, each on the first
  // letter of what it covers. `go` is spent above, so the month takes `m` and
  // nothing here has to move for it.
  { key: "gd", label: "Open today's note", command: "openDaily" },
  { key: "gm", label: "Open this month's note", command: "openMonthly" },
  { key: "go", label: "Show what this note links to", command: "showLinksOut" },
  { key: "gq", label: "Open this quarter's note", command: "openQuarterly" },
  // `g` for go, and the pane it goes to holds the todos. `ct` is spent on a
  // tab, which is why this is not under `c`.
  { key: "gt", label: "Open the todo pane", command: "openTodos" },
  { key: "gw", label: "Open this week's note", command: "openWeekly" },
  { key: "gy", label: "Open this year's note", command: "openYearly" },
  // The directions vim already reads, one press from the leader. Which pane is
  // left of this one is a question about rectangles rather than about the tree
  // the panes are laid out from, so `pane-direction.ts` answers it off their
  // boxes on screen. The tree cannot: it spells a square of four panes
  // `row[col[A,C], col[B,D]]`, and walking it rightward out of C arrives at B,
  // which is the pane diagonally across.
  { key: "h", label: "Move to the pane on the left", command: "paneLeft" },
  { key: "j", label: "Move to the pane below", command: "paneDown" },
  { key: "k", label: "Move to the pane above", command: "paneUp" },
  { key: "l", label: "Move to the pane on the right", command: "paneRight" },
  // tmux's own next-pane key, kept beside the four above rather than replaced
  // by them. It wraps, so it reaches every pane of the tab by repetition,
  // where a direction stops at the edge of the window.
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
    key: "sr",
    label: "Set this todo to rejected",
    run: (view) => cycleTodoAtCursor(view, "rejected"),
  },
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

/**
 * The modifiers a terminal chord is held with, in one place so retuning the
 * whole set is one edit.
 *
 * ctrl and shift because a terminal cannot transmit most of those chords, so
 * taking them costs the shell nothing. That is a reason to expect them to
 * work, not evidence that they are comfortable. Expect to change this.
 *
 * ponytail: the chord is a guess and one week of real use decides it. Changing
 * this or the table below carries `terminal-pane.tsx`, `key-help.tsx` and
 * `key-help.test.tsx` with it, all three deriving from these two exports. One
 * place does not follow and has to be edited by hand: the chord table in
 * `docs/reference/editor-keys.md`, which is prose that no code reads.
 */
export const TERMINAL_CHORD = {
  ctrlKey: true,
  shiftKey: true,
  altKey: false,
  metaKey: false,
};

export interface TerminalBinding {
  /**
   * `KeyboardEvent.key` while `TERMINAL_CHORD` is held, which for a letter is
   * the uppercase one: shift is down. `FORMAT` below carries the same trap.
   */
  key: string;
  label: string;
  command: LeaderCommand;
}

/**
 * What a chord reaches inside a focused terminal, before the PTY sees it.
 *
 * The leader is the space bar and a shell must receive the space bar, so
 * nothing kasten owns can reach into a focused terminal as a leader sequence.
 * These are the way out of one.
 */
export const TERMINAL: readonly TerminalBinding[] = [
  { key: "H", label: "Move to the pane on the left", command: "paneLeft" },
  { key: "J", label: "Move to the pane below", command: "paneDown" },
  { key: "K", label: "Move to the pane above", command: "paneUp" },
  { key: "L", label: "Move to the pane on the right", command: "paneRight" },
  { key: "O", label: "Move to the next pane", command: "nextPane" },
  // `closeNote` rather than a command of its own: it takes what a pane holds
  // out of it and removes the pane once it holds nothing, so this is one step
  // in from `<leader>q` on a note. Emptying rather than removing is what gives
  // a window holding only a terminal a way back to an editor, there being no
  // chord that splits. It does not kill the herdr session, because closing the
  // socket detaches a client and `herdr --session` reattaches to whatever is
  // still running in there.
  { key: "Q", label: "Take the terminal out of the pane", command: "closeNote" },
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
 * Following a wikilink, which is vim's own go-to-file rather than a leader key.
 *
 * Display only, the way INDENT is: `editor.tsx` carries the mapping, because
 * what it reaches is a handler on the view and not one of the commands above.
 */
export const FOLLOW: readonly { key: string; label: string }[] = [
  // Vim reads a bare Enter as `j^`, and off a link that is still what it does.
  { key: "gf / Enter", label: "Open the note the wikilink names" },
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
  // `d` for delete, and it reaches a folder the way `r` does, the tree being
  // the one place that can point at one.
  { key: "d", label: "Delete the note or folder under the cursor" },
  { key: "q", label: "Close the file tree" },
  { key: "Escape", label: "Back to the editor" },
];

/**
 * What the keys do inside the todo pane.
 *
 * Display only, the way `TREE` is: the pane resolves its own keys in one
 * switch. It lists the whole set the phase arrives at, so the reference page
 * and the help panel describe one pane rather than each other.
 */
export const TODO_PANE: readonly { key: string; label: string }[] = [
  { key: "j / k", label: "Move the cursor down or up" },
  { key: "Enter", label: "Open the note the todo is in" },
  { key: "x", label: "Cycle the todo under the cursor" },
  { key: "a", label: "Add a todo to today's note" },
  {
    key: "t",
    label: "Start a timer on the todo under the cursor, or stop the ones it has running",
  },
  { key: "d", label: "Show what was finished in the last seven days" },
  { key: "n", label: "Show one next action per task" },
  { key: "v", label: "Show the next saved view, or all todos again" },
  { key: "O", label: "Set the todo under the cursor to open" },
  { key: "P", label: "Set the todo under the cursor to doing" },
  { key: "X", label: "Set the todo under the cursor to done" },
  { key: "B", label: "Set the todo under the cursor to blocked" },
  { key: "R", label: "Set the todo under the cursor to rejected" },
  { key: "/", label: "Narrow the list" },
  { key: "q", label: "Close the pane" },
  { key: "Escape", label: "Back to the editor" },
];
