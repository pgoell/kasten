import type { EditorCommands, LeaderCommand } from "@/lib/key-bindings";

/**
 * The leader: every sequence typed after the space bar that names a command,
 * and how a typed sequence resolves.
 *
 * Five things read `LEADER`: the vim registrations in `editor-commands.ts`, the
 * file tree in `file-explorer.tsx`, the help panel behind `<leader>?`, the
 * palette and `/` menu in `palette.ts`, and the reference page in `docs/`.
 * Keeping one table is what stops them drifting apart. The editor resolves it
 * through vim; every other pane asks `leaderAction` and `leaderPrefix`, so none
 * of them needs to know the table's shape or that the tab digits sit beside it.
 */

export interface LeaderBinding {
  /** The keys pressed after the leader, in order. Usually one. */
  key: string;
  label: string;
  command: LeaderCommand;
}

export const LEADER: readonly LeaderBinding[] = [
  // `a` for archive, and a bare letter because it is a mode rather than a
  // place: it changes what every one of the four lookups below answers with,
  // the way `p` changes what the editor draws.
  { key: "a", label: "Show the archive in searches", command: "toggleArchive" },
  { key: "b", label: "Toggle the file tree", command: "toggleTree" },
  // The first of the `c` group, and a create like the rest: what it leaves
  // behind is a book in the vault and the note that reads it. `b` for the
  // book, beside `gr` which reads one.
  { key: "cb", label: "Add a book to the inbox", command: "uploadBook" },
  // `c` for chat, doubled the way `gg` is: the group's letter is the thing's
  // own first letter. It sits beside `cs`, the other pane with an agent in it.
  { key: "cc", label: "Open the chat with Claude Code", command: "openChat" },
  // `d` for the dump, the section of today's note the thought lands in. In the
  // `c` group because it creates: a paragraph, and the note and the section
  // where the day has neither. Not a bare `d`, which would shadow `df` and `du`:
  // vim fires a complete match without waiting for the next key.
  { key: "cd", label: "Capture a thought into today's dump", command: "captureDump" },
  // Two letters, the way Obsidian and every vim config spell a create: `c` for
  // the group and `f` for the thing. Both the editor and the tree resolve a
  // sequence, so nothing else has to be single-key from here on.
  { key: "cf", label: "Create a note", command: "createNote" },
  // Another of the `c` group. `m` for markdown, the thing being taken in, the
  // way `cw` below takes the web and `cb` above takes a book. A create like
  // the rest of them: what it leaves behind is a note.
  { key: "cm", label: "Import markdown files into the inbox", command: "importNotes" },
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
  // Shifted `e`, the way `H` is shifted `h`: the same place, reached harder.
  // `e` moves the focus and this moves the cursor with it, which is what VS
  // Code calls revealing a file and nvim-tree calls finding one.
  { key: "E", label: "Show the open note in the file tree", command: "revealTree" },
  // The fourth of the `f` group, for the reason `ft` is in it: a book is picked
  // by name. It opens the reader and not the note, which is what sets it apart
  // from `ff` and from `gr`, the key that needs the note open first. First in
  // the group because the list is alphabetical.
  { key: "fb", label: "Find a book", command: "findBook" },
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
  // `g` for go and `c` for current, the book you are in the middle of. Over
  // the pane like `fb`, not beside like `gr`: the note it reads is a config
  // note, and nothing on screen is the book's own note to keep beside it.
  { key: "gc", label: "Read the current book", command: "openReadingBook" },
  // The rest of the `g` group is the five periodic notes, each on the first
  // letter of what it covers. `go` is spent above, so the month takes `m` and
  // nothing here has to move for it.
  { key: "gd", label: "Open today's note", command: "openDaily" },
  // `g` for go and `e` for exam. It sits with `gr` rather than under `c`: both
  // turn the note in the pane into something else to read, and neither creates
  // anything until you finish.
  { key: "ge", label: "Sit this note as a practice exam", command: "openExam" },
  // `g` for go and `g` for graph. Doubled rather than on a letter of its own
  // because the letter was spent when the graph came, and `gg` is the key vim
  // already spends on going to the top of everything.
  { key: "gg", label: "Open the graph of the whole vault", command: "openGraph" },
  // `g` for go and `h` for history. It sits with `gp` and `gr`: all three put
  // something about the note in a pane beside it, here its older versions.
  { key: "gh", label: "Show this note's history beside it", command: "openHistory" },
  // `g` for go and `l` for local, Obsidian's word for the graph around a note.
  { key: "gl", label: "Show the graph around this note beside it", command: "openLocalGraph" },
  { key: "gm", label: "Open this month's note", command: "openMonthly" },
  { key: "go", label: "Show what this note links to", command: "showLinksOut" },
  // `g` for go and `p` for person. It sits with `gr` and `gv`: all three put
  // what the note is about in a pane beside the note itself.
  { key: "gp", label: "Show this person's card beside their note", command: "openPerson" },
  { key: "gq", label: "Open this quarter's note", command: "openQuarterly" },
  // `g` for go and `r` for read. The book is the note's path with the suffix
  // swapped, so the key needs nothing but a note in the focused pane.
  { key: "gr", label: "Read this note's book beside it", command: "openBook" },
  // `g` for go and `s` for study. `gr` is spent on the book, which is why the
  // review does not get the letter its own name starts with.
  { key: "gs", label: "Open the review pane", command: "openReview" },
  // `g` for go, and the pane it goes to holds the todos. `ct` is spent on a
  // tab, which is why this is not under `c`.
  { key: "gt", label: "Open the todo pane", command: "openTodos" },
  // `g` for go and `f` for food, the pane holding the day's food log.
  { key: "gf", label: "Open the log", command: "openLog" },
  // `g` for go and `v` for video. It sits with `gr` for the same reason: both
  // put the thing the note is about in a pane beside the note about it.
  { key: "gv", label: "Watch this note's video beside it", command: "openVideo" },
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
  // The same four shifted, which is how vim spells moving the window rather
  // than going to it, `<C-w>H`, and how hyprland spells it too. The pane you
  // are in and the one you point at trade places, each keeping what it holds,
  // so the window is rearranged without anything being opened or closed.
  { key: "H", label: "Swap this pane with the one on the left", command: "movePaneLeft" },
  { key: "J", label: "Swap this pane with the one below", command: "movePaneDown" },
  { key: "K", label: "Swap this pane with the one above", command: "movePaneUp" },
  { key: "L", label: "Swap this pane with the one on the right", command: "movePaneRight" },
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
  // `w` for vim's own `:w`, which is the key for writing what you are looking
  // at out to a file. Not in the `c` group with the three imports: this one
  // creates nothing in the vault, it hands a copy to the browser and leaves.
  // A bare letter, the way the operations you reach for every minute are bare:
  // pausing to write a sentence down is the whole rhythm of taking notes on a
  // talk. `gv` opens the player and this is the one key that then drives it.
  { key: "v", label: "Play or pause this note's video", command: "toggleVideo" },
  { key: "w", label: "Download what this pane holds as a file", command: "exportNote" },
  // tmux's own zoom key, and hyprland's fullscreen. Nothing is closed and
  // nothing is written: the other panes are still there holding what they
  // held, hidden behind this one until the next press or the next move of the
  // focus brings them back.
  { key: "z", label: "Draw this pane on its own, or put the tab back", command: "zoomPane" },
  // tmux's own split keys, kept because they are the two this app is imitating
  // and because the shape of each character says which way the pane divides.
  // Both are shifted, which is no obstacle: vim names a key by
  // `KeyboardEvent.key`, and `?` below has been one all along.
  { key: "%", label: "Split the pane left and right", command: "splitRight" },
  { key: '"', label: "Split the pane top and bottom", command: "splitDown" },
  { key: "?", label: "Show the keys", command: "showHelp" },
  // vim's own key for typing a command by name, one press from the leader.
  // A bare `:` stays vim's ex prompt, which `:w` and `:e` live on.
  { key: ":", label: "Run a command by name", command: "openPalette" },
];

/**
 * How a leader sequence reads on screen: `Space c f`, the presses spaced so
 * that `cf` reads as two keys rather than one. The help panel and the palette
 * both print it.
 */
export function spelled(key: string): string {
  return `Space ${[...key].join(" ")}`;
}

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
 * What a leader sequence reaches, or null while it reaches nothing.
 *
 * The editor resolves the leader through vim, which registers `LEADER`,
 * `LEADER_EDITS` and `TAB_KEYS` in three loops of its own. Every other pane
 * resolves it by hand, and each of them read `LEADER` alone, so `<leader>2`
 * went to a tab from a note and did nothing at all from the todo pane, the
 * tree, the reader or the review. This is the one place that answers for both
 * tables, so a pane cannot come to own half the leader again. `LEADER_EDITS`
 * stays out of it: those write to a buffer, and none of the panes hold one.
 */
export function leaderAction(typed: string, commands: EditorCommands): (() => void) | null {
  const tab = TAB_KEYS.indexOf(typed);
  if (tab !== -1) return () => commands.goToTab(tab);

  const binding = LEADER.find((entry) => entry.key === typed);
  return binding ? () => commands[binding.command]() : null;
}

/**
 * Whether more keys could still finish the sequence, so it waits rather than
 * being dropped. `LEADER` alone: a tab key is one press and prefixes nothing.
 */
export function leaderPrefix(typed: string): boolean {
  return LEADER.some((entry) => entry.key.startsWith(typed));
}

/**
 * Whether the press is a modifier holding itself down rather than a key.
 *
 * The browser sends a keydown for shift before it sends the letter shift was
 * held for, so a pane resolving a sequence by hand sees `" "`, `"Shift"`,
 * `"E"`, and drops the sequence on the middle one: `<leader>E` and `<leader>H`
 * to `<leader>L` were unreachable from every pane but the editor, which is the
 * one place vim resolves the keys and vim skips these already, by the same
 * list in `vim.js`.
 */
export function heldModifier(key: string): boolean {
  return key === "Shift" || key === "Control" || key === "Alt" || key === "Meta";
}
