import { fireEvent, render, screen, within } from "@testing-library/react";
import { KeyHelp } from "@/components/key-help";
import {
  type EditorCommands,
  FOLLOW,
  FORMAT,
  INDENT,
  LEADER,
  LEADER_EDITS,
  TERMINAL,
  TERMINAL_CHORD,
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
      expect(group("Leader").getByText(leaderKey(key)).nextElementSibling).toHaveTextContent(label);
    }
  });

  it("lists every leader key that writes to the note", () => {
    render(<KeyHelp onClose={() => {}} />);

    // A second table, and one group: these name no command on `EditorCommands`
    // because they edit the buffer, but they are pressed like every other
    // leader key and belong on the panel beside them.
    for (const { key, label } of LEADER_EDITS) {
      expect(group("Leader").getByText(leaderKey(key)).nextElementSibling).toHaveTextContent(label);
    }
  });

  it("spells a two letter leader key as the two presses it takes", () => {
    render(<KeyHelp onClose={() => {}} />);

    // Written out rather than derived, because `Space cf` reads like one key
    // and is the mistake this spacing exists to prevent.
    expect(screen.getByText("Space c f").nextElementSibling).toHaveTextContent("Create a note");
    expect(screen.getByText("Space r f").nextElementSibling).toHaveTextContent("Rename the note");
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

    for (const { label } of TREE) {
      expect(screen.getByText(label)).toBeInTheDocument();
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
      togglePreview: () => {},
      closeNote: () => {},
      showHelp: () => {},
      focusTree: () => {},
      createNote: () => {},
      renameNote: () => {},
      findNote: () => {},
      searchNotes: () => {},
      findTodos: () => {},
      showBacklinks: () => {},
      showLinksOut: () => {},
      openDaily: () => {},
      openWeekly: () => {},
      openMonthly: () => {},
      openQuarterly: () => {},
      openYearly: () => {},
      createTab: () => {},
      openTerminal: () => {},
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
      togglePreview: () => {},
      closeNote: () => {},
      showHelp: () => {},
      focusTree: () => {},
      createNote: () => {},
      renameNote: () => {},
      findNote: () => {},
      searchNotes: () => {},
      findTodos: () => {},
      showBacklinks: () => {},
      showLinksOut: () => {},
      openDaily: () => {},
      openWeekly: () => {},
      openMonthly: () => {},
      openQuarterly: () => {},
      openYearly: () => {},
      createTab: () => {},
      openTerminal: () => {},
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
