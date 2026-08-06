import { fireEvent, render, screen } from "@testing-library/react";
import { KeyHelp } from "@/components/key-help";
import { FOLLOW, FORMAT, INDENT, LEADER, TREE } from "@/lib/key-bindings";

/** The panel spaces the letters of a key, so each one reads as a press. */
function leaderKey(key: string) {
  return `Space ${[...key].join(" ")}`;
}

describe("KeyHelp", () => {
  it("lists every leader key and what it does", () => {
    render(<KeyHelp onClose={() => {}} />);

    for (const { key, label } of LEADER) {
      expect(screen.getByText(leaderKey(key))).toBeInTheDocument();
      expect(screen.getByText(label)).toBeInTheDocument();
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
    const commands = new Set([
      "toggleTree",
      "togglePreview",
      "closeNote",
      "showHelp",
      "focusTree",
      "createNote",
      "renameNote",
      "findNote",
      "searchNotes",
    ]);

    for (const { command } of LEADER) {
      expect(commands).toContain(command);
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
