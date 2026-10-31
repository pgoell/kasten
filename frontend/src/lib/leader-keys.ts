import type { EditorCommands, LeaderCommand } from "@/lib/key-bindings";

/**
 * The leader table: every sequence typed after the space bar that names a
 * command. The editor resolves it through vim; the other panes go through
 * `leaderAction` and `leaderPrefix`.
 */

export interface LeaderBinding {
  /** The keys pressed after the leader, in order. Usually one. */
  key: string;
  label: string;
  command: LeaderCommand;
}

export const LEADER: readonly LeaderBinding[] = [
  // A bare letter: it is a mode, not a place, and it changes what the searches answer.
  { key: "a", label: "Show the archive in searches", command: "toggleArchive" },
  { key: "b", label: "Toggle the file tree", command: "toggleTree" },
  { key: "cb", label: "Add a book to the inbox", command: "uploadBook" },
  { key: "cc", label: "Open the chat with Claude Code", command: "openChat" },
  // Not a bare `d`: vim would fire it at once and shadow `df` and `du`.
  { key: "cd", label: "Capture a thought into today's dump", command: "captureDump" },
  { key: "cf", label: "Create a note", command: "createNote" },
  { key: "cm", label: "Import markdown files into the inbox", command: "importNotes" },
  { key: "cs", label: "Open a terminal", command: "openTerminal" },
  { key: "ct", label: "Create a tab", command: "createTab" },
  { key: "cw", label: "Import a web page into the inbox", command: "importPage" },
  { key: "df", label: "Delete the note", command: "deleteNote" },
  // Not a bare `u`: vim owns undo, and a delete is a vault write the buffer's undo cannot see.
  { key: "du", label: "Undo the last delete", command: "restoreDeleted" },
  // Unfolds the panel first.
  { key: "e", label: "Focus the file tree", command: "focusTree" },
  { key: "E", label: "Show the open note in the file tree", command: "revealTree" },
  // Opens the reader, not the note.
  { key: "fb", label: "Find a book", command: "findBook" },
  { key: "ff", label: "Find a note", command: "findNote" },
  { key: "fg", label: "Search note content", command: "searchNotes" },
  { key: "ft", label: "Find a todo", command: "findTodos" },
  { key: "fm", label: "Find by meaning", command: "findMeaning" },
  { key: "ga", label: "Open the overview", command: "openOverview" },
  // Not a bare `b` or `o`: `b` folds the tree and `o` opens a line in vim.
  { key: "gb", label: "Show what links here", command: "showBacklinks" },
  // Over the pane, not beside it: the note it reads is a config note, not the book's.
  { key: "gc", label: "Read the current book", command: "openReadingBook" },
  { key: "gd", label: "Open today's note", command: "openDaily" },
  { key: "ge", label: "Sit this note as a practice exam", command: "openExam" },
  // Doubled: vim already spends `gg` on going to the top.
  { key: "gg", label: "Open the graph of the whole vault", command: "openGraph" },
  { key: "gh", label: "Show this note's history beside it", command: "openHistory" },
  { key: "gl", label: "Show the graph around this note", command: "openLocalGraph" },
  { key: "gm", label: "Open this month's note", command: "openMonthly" },
  { key: "go", label: "Show what this note links to", command: "showLinksOut" },
  { key: "gp", label: "Show this person's card beside their note", command: "openPerson" },
  { key: "gq", label: "Open this quarter's note", command: "openQuarterly" },
  // The book is the note's path with the suffix swapped.
  { key: "gr", label: "Read this note's book beside it", command: "openBook" },
  { key: "gs", label: "Open the review pane", command: "openReview" },
  { key: "gt", label: "Open the todo pane", command: "openTodos" },
  { key: "gf", label: "Open the log", command: "openLog" },
  { key: "gk", label: "Open the finance pane", command: "openFinance" },
  { key: "gv", label: "Watch this note's video beside it", command: "openVideo" },
  { key: "gw", label: "Open this week's note", command: "openWeekly" },
  { key: "gy", label: "Open this year's note", command: "openYearly" },
  // Answered from the boxes on screen (pane-direction.ts), not the layout tree, which gets a square of four wrong.
  { key: "h", label: "Move to the pane on the left", command: "paneLeft" },
  { key: "j", label: "Move to the pane below", command: "paneDown" },
  { key: "k", label: "Move to the pane above", command: "paneUp" },
  { key: "l", label: "Move to the pane on the right", command: "paneRight" },
  {
    key: "H",
    label: "Swap this pane with the one on the left, or move it to the left edge",
    command: "movePaneLeft",
  },
  {
    key: "J",
    label: "Swap this pane with the one below, or move it to the bottom edge",
    command: "movePaneDown",
  },
  {
    key: "K",
    label: "Swap this pane with the one above, or move it to the top edge",
    command: "movePaneUp",
  },
  {
    key: "L",
    label: "Swap this pane with the one on the right, or move it to the right edge",
    command: "movePaneRight",
  },
  // Wraps, unlike the four directions, which stop at the edge.
  { key: "o", label: "Move to the next pane", command: "nextPane" },
  { key: "p", label: "Toggle live preview", command: "togglePreview" },
  { key: "q", label: "Close the note, then the pane, then the tab", command: "closeNote" },
  { key: "rf", label: "Rename the note", command: "renameNote" },
  // Not a bare `r`: vim would fire it at once and shadow `rf`.
  { key: "rr", label: "Read this pane word by word (RSVP)", command: "openRsvp" },
  // A key, not only a palette row: a palette-only command needs a hand-written row.
  { key: "rh", label: "Read word by word from here (RSVP)", command: "rsvpFromHere" },
  // tmux's `n` and `p` are spent here, `p` on live preview.
  { key: "th", label: "Go to the previous tab", command: "prevTab" },
  { key: "tl", label: "Go to the next tab", command: "nextTab" },
  // A bare letter: `gv` opens the player and this drives it.
  { key: "v", label: "Play or pause this note's video", command: "toggleVideo" },
  // Not under `c`: it creates nothing in the vault, it hands a copy to the browser.
  { key: "w", label: "Download what this pane holds as a file", command: "exportNote" },
  // Hides the other panes, which keep what they hold.
  { key: "z", label: "Draw this pane on its own, or put the tab back", command: "zoomPane" },
  // Shifted keys: vim matches `KeyboardEvent.key`, so the character is what counts.
  { key: "%", label: "Split the pane left and right", command: "splitRight" },
  { key: '"', label: "Split the pane top and bottom", command: "splitDown" },
  { key: "?", label: "Show the keys", command: "showHelp" },
  // Leader, then `:`. A bare `:` still opens vim's ex prompt.
  { key: ":", label: "Run a command by name", command: "openPalette" },
];

/**
 * How a leader sequence reads on screen: `Space c f`, spaced so `cf` reads as
 * two keys. The help panel and the palette both print it.
 */
export function spelled(key: string): string {
  return `Space ${[...key].join(" ")}`;
}

/** The tab digits in tab order. `0` is the tenth tab, as on the keyboard row. */
export const TAB_KEYS: readonly string[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];

/** A name no leader sequence can spell, since the space keeps it apart from every key. */
export const TAB_DIGITS = "tab digits";

/**
 * The leader in the columns the which-key and help panels draw. A key named
 * nowhere here is not drawn, and a test fails until a new binding is listed.
 */
export const LEADER_COLUMNS: readonly { title: string; keys: readonly string[] }[] = [
  { title: "Find", keys: ["ff", "fg", "fm", "fb", "ft", "a", ":", "?"] },
  { title: "Create", keys: ["cf", "cd", "cw", "cm", "cb", "ci", "cv", "cc", "cs"] },
  {
    title: "Go to",
    keys: [
      "ga",
      "gd",
      "gw",
      "gm",
      "gq",
      "gy",
      "gg",
      "gl",
      "gb",
      "go",
      "gh",
      "gr",
      "gc",
      "gp",
      "gv",
      "ge",
      "gs",
      "gt",
      "gf",
      "gk",
      "e",
      "E",
    ],
  },
  { title: "Tabs", keys: ["ct", "tl", "th", TAB_DIGITS] },
  {
    title: "Panes",
    keys: ["%", '"', "h", "j", "k", "l", "H", "J", "K", "L", "o", "z", "q", "b"],
  },
  {
    title: "This note",
    keys: [
      "rf",
      "df",
      "du",
      "w",
      "rr",
      "rh",
      "p",
      "v",
      "=",
      "x",
      "i",
      "@",
      "so",
      "sp",
      "sx",
      "sb",
      "sw",
      "sv",
      "sr",
    ],
  },
];

/**
 * What a leader sequence reaches, or null. The one place both tables answer, so
 * no pane can come to own half the leader. `LEADER_EDITS` stays out: it writes to a buffer.
 */
export function leaderAction(typed: string, commands: EditorCommands): (() => void) | null {
  const tab = TAB_KEYS.indexOf(typed);
  if (tab !== -1) return () => commands.goToTab(tab);

  const binding = LEADER.find((entry) => entry.key === typed);
  return binding ? () => commands[binding.command]() : null;
}

/**
 * Whether more keys could still finish the sequence, so it waits rather than
 * being dropped. Reads `LEADER` alone: a tab key prefixes nothing.
 */
export function leaderPrefix(typed: string): boolean {
  return LEADER.some((entry) => entry.key.startsWith(typed));
}

/**
 * Whether the press is a modifier held down rather than a key. The browser
 * sends it before the letter, so a pane resolving by hand must skip it.
 */
export function heldModifier(key: string): boolean {
  return key === "Shift" || key === "Control" || key === "Alt" || key === "Meta";
}
