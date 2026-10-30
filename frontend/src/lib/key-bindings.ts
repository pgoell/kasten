import type { MoveMode } from "@/lib/move";

/**
 * The commands the route supplies, and the keys outside the editor.
 *
 * `EditorCommands` is the vocabulary every key table names a command in: the
 * leader in `leader-keys.ts`, the terminal chords and the file tree here. The
 * keys that act inside the editor's buffer are in `buffer-keys.ts`. The tables
 * at the foot are display only, read by the help panel behind `<leader>?` and
 * the reference page in `docs/`, so both describe every key a pane answers.
 */

/** What the leader keys reach for. The route supplies these. */
export interface EditorCommands {
  toggleTree(): void;
  togglePreview(): void;
  closeNote(): void;
  showHelp(): void;
  /** Open the palette, which lists every command here by name. */
  openPalette(): void;
  focusTree(): void;
  /**
   * Unfold the tree down to the note the focused pane holds, and put the tree's
   * cursor on its row.
   *
   * `focusTree` leaves the cursor where it was, which is right after you have
   * walked the tree and wrong after you have not: a note reached by the finder,
   * a wikilink or a backlink is somewhere the tree has never heard of, and the
   * panel goes on pointing at whatever row it opened on.
   */
  revealTree(): void;
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
  /** Open the book finder, which lists every note with an epub beside it. */
  findBook(): void;
  /** Open the ranked search, which finds notes by their words and by their meaning. */
  findMeaning(): void;
  /** Put the todo list in the focused pane, replacing whatever was there. The next three alike. */
  openTodos(): void;
  /** The log pane. */
  openLog(): void;
  /** The overview of the week's numbers. */
  openOverview(): void;
  /** The finance pane, on the bookings still to sort. */
  openFinance(): void;
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
  /**
   * Log one line, such as `- 💧 250 ml`, into today's note under `## Log`, made
   * there if the note has none. Reached by name from the palette only, which takes
   * it in the buffer when the note is open, so no key is bound to it.
   */
  logDrink(line: string): void;
  /**
   * Open the food search on today's card, opening today's note in the focused
   * pane first when it is not there. Reached by name from the palette only, the
   * way `logDrink` is.
   */
  logFood(): void;
  /**
   * Ask on today's card for the number the kind `mark` keeps as its last value, opening
   * today's note first where it is not there. Reached by name from the palette only.
   */
  logWeight?(mark: string): void;
  openWeekly(): void;
  openMonthly(): void;
  openQuarterly(): void;
  openYearly(): void;
  /** Read the focused pane's note's book in a pane beside it. */
  openBook(): void;
  /**
   * Read the book `READING_NOTE` links, in the focused pane, at its note's place.
   *
   * Needs no note open: the config note names the book, so the key works from
   * any pane. A config note that names nothing readable says why at the foot
   * of the window rather than doing nothing, the reader having asked for one
   * book in particular.
   */
  openReadingBook(): void;
  /**
   * Show the card for the person whose note the focused pane holds, beside it.
   *
   * Needs a person's note open, the way `openBook` needs a note with a book. A
   * press anywhere else does nothing: a card about a note that is not a person
   * is three empty lists.
   */
  openPerson(): void;
  /**
   * List the jj changes of the focused pane's note, in a pane beside it.
   *
   * Needs a note open, the way `openBook` does. A press anywhere else does
   * nothing: there is no note whose history to list.
   */
  openHistory(): void;
  /** Put the graph of the whole vault in the focused pane. */
  openGraph(): void;
  /**
   * Draw the graph around the focused pane's note, beside it.
   *
   * Needs a note open, the way `openBook` does. A press anywhere else does
   * nothing: there is no note to draw around.
   */
  openLocalGraph(): void;
  /** Play the video the focused pane's note links, in a pane beside it. */
  openVideo(): void;
  /** Play or pause that video without leaving the note, or nothing if none is open. */
  toggleVideo(): void;
  /** Read the focused pane word by word (RSVP), from where the last run stopped. */
  openRsvp(): void;
  /** The same from the selection, the cursor or the page on screen, saved as the place. */
  rsvpFromHere(): void;
  /** Pick an epub, put it in the inbox with a note, and open the note. */
  uploadBook(): void;
  /** Pick markdown files off disk, put them in the inbox, and open the first. */
  importNotes(): void;
  /** Hand the focused pane's note to the browser as a file to keep. */
  exportNote(): void;
  /** Sit the focused pane's note as a practice exam, in that pane. */
  openExam(): void;
  /** Open the review in the focused pane, on its list of decks. */
  openReview(): void;
  /** Show or hide the archive in the tree, the finder, search and the todos. */
  toggleArchive(): void;
  /** Start a tab holding one empty pane, and go to it. */
  createTab(): void;
  /** Open a terminal in the focused pane, attached to a herdr session by name. */
  openTerminal(): void;
  /** Open the chat with Claude Code in the focused pane. */
  openChat(): void;
  /** Ask for a web address, and put the page it names in the inbox as a note. */
  importPage(): void;
  /** Ask for one thought, and put it in the `## Dump` of today's note. */
  captureDump(): void;
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
  /**
   * Trade places with the pane in that direction on screen, or stand still at
   * the edge. Each pane carries what it holds with it, so this rearranges the
   * window without opening or closing anything.
   */
  movePaneLeft(): void;
  movePaneDown(): void;
  movePaneUp(): void;
  movePaneRight(): void;
  /** Draw the focused pane on its own, or put the tab back the way it was. */
  zoomPane(): void;
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
  /**
   * Move an image into the trash.
   *
   * Out here with the two above rather than in `EditorCommands`, and for the
   * same reason: a leader sequence names a command taking nothing, and the row
   * the tree's cursor is on is the only thing that can name an image. The image
   * pane deletes the one it is showing through a callback of its own.
   */
  deleteImage(startPath: string): void;
  /**
   * Move a note or a folder to `target`, once the reader has confirmed it.
   *
   * What a drop in the tree reaches for. Out here for the reason the three
   * above are: only the tree can name both ends of it.
   */
  moveRow(startPath: string, mode: MoveMode, target: string): void;
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
export type LeaderCommand = Exclude<
  keyof EditorCommands,
  "goToTab" | "logDrink" | "logFood" | "logWeight"
>;

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
 * `docs/reference/editor-keys/terminal.md`, which is prose that no code reads.
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
   * the uppercase one: shift is down. `FORMAT` in `buffer-keys.ts` carries the same trap.
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
  // The leader cannot reach the palette from here, so it gets a chord too.
  { key: "P", label: "Run a command by name", command: "openPalette" },
  // `closeNote` rather than a command of its own: it takes what a pane holds
  // out of it and removes the pane once it holds nothing, so this is one step
  // in from `<leader>q` on a note. Emptying rather than removing is what gives
  // a window holding only a terminal a way back to an editor, there being no
  // chord that splits. It does not kill the herdr session, because closing the
  // socket detaches a client and `herdr --session` reattaches to whatever is
  // still running in there.
  { key: "Q", label: "Take the terminal out of the pane", command: "closeNote" },
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
/**
 * The screens reached by typing their address rather than by pressing a key.
 *
 * Not bindings, and on the panel for exactly that reason: a screen nothing
 * links to and no key opens is one the app never mentions, and a URL you have
 * to read the documentation to learn is a URL you do not have.
 */
export const SCREENS: readonly { key: string; label: string }[] = [
  // The two screens with a URL and nothing else: no key, no link, no row in
  // the tree. Both are worth having and neither is worth a leader key, being
  // visited a few times a year, so the help panel is where they are named.
  // Without this the app says nowhere at all that `/tokens` exists.
  { key: "/tokens", label: "Mint and revoke the tokens an agent reaches the vault with" },
  { key: "/review", label: "The review, on a page of its own, sized for a phone" },
  // `<leader>cd` reaches the same dump from the app. This is the way in from a
  // phone, and the page Android's share sheet opens.
  { key: "/capture", label: "Capture a thought into today's dump, sized for a phone" },
];
export const TODO_PANE: readonly { key: string; label: string }[] = [
  { key: "j / k", label: "Move the cursor down or up" },
  { key: "Enter", label: "Open the note the todo is in" },
  { key: "x", label: "Cycle the todo under the cursor" },
  { key: "a", label: "Add a todo to today's note" },
  {
    key: "t",
    label: "Start a timer on the todo under the cursor, or stop the ones it has running",
  },
  { key: "@", label: "Send the todo under the cursor to the agent, or take it back" },
  { key: "d", label: "Show what was finished in the last seven days" },
  { key: "n", label: "Show one next action per task" },
  { key: "v", label: "Show the next saved view, or all todos again" },
  { key: "c", label: "Turn the list into the board, and back" },
  // The keys only the board takes. The panel draws one flat list, so the label
  // says where they work.
  { key: "g", label: "On the board: lanes by kind, or by project" },
  { key: "h / l", label: "On the board: the column to the left, or to the right" },
  { key: "p", label: "On the board: pick a project for the card" },
  { key: "O", label: "Set the todo under the cursor to open" },
  { key: "P", label: "Set the todo under the cursor to doing" },
  { key: "V", label: "Set the todo under the cursor to waiting for review" },
  { key: "X", label: "Set the todo under the cursor to done" },
  { key: "B", label: "Set the todo under the cursor to blocked" },
  { key: "W", label: "Set the todo under the cursor to waiting on somebody" },
  { key: "R", label: "Set the todo under the cursor to rejected" },
  { key: "b", label: "Pick the todo that blocks the one under the cursor" },
  { key: "m", label: "Move the todo under the cursor into its project's note" },
  { key: "/", label: "Narrow the list" },
  { key: "q", label: "Close the pane" },
  { key: "Escape", label: "Back to the editor" },
];

/** What the keys do inside the log pane. Display only, the way `TODO_PANE` is. */
export const LOG_PANE: readonly { key: string; label: string }[] = [
  { key: "j", label: "Move to the next entry" },
  { key: "k", label: "Move to the previous entry" },
  { key: "h", label: "Show the day before" },
  { key: "l", label: "Show the day after" },
  { key: "t", label: "Show today" },
  { key: "e", label: "Edit the entry under the cursor" },
  { key: "Enter", label: "Edit the entry under the cursor" },
  { key: "d", label: "Delete the entry under the cursor" },
  { key: "u", label: "Put back the entry last deleted" },
  { key: "o", label: "Open the note at the entry's line" },
  { key: "a", label: "Focus the amount field to log" },
  { key: "f", label: "Open the food search" },
  { key: "7", label: "Show trends over 7 days" },
  { key: "3", label: "Show trends over 30 days" },
  { key: "9", label: "Show trends over 90 days" },
  { key: "?", label: "Show the keys" },
  { key: "q", label: "Close the pane" },
  { key: "Escape", label: "Leave the edit without writing" },
];

/**
 * How a terminal chord reads on screen, `Ctrl Shift H`, built from `TERMINAL_CHORD`
 * so a retune moves every label that spells one.
 *
 * `readable` in `buffer-keys.ts` rewrites vim's spellings and leaves a bare `"H"`
 * alone, which is what a terminal chord is written as, so this is the second one.
 */
export function chordLabel(key: string): string {
  const held = [
    TERMINAL_CHORD.ctrlKey && "Ctrl",
    TERMINAL_CHORD.altKey && "Alt",
    TERMINAL_CHORD.shiftKey && "Shift",
    TERMINAL_CHORD.metaKey && "Meta",
  ].filter((word) => word !== false);

  return [...held, key].join(" ");
}

/** What the review pane answers, on the decks, a sitting and the parked cards. Display only. */
export const REVIEW_PANE: readonly { key: string; label: string }[] = [
  { key: "j / k", label: "Move down or up the decks, or the parked cards" },
  { key: "l", label: "Start the sitting on the deck under the cursor" },
  { key: "z a", label: "Fold or unfold the deck under the cursor" },
  { key: "h", label: "Back to the decks" },
  { key: "p", label: "Show the parked cards" },
  { key: "1 … 4", label: "Rate the card: again, hard, good, easy" },
  { key: "Space or Enter", label: "Show the answer, then grade Good" },
  { key: "s", label: "Park the card" },
  { key: "n", label: "Write a new question" },
  { key: "r", label: "Play the card's sound again" },
  { key: "u", label: "Undo the last answer, or put a parked card back" },
  { key: "o", label: "Open the parked card's note" },
  { key: "q", label: "Close the review" },
];

/** The keys that answer anywhere in the app, whatever pane holds the focus. Display only. */
export const ANYWHERE: readonly { key: string; label: string }[] = [
  { key: "?", label: "Show the keys (outside a text field)" },
  { key: "Space", label: "Show the leader keys, in normal mode" },
  { key: chordLabel("P"), label: "Run a command by name" },
];
