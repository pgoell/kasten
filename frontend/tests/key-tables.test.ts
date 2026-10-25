import { FORMAT, LEADER_EDITS } from "@/lib/buffer-keys";
import { type EditorCommands, TERMINAL } from "@/lib/key-bindings";
import { LEADER } from "@/lib/leader-keys";

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
      openLog: () => {},
      openOverview: () => {},
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
      openLog: () => {},
      openOverview: () => {},
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
