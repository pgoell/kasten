// @vitest-environment node
import { FORMAT, LEADER_EDITS } from "@/lib/notes/editor/buffer-keys";
import { type EditorCommands, TERMINAL } from "@/lib/ui/keys/key-bindings";
import { LEADER } from "@/lib/ui/keys/leader-keys";
import { type LeaderContext, panelRows } from "@/lib/ui/keys/leader-view";

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
      findMeaning: () => {},
      openTodos: () => {},
      openLog: () => {},
      openOverview: () => {},
      openLibrary: () => {},
      openFinance: () => {},
      showBacklinks: () => {},
      showLinksOut: () => {},
      openDaily: () => {},
      logDrink: () => {},
      logFood: () => {},
      openWeekly: () => {},
      openMonthly: () => {},
      openQuarterly: () => {},
      openYearly: () => {},
      openBook: () => {},
      openReadingBook: () => {},
      openPerson: () => {},
      openHistory: () => {},
      openGraph: () => {},
      openLocalGraph: () => {},
      openVideo: () => {},
      toggleVideo: () => {},
      openRsvp: () => {},
      rsvpFromHere: () => {},
      uploadBook: () => {},
      importNotes: () => {},
      exportNote: () => {},
      openExam: () => {},
      openReview: () => {},
      createTab: () => {},
      openTerminal: () => {},
      openChat: () => {},
      openTimers: () => {},
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
      findMeaning: () => {},
      openTodos: () => {},
      openLog: () => {},
      openOverview: () => {},
      openLibrary: () => {},
      openFinance: () => {},
      showBacklinks: () => {},
      showLinksOut: () => {},
      openDaily: () => {},
      logDrink: () => {},
      logFood: () => {},
      openWeekly: () => {},
      openMonthly: () => {},
      openQuarterly: () => {},
      openYearly: () => {},
      openBook: () => {},
      openReadingBook: () => {},
      openPerson: () => {},
      openHistory: () => {},
      openGraph: () => {},
      openLocalGraph: () => {},
      openVideo: () => {},
      toggleVideo: () => {},
      openRsvp: () => {},
      rsvpFromHere: () => {},
      uploadBook: () => {},
      importNotes: () => {},
      exportNote: () => {},
      openExam: () => {},
      openReview: () => {},
      createTab: () => {},
      openTerminal: () => {},
      openChat: () => {},
      openTimers: () => {},
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

describe("what the which-key panel leaves out", () => {
  /** Every key a view draws, a group as its prefix and a four as each of its keys. */
  function drawn(typed: string, context: LeaderContext, edits = LEADER_EDITS): string[] {
    return panelRows(typed, context, edits).columns.flatMap((column) =>
      column.rows.flatMap((row) => {
        if (row.kind === "digits") return [];
        return row.kind === "four" ? row.keys.map((each) => each.key) : [row.key];
      }),
    );
  }

  const note = (text = ""): LeaderContext => ({ holds: "path", note: text, tab: ["path"] });

  it("a finance pane shows no keys for a note, and no todo edits", () => {
    const finance: LeaderContext = { holds: "finance", tab: ["finance"] };
    const first = drawn("", finance, []);
    for (const key of ["p", "w", "x", "s", "z", "h", "o"]) expect(first, key).not.toContain(key);
    expect(drawn("g", finance, [])).not.toContain("gb");
    expect(drawn("g", finance, [])).toContain("gd");
    expect(drawn("r", finance, [])).toEqual([]);
    expect(panelRows("", finance, []).hidden).toBe(true);
  });

  it("a lone note shows its own keys but none that move between panes", () => {
    const first = drawn("", note());
    expect(first).toEqual(expect.arrayContaining(["p", "w", "x", "s", "r", "d"]));
    for (const key of ["h", "H", "o", "z", "v"]) expect(first, key).not.toContain(key);
    expect(drawn("", { ...note(), tab: ["path", "video"] })).toEqual(
      expect.arrayContaining(["h", "L", "o", "z", "v"]),
    );
  });

  it("the person card, the video and the exam show only for a note that has one", () => {
    expect(drawn("g", note())).not.toContain("gp");
    expect(drawn("g", note())).not.toContain("gv");
    expect(drawn("c", note())).not.toContain("cv");
    expect(drawn("g", note("---\ntype: Person\n---\n"))).toContain("gp");
    expect(drawn("g", note("https://youtu.be/dQw4w9WgXcQ"))).toContain("gv");
    expect(drawn("c", note("https://youtu.be/dQw4w9WgXcQ"))).toContain("cv");
  });

  it("with no pane to go by, as from the file tree's page in a test, every key shows", () => {
    expect(panelRows("", { tab: [] }, LEADER_EDITS).hidden).toBe(false);
    expect(panelRows("g", { tab: ["path", "todos"] }, []).hidden).toBe(false);
    // From the tree a note's keys show, but the pane moves still follow the tab.
    const tree = drawn("", { tab: ["finance"] }, []);
    expect(tree).toEqual(expect.arrayContaining(["p", "w", "r"]));
    expect(tree).not.toContain("h");
  });
});
