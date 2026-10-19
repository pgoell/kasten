import { fireEvent, render, screen, within } from "@testing-library/react";
import { KeyHelp } from "@/components/key-help";
import {
  type EditorCommands,
  FOLLOW,
  FORMAT,
  INDENT,
  LEADER,
  LEADER_EDITS,
  SCREENS,
  TERMINAL,
  TERMINAL_CHORD,
  TODO_PANE,
  TREE,
} from "@/lib/key-bindings";

/**
 * One group's table, so a key spelled the same in two groups reads as two rows.
 *
 * `Ctrl Shift H` is exactly that: `FORMAT` binds it to Highlight in the editor
 * and `TERMINAL` binds it to the pane on the left. The contexts are disjoint, a
 * chord in a focused terminal never reaching the editor, but the panel prints
 * the spelling twice and an unscoped query cannot tell them apart.
 */
function group(title: string) {
  return within(screen.getByRole("heading", { name: title }).parentElement as HTMLElement);
}

/**
 * How a terminal chord should read, built here from `TERMINAL_CHORD` rather
 * than imported from the panel.
 *
 * Derived twice on purpose: a test that called the panel's own speller would
 * agree with it whatever it printed. Retuning the modifiers moves both, which
 * is the claim.
 */
function chord(key: string): string {
  const held = [
    TERMINAL_CHORD.ctrlKey && "Ctrl",
    TERMINAL_CHORD.altKey && "Alt",
    TERMINAL_CHORD.shiftKey && "Shift",
    TERMINAL_CHORD.metaKey && "Meta",
  ].filter((word) => word !== false);
  return [...held, key].join(" ");
}

/** The panel spaces the letters of a key, so each one reads as a press. */
function leaderKey(key: string) {
  return `Space ${[...key].join(" ")}`;
}

describe("KeyHelp", () => {
  it("lists every leader key and what it does", () => {
    render(<KeyHelp onClose={() => {}} />);

    for (const { key, label } of LEADER) {
      // The key's own row, not the label anywhere on the panel: a terminal
      // chord carries the same sentence as the leader key doing the same job.
      //
      // Unscoped, unlike the groups below, and that is the claim: the panel
      // cuts these keys into groups of its own, and a key that landed in two
      // of them or in none fails right here.
      expect(screen.getByText(leaderKey(key)).nextElementSibling).toHaveTextContent(label);
    }
  });

  it("lists every leader key that writes to the note", () => {
    render(<KeyHelp onClose={() => {}} />);

    // A second table, and one group: these name no command on `EditorCommands`
    // because they edit the buffer, but they are pressed like every other
    // leader key and belong on the panel beside them.
    for (const { key, label } of LEADER_EDITS) {
      expect(screen.getByText(leaderKey(key)).nextElementSibling).toHaveTextContent(label);
    }
  });

  it("spells a two letter leader key as the two presses it takes", () => {
    render(<KeyHelp onClose={() => {}} />);

    // Written out rather than derived, because `Space cf` reads like one key
    // and is the mistake this spacing exists to prevent.
    expect(screen.getByText("Space c f").nextElementSibling).toHaveTextContent("Create a note");
    expect(screen.getByText("Space r f").nextElementSibling).toHaveTextContent("Rename the note");
  });

  it("puts every leader key in a named group", () => {
    render(<KeyHelp onClose={() => {}} />);

    // Written out rather than read off the panel, so a catchall group added
    // back under any name fails here.
    const titles = [
      "Panes",
      "Tabs",
      "Find",
      "Create and capture",
      "This note",
      "Periodic notes",
      "Panes to open",
      "Todos",
      "Toggles",
      "Help",
    ];
    for (const { key } of [...LEADER, ...LEADER_EDITS]) {
      const title = screen.getByText(leaderKey(key)).closest("section")?.querySelector("h3");
      expect(titles, key).toContain(title?.textContent);
    }
  });

  it("groups the leader keys as the issue names them", () => {
    render(<KeyHelp onClose={() => {}} />);

    // #516's table, written out: a key moved to another group fails here even
    // though it still has a name above it.
    const groups: Record<string, string[]> = {
      Panes: ["%", '"', "h", "j", "k", "l", "H", "J", "K", "L", "o", "z", "q"],
      Tabs: ["ct", "tl", "th"],
      Find: ["fb", "ff", "fg", "ft"],
      "Create and capture": ["cf", "cd", "cw", "cm", "cb", "ci", "cv", "cc", "cs"],
      "This note": ["rf", "df", "du", "w", "="],
      "Periodic notes": ["gd", "gw", "gm", "gq", "gy"],
      "Panes to open": ["gb", "go", "gr", "gp", "gh", "gl", "gv", "ge", "gs", "gt", "gg"],
      Todos: ["x", "i", "so", "sp", "sx", "sb", "sw", "sv", "sr"],
      Toggles: ["a", "b", "p", "e", "E", "v"],
      Help: ["?", ":"],
    };
    for (const [title, keys] of Object.entries(groups)) {
      for (const key of keys) {
        // Soft and a query, so a key missing from one group still lets every
        // other group, and the tab row below, be checked.
        expect.soft(group(title).queryByText(leaderKey(key)), key).not.toBeNull();
      }
    }
    expect(group("Tabs").getByText("Go to a tab by number")).toBeInTheDocument();
  });

  it("sets the leader keys apart from the other keys", () => {
    render(<KeyHelp onClose={() => {}} />);

    const leader = [
      "Panes",
      "Tabs",
      "Find",
      "Create and capture",
      "This note",
      "Periodic notes",
      "Panes to open",
      "Todos",
      "Toggles",
      "Help",
    ];
    const other = ["Editor", "Terminal", "File tree", "Todo pane", "Screens you type"];
    const titles = (block: string) =>
      group(block)
        .getAllByRole("heading", { level: 3 })
        .map((heading) => heading.textContent);

    expect(titles("Leader keys")).toEqual(leader);
    expect(titles("Other keys")).toEqual(other);
  });

  it("says how to reach the leader keys, with vim on and off", () => {
    // With vim off there is no leader at all, so the panel has to say where
    // the same commands went.
    try {
      localStorage.setItem("kasten.vim", "on");
      const { unmount } = render(<KeyHelp onClose={() => {}} />);
      expect.soft(screen.queryByText(/start with Space, in normal mode/)).toBeInTheDocument();
      unmount();

      localStorage.setItem("kasten.vim", "off");
      render(<KeyHelp onClose={() => {}} />);
      expect(
        screen.queryByText(/Vim is off.*command palette \(Ctrl Shift P\)/),
      ).toBeInTheDocument();
    } finally {
      localStorage.removeItem("kasten.vim");
    }
  });

  it("lists every formatting key", () => {
    render(<KeyHelp onClose={() => {}} />);

    for (const { label } of FORMAT) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("lists every indent key", () => {
    render(<KeyHelp onClose={() => {}} />);

    for (const { label } of INDENT) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("lists the key that follows a wikilink", () => {
    render(<KeyHelp onClose={() => {}} />);

    for (const { key, label } of FOLLOW) {
      expect(screen.getByText(key).nextElementSibling).toHaveTextContent(label);
    }
  });

  it("lists only the editor keys that work, with vim on and off", () => {
    // `gf` and `Enter` follow a link through vim alone (#581), while the
    // formatting and indent keys are CodeMirror's and work either way.
    try {
      localStorage.setItem("kasten.vim", "on");
      const { unmount } = render(<KeyHelp onClose={() => {}} />);
      expect.soft(group("Editor").queryByText("gf / Enter")).toBeInTheDocument();
      unmount();

      localStorage.setItem("kasten.vim", "off");
      render(<KeyHelp onClose={() => {}} />);
      for (const { label } of [...FORMAT, ...INDENT]) {
        expect.soft(group("Editor").queryByText(label), label).toBeInTheDocument();
      }
      expect(group("Editor").queryByText("gf / Enter")).not.toBeInTheDocument();
    } finally {
      localStorage.removeItem("kasten.vim");
    }
  });

  it("lists every terminal chord, spelled the way it is pressed", () => {
    render(<KeyHelp onClose={() => {}} />);

    for (const { key, label } of TERMINAL) {
      // The prefix is built from `TERMINAL_CHORD`, so retuning the modifiers
      // moves both the panel and this assertion together.
      expect(group("Terminal").getByText(chord(key)).nextElementSibling).toHaveTextContent(label);
    }
  });

  it("lists every tree key", () => {
    render(<KeyHelp onClose={() => {}} />);

    // Scoped to the group, because the todo pane below binds `j / k`, `q` and
    // `Escape` to the same sentences: two panels, two rows, one spelling.
    for (const { key, label } of TREE) {
      expect(group("File tree").getByText(key).nextElementSibling).toHaveTextContent(label);
    }
  });

  it("lists every todo pane key", () => {
    render(<KeyHelp onClose={() => {}} />);

    for (const { key, label } of TODO_PANE) {
      expect(group("Todo pane").getByText(key).nextElementSibling).toHaveTextContent(label);
    }
  });

  it("#419 names c, the key that turns the todo list into the board", () => {
    render(<KeyHelp onClose={() => {}} />);

    // Written out rather than read off `TODO_PANE`: the loop above passes over
    // a table that never had the row, and a missing `c` left the board with no
    // way in that the panel named.
    expect(group("Todo pane").getByText("c").nextElementSibling).toHaveTextContent(/board/);
  });

  it("lists every screen reached by typing its address", () => {
    // The two screens with no key and no link. Without this group nothing in
    // the app says `/tokens` exists at all, and finding it means reading the
    // documentation for a URL.
    render(<KeyHelp onClose={() => {}} />);

    for (const { key, label } of SCREENS) {
      expect(group("Screens you type").getByText(key).nextElementSibling).toHaveTextContent(label);
    }
  });

  it("closes on escape", () => {
    const onClose = vi.fn();
    render(<KeyHelp onClose={onClose} />);

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on q, the key that closes things everywhere else", () => {
    const onClose = vi.fn();
    render(<KeyHelp onClose={onClose} />);

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "q" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("hands the focus back to whatever opened it", () => {
    // The panel takes the focus to read its own keys, so it owes it back. The
    // opener is the editor for `<leader>?` and the tree for the same key
    // pressed there, and neither is reachable from here, so it restores
    // whatever held the focus rather than naming one of them.
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();

    const { unmount } = render(<KeyHelp onClose={() => {}} />);
    expect(screen.getByRole("dialog")).toHaveFocus();

    unmount();

    expect(opener).toHaveFocus();
    opener.remove();
  });
});

describe("the key tables", () => {
  it("names a command for every leader key that the editor can run", () => {
    // The panel and the docs both read these tables. A leader entry naming a
    // command nothing provides would show a key that does nothing.
    //
    // The names are read off a stub rather than listed here, so the two ways
    // this can rot are both caught: `satisfies` fails to compile when the
    // interface gains a command the stub has not got, and the loop below fails
    // when `LEADER` names one that does not exist.
    const stub = {
      toggleTree: () => {},
      toggleArchive: () => {},
      togglePreview: () => {},
      closeNote: () => {},
      showHelp: () => {},
      openPalette: () => {},
      focusTree: () => {},
      revealTree: () => {},
      createNote: () => {},
      renameNote: () => {},
      deleteNote: () => {},
      restoreDeleted: () => {},
      findNote: () => {},
      searchNotes: () => {},
      findTodos: () => {},
      findBook: () => {},
      openTodos: () => {},
      showBacklinks: () => {},
      showLinksOut: () => {},
      openDaily: () => {},
      openWeekly: () => {},
      openMonthly: () => {},
      openQuarterly: () => {},
      openYearly: () => {},
      openBook: () => {},
      openPerson: () => {},
      openHistory: () => {},
      openGraph: () => {},
      openLocalGraph: () => {},
      openVideo: () => {},
      toggleVideo: () => {},
      uploadBook: () => {},
      importNotes: () => {},
      exportNote: () => {},
      openExam: () => {},
      openReview: () => {},
      createTab: () => {},
      openTerminal: () => {},
      openChat: () => {},
      importPage: () => {},
      captureDump: () => {},
      splitRight: () => {},
      splitDown: () => {},
      nextPane: () => {},
      paneLeft: () => {},
      paneDown: () => {},
      paneUp: () => {},
      paneRight: () => {},
      nextTab: () => {},
      prevTab: () => {},
      goToTab: () => {},
      movePaneLeft: () => {},
      movePaneDown: () => {},
      movePaneUp: () => {},
      movePaneRight: () => {},
      zoomPane: () => {},
    } satisfies EditorCommands;
    const commands = new Set(Object.keys(stub));

    for (const { command } of LEADER) {
      expect(commands).toContain(command);
    }
  });

  it("names a command for every terminal chord that the editor can run", () => {
    // The same guarantee as above, one table over. A chord naming a command
    // nothing provides would eat a key inside a terminal and do nothing with it.
    const stub = {
      toggleTree: () => {},
      toggleArchive: () => {},
      togglePreview: () => {},
      closeNote: () => {},
      showHelp: () => {},
      openPalette: () => {},
      focusTree: () => {},
      revealTree: () => {},
      createNote: () => {},
      renameNote: () => {},
      deleteNote: () => {},
      restoreDeleted: () => {},
      findNote: () => {},
      searchNotes: () => {},
      findTodos: () => {},
      findBook: () => {},
      openTodos: () => {},
      showBacklinks: () => {},
      showLinksOut: () => {},
      openDaily: () => {},
      openWeekly: () => {},
      openMonthly: () => {},
      openQuarterly: () => {},
      openYearly: () => {},
      openBook: () => {},
      openPerson: () => {},
      openHistory: () => {},
      openGraph: () => {},
      openLocalGraph: () => {},
      openVideo: () => {},
      toggleVideo: () => {},
      uploadBook: () => {},
      importNotes: () => {},
      exportNote: () => {},
      openExam: () => {},
      openReview: () => {},
      createTab: () => {},
      openTerminal: () => {},
      openChat: () => {},
      importPage: () => {},
      captureDump: () => {},
      splitRight: () => {},
      splitDown: () => {},
      nextPane: () => {},
      paneLeft: () => {},
      paneDown: () => {},
      paneUp: () => {},
      paneRight: () => {},
      nextTab: () => {},
      prevTab: () => {},
      goToTab: () => {},
      movePaneLeft: () => {},
      movePaneDown: () => {},
      movePaneUp: () => {},
      movePaneRight: () => {},
      zoomPane: () => {},
    } satisfies EditorCommands;
    const commands = new Set(Object.keys(stub));

    for (const { command } of TERMINAL) {
      expect(commands).toContain(command);
    }
  });

  it("gives every terminal chord its own key", () => {
    // Two rows on one key means the second is unreachable, silently.
    expect(new Set(TERMINAL.map(({ key }) => key)).size).toBe(TERMINAL.length);
  });

  it("gives every leader binding its own key, across both tables", () => {
    // The panel builds its rows into a Map keyed by this, so a key spelled
    // twice loses a row rather than showing two, and nothing says which.
    const all = [...LEADER, ...LEADER_EDITS];
    expect(new Set(all.map(({ key }) => key)).size).toBe(all.length);
  });

  it("lets no leader binding shadow a longer one", () => {
    // Vim fires a complete match the moment it is typed, so a `d` of its own
    // would run before `df` or `du` could be finished, and neither would ever
    // be reached again.
    const keys = [...LEADER, ...LEADER_EDITS].map(({ key }) => key);
    for (const short of keys) {
      expect(keys.filter((key) => key !== short && key.startsWith(short))).toEqual([]);
    }
  });

  it("spells a terminal chord with the letter shift actually produces", () => {
    // The trap `FORMAT` carries below: `KeyboardEvent.key` is the uppercase
    // letter while shift is down, so a row spelled "h" can never fire.
    for (const { key } of TERMINAL) {
      expect(key).toMatch(/^[A-Z]$/);
    }
  });

  it("spells a shifted formatting key with the letter shift actually produces", () => {
    // Vim names a key from `KeyboardEvent.key`, which is the uppercase letter
    // while shift is held. A lowercase letter after `S-` is a binding no
    // keyboard can reach, and it fails silently rather than loudly.
    for (const { key } of FORMAT.filter((entry) => entry.key.includes("S-"))) {
      expect(key).toMatch(/^<C-S-[A-Z]>$/);
    }
  });
});
