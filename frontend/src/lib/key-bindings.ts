import type { MoveMode } from "@/lib/move";

/**
 * The commands the route supplies, and the keys outside the editor. The keys in
 * the buffer are in `buffer-keys.ts`. The tables at the foot are display only,
 * read by the help panel and the reference page in `docs/`.
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
   * Unfold the tree to the focused pane's note and move its cursor there. The
   * cursor of `focusTree` stays put, which is wrong for a note reached by a link.
   */
  revealTree(): void;
  /** The folder the prompt opens on, which only the file tree knows. */
  createNote(startPath?: string): void;
  /** The note to rename, which the tree knows and the editor leaves to the route. */
  renameNote(startPath?: string): void;
  /** Move a note into the trash. The tree names it, the editor means the focused pane's. */
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
   * Open today's note at that grain, making it if the vault has none. One member
   * per grain, since a `LeaderBinding` takes no argument. `periodic.ts` has the rest.
   */
  openDaily(): void;
  /**
   * Log one line, such as `- 💧 250 ml`, under `## Log` in today's note, made if
   * missing. Palette only, so no key is bound.
   */
  logDrink(line: string): void;
  /** Open the food search on today's card, opening today's note first if needed. Palette only. */
  logFood(): void;
  /** Ask on today's card for a `mark` value, opening today's note first if needed. Palette only. */
  logWeight?(mark: string): void;
  openWeekly(): void;
  openMonthly(): void;
  openQuarterly(): void;
  openYearly(): void;
  /** Read the focused pane's note's book in a pane beside it. */
  openBook(): void;
  /**
   * Read the book `READING_NOTE` links, in the focused pane. Needs no note open.
   * A config note naming no readable book says why at the foot of the window.
   */
  openReadingBook(): void;
  /** Show the focused note's person card beside it. Does nothing for a note that is not a person. */
  openPerson(): void;
  /** List the jj changes of the focused note, beside it. Does nothing without a note open. */
  openHistory(): void;
  /** Put the graph of the whole vault in the focused pane. */
  openGraph(): void;
  /** Draw the graph around the focused note, beside it. Does nothing without a note open. */
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
  /** Swap with the pane in that direction, or stay at the edge. Nothing opens or closes. */
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
 * The leader's commands and one more. `renameFolder` sits out of `EditorCommands`
 * because no leader sequence can name a folder; only the tree can point at one.
 */
export interface TreeCommands extends EditorCommands {
  renameFolder(startPath: string): void;
  /** Move a folder into the trash, and every note under it with it. */
  deleteFolder(startPath: string): void;
  /** Move an image into the trash. Only the tree's cursor row can name one, so it sits out here. */
  deleteImage(startPath: string): void;
  /** Move a note or folder to `target` once confirmed. Only the tree names both ends. */
  moveRow(startPath: string, mode: MoveMode, target: string): void;
}

/**
 * Every command a leader sequence can name, each taking no argument. `goToTab` is
 * out: `TAB_KEYS` reaches it by number, and the file tree calls any binding with nothing.
 */
export type LeaderCommand = Exclude<
  keyof EditorCommands,
  "goToTab" | "logDrink" | "logFood" | "logWeight"
>;

/**
 * Ctrl and Shift, which a terminal cannot send most chords with, so the shell loses nothing.
 * ponytail: a guess that one week of use decides. Changing it also means `terminal-pane.tsx`,
 * `key-help.tsx`, `key-help.test.tsx`, and by hand the chord table in
 * `docs/reference/editor-keys/terminal.md`.
 */
export const TERMINAL_CHORD = {
  ctrlKey: true,
  shiftKey: true,
  altKey: false,
  metaKey: false,
};

export interface TerminalBinding {
  /**
   * `KeyboardEvent.key` under `TERMINAL_CHORD`: uppercase for a letter, as shift is down.
   * `FORMAT` in `buffer-keys.ts` has the same trap.
   */
  key: string;
  label: string;
  command: LeaderCommand;
}

/** Chords that act inside a focused terminal, since the leader (space) must reach the shell. */
export const TERMINAL: readonly TerminalBinding[] = [
  { key: "H", label: "Move to the pane on the left", command: "paneLeft" },
  { key: "J", label: "Move to the pane below", command: "paneDown" },
  { key: "K", label: "Move to the pane above", command: "paneUp" },
  { key: "L", label: "Move to the pane on the right", command: "paneRight" },
  { key: "O", label: "Move to the next pane", command: "nextPane" },
  // The leader cannot reach the palette from here, so it gets a chord too.
  { key: "P", label: "Run a command by name", command: "openPalette" },
  // closeNote, not a command of its own. It empties the pane and removes it only
  // once empty, which keeps an editor reachable. It leaves the herdr session
  // running: closing the socket detaches, and `herdr --session` reattaches.
  { key: "Q", label: "Take the terminal out of the pane", command: "closeNote" },
];

/** Display only: the panel resolves its keys in one switch, so this feeds the help panel. */
export const TREE: readonly { key: string; label: string }[] = [
  { key: "j / k", label: "Move the cursor down or up" },
  { key: "h", label: "Collapse the folder, or go to its parent" },
  { key: "l", label: "Expand the folder, or open the note" },
  { key: "Enter", label: "Open the note under the cursor" },
  { key: "gg / G", label: "Go to the first or last row" },
  // Bare letters: the tree's own keys are single presses. `<leader>cf` and
  // `<leader>rf` reach these from anywhere too.
  { key: "c", label: "New note in the folder the cursor is in" },
  { key: "f", label: "Find a note by name" },
  // `s` and not `g`: `g` opens `gg` here, so it cannot be a command of its own.
  { key: "s", label: "Search every note's content" },
  { key: "r", label: "Rename the note or folder under the cursor" },
  // Reaches a folder as `r` does: only the tree can point at one.
  { key: "d", label: "Delete the note or folder under the cursor" },
  { key: "q", label: "Close the file tree" },
  { key: "Escape", label: "Back to the editor" },
];

/**
 * The screens reached by typing their address rather than by pressing a key.
 * Listed here because no key or link opens them, so the panel is the only place they are named.
 */
export const SCREENS: readonly { key: string; label: string }[] = [
  { key: "/tokens", label: "Mint and revoke the tokens an agent reaches the vault with" },
  { key: "/review", label: "The review, on a page of its own, sized for a phone" },
  // The phone route, and the page Android's share sheet opens. `<leader>cd` does the same.
  { key: "/capture", label: "Capture a thought into today's dump, sized for a phone" },
];
/** Display only, the way `TREE` is: the pane resolves its keys in one switch. */
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
  // Board-only keys. The panel draws one flat list, so the labels say where they work.
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
 * How a terminal chord reads on screen, from `TERMINAL_CHORD`. `readable` in
 * `buffer-keys.ts` leaves a bare `"H"` alone, so this is the second spelling.
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
