import { fireEvent, render, screen, within } from "@testing-library/react";
import { KeyHelp } from "@/components/key-help";
import { FOLLOW, FORMAT, INDENT, LEADER_EDITS } from "@/lib/buffer-keys";
import { SCREENS, TERMINAL, TERMINAL_CHORD, TODO_PANE, TREE } from "@/lib/key-bindings";
import { LEADER } from "@/lib/leader-keys";

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

/** The filter field, found by its name. Its absence is the failure, said as one. */
function filterField(): HTMLElement {
  const field = screen.queryByRole("searchbox", { name: "Filter keys" });
  expect(field, "the filter field").toBeInTheDocument();
  return field as HTMLElement;
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
    const titles = ["Find", "Create", "Go to", "Tabs", "Panes", "This note"];
    for (const { key } of [...LEADER, ...LEADER_EDITS]) {
      const title = screen.getByText(leaderKey(key)).closest("section")?.querySelector("h3");
      expect(titles, key).toContain(title?.textContent);
    }
  });

  it("groups the leader keys as the issue names them", () => {
    render(<KeyHelp onClose={() => {}} />);

    // The six columns, written out: a key moved to another column fails here
    // even though it still has a name above it.
    const groups: Record<string, string[]> = {
      Find: ["ff", "fg", "fb", "ft", "a", ":", "?"],
      Create: ["cf", "cd", "cw", "cm", "cb", "ci", "cv", "cc", "cs"],
      "Go to": [
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
        "e",
        "E",
      ],
      Tabs: ["ct", "tl", "th"],
      Panes: ["%", '"', "h", "j", "k", "l", "H", "J", "K", "L", "o", "z", "q", "b"],
      "This note": [
        "rf",
        "df",
        "du",
        "w",
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

    const leader = ["Find", "Create", "Go to", "Tabs", "Panes", "This note"];
    const other = [
      "In a note",
      "In a page, PDF or book",
      "Over a video",
      "In review",
      "Anywhere",
      "File tree",
      "Todo pane",
      "Log pane",
      "Finance pane",
      "Terminal",
      "Screens you type",
    ];
    const titles = (block: string) =>
      group(block)
        .getAllByRole("heading", { level: 3 })
        .map((heading) => heading.textContent);

    expect(titles("After Space")).toEqual(leader);
    expect(titles("Vim and the rest")).toEqual(other);
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
      expect.soft(group("In a note").queryByText("gf / Enter")).toBeInTheDocument();
      unmount();

      localStorage.setItem("kasten.vim", "off");
      render(<KeyHelp onClose={() => {}} />);
      for (const { label } of [...FORMAT, ...INDENT]) {
        expect.soft(group("In a note").queryByText(label), label).toBeInTheDocument();
      }
      expect(group("In a note").queryByText("gf / Enter")).not.toBeInTheDocument();
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

  it("#624 <leader>? lists the log pane's keys and <leader>gf", () => {
    render(<KeyHelp onClose={() => {}} />);

    expect(group("Go to").getByText(leaderKey("gf")).nextElementSibling).toHaveTextContent(
      "Open the log",
    );
    expect(group("Log pane").getByText("3").nextElementSibling).toHaveTextContent(
      "Show trends over 30 days",
    );
  });

  it("#419 names c, the key that turns the todo list into the board", () => {
    render(<KeyHelp onClose={() => {}} />);

    // Written out rather than read off `TODO_PANE`: the loop above passes over
    // a table that never had the row, and a missing `c` left the board with no
    // way in that the panel named.
    expect(group("Todo pane").getByText("c").nextElementSibling).toHaveTextContent(/board/);
  });

  it("#523 A10 lists Space @ in the This note group", () => {
    render(<KeyHelp onClose={() => {}} />);

    // Written out, as `c` above is: the loops pass over a table without the row.
    // The label read as text, empty where the row is missing, so a missing row
    // fails the comparison rather than the matcher.
    const label = group("This note").queryByText("Space @")?.nextElementSibling?.textContent ?? "";
    expect(label).toContain("Send this todo to the agent, or take it back");
  });

  it("#523 A10 lists @ among the todo pane keys", () => {
    render(<KeyHelp onClose={() => {}} />);

    const label = group("Todo pane").queryByText("@")?.nextElementSibling?.textContent ?? "";
    expect(label).toContain("Send the todo under the cursor to the agent, or take it back");
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
    expect(filterField()).toHaveFocus();

    unmount();

    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("the filter field is focused when key help opens", () => {
    render(<KeyHelp onClose={() => {}} />);

    expect(filterField()).toHaveFocus();
  });

  it("the two columns are After Space and Vim and the rest", () => {
    render(<KeyHelp onClose={() => {}} />);

    const columns = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent);
    expect(columns).toEqual(["After Space", "Vim and the rest"]);
  });

  it("typing in the filter narrows both columns live", () => {
    render(<KeyHelp onClose={() => {}} />);

    fireEvent.change(filterField(), { target: { value: "tab" } });
    // A Tabs row in After Space and a row with tab in it in Vim and the rest
    // stay. A row with neither goes.
    expect(screen.getByText(leaderKey("ct"))).toBeInTheDocument();
    expect(screen.getByText("Tab")).toBeInTheDocument();
    expect(screen.queryByText(leaderKey("gg"))).not.toBeInTheDocument();
    expect(screen.queryByText("Bold")).not.toBeInTheDocument();

    fireEvent.change(filterField(), { target: { value: "graph" } });
    expect(screen.getByText(leaderKey("gg"))).toBeInTheDocument();
    expect(screen.queryByText("Tab")).not.toBeInTheDocument();
  });

  it("a filter that matches nothing says so", () => {
    render(<KeyHelp onClose={() => {}} />);

    fireEvent.change(filterField(), { target: { value: "zzz" } });

    // One line per column, each drawn in the muted colour.
    const nothing = screen.getAllByText("Nothing matches");
    expect(nothing).toHaveLength(2);
    for (const line of nothing) {
      expect(line).toHaveClass("text-k-muted");
    }
  });

  it("Esc in the filter closes key help", () => {
    const onClose = vi.fn();
    render(<KeyHelp onClose={onClose} />);

    fireEvent.keyDown(filterField(), { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("q typed in the filter stays a letter", () => {
    const onClose = vi.fn();
    render(<KeyHelp onClose={onClose} />);

    const field = filterField();
    fireEvent.change(field, { target: { value: "q" } });
    fireEvent.keyDown(field, { key: "q" });

    expect(onClose).not.toHaveBeenCalled();
    expect(field).toHaveValue("q");
  });

  it("Tab stays inside key help", () => {
    render(<KeyHelp onClose={() => {}} />);

    const field = filterField();
    // A Tab the panel takes is one it has prevented, so fireEvent reports false,
    // and the browser never moves the focus out past the panel.
    expect(fireEvent.keyDown(field, { key: "Tab" })).toBe(false);
    expect(fireEvent.keyDown(field, { key: "Tab", shiftKey: true })).toBe(false);
    expect(field).toHaveFocus();
  });
});
