import { EditorView } from "@codemirror/view";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { WhichKey } from "@/components/which-key";
import { LEADER_EDITS } from "@/lib/buffer-keys";
import type { EditorCommands } from "@/lib/key-bindings";
import { LEADER } from "@/lib/leader-keys";
import { beginLeader, editorOpener, type LeaderOpener, paneOpener } from "@/lib/which-key";
import { stubCommands } from "./keybindings-fixture";
import { stubMatchMedia } from "./match-media";

/** A key as the panel prints it: `cf` reads as two presses. */
function spaced(key: string): string {
  return [...key].join(" ");
}

/**
 * Renders the panel beside a button that holds the focus, then presses Space
 * through the pane's opener. `opener` builds it from the commands, after the
 * focus is where the pane would have left it.
 */
function mount(
  opener: (commands: EditorCommands) => LeaderOpener = paneOpener,
  commands: EditorCommands = stubCommands(),
) {
  const view = render(
    <>
      <button type="button">Note</button>
      <WhichKey phone={false} />
    </>,
  );
  const note = screen.getByRole("button", { name: "Note" });
  note.focus();
  act(() => {
    beginLeader(opener(commands));
  });
  return { ...view, note, commands };
}

describe("WhichKey", () => {
  // The spring jumps to its end under reduced motion, so a close finishes on the
  // first frame and no assertion waits on animation frames, which run late under
  // load. The fade itself is in the frame tests (`tests/frame/which-key.test.tsx`).
  beforeEach(() => {
    stubMatchMedia({ "(prefers-reduced-motion: reduce)": true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("the panel shows at once with the six columns", () => {
    mount();

    const headings = within(screen.getByRole("dialog")).getAllByRole("heading", { level: 3 });
    expect(headings.map((heading) => heading.textContent)).toEqual([
      "Find",
      "Create",
      "Go to",
      "Tabs",
      "Panes",
      "This note",
    ]);
  });

  it("every leader key and the tab digits are a row in one column", () => {
    const { unmount } = mount(paneOpener);

    for (const { key } of LEADER) {
      const rows = screen.getAllByText(spaced(key), { selector: "kbd" });
      expect(rows, key).toHaveLength(1);
      expect(rows[0]?.closest("button"), key).not.toBeNull();
    }
    const digits = screen.getByText("1 … 0", { selector: "kbd" });
    expect(digits.closest("button")).toBeNull();
    expect(digits.closest("section")?.querySelector("h3")?.textContent).toBe("Tabs");
    // The editor's edits belong to the editor's panel only.
    expect(screen.queryByText("Tidy the markdown in this note")).toBeNull();
    unmount();

    const view = new EditorView({ doc: "", parent: document.body });
    try {
      mount((commands) => editorOpener(view, commands));
      for (const { key } of LEADER_EDITS) {
        expect(screen.getAllByText(spaced(key), { selector: "kbd" }), key).toHaveLength(1);
      }
    } finally {
      view.destroy();
    }
  });

  it("the pressed keys sit on top, Space then each key", () => {
    mount();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "g" });

    const pressed = screen.getByLabelText("Keys pressed");
    expect(Array.from(pressed.querySelectorAll("kbd"), (kbd) => kbd.textContent)).toEqual([
      "Space",
      "g",
    ]);
  });

  it("after g it narrows to the g keys in place", () => {
    mount();
    const panel = screen.getByRole("dialog");

    fireEvent.keyDown(panel, { key: "g" });

    expect(screen.getByRole("dialog")).toBe(panel);
    expect(["", "1"]).toContain(panel.style.opacity);
    expect(screen.getByRole("button", { name: /Open today's note/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Find" })).toBeNull();
  });

  it("a click on a row runs its command and closes", async () => {
    const { commands } = mount();

    fireEvent.click(screen.getByText("Toggle the file tree").closest("button") as HTMLElement);

    expect(commands.toggleTree).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("Esc closes and gives the focus back", async () => {
    const { note } = mount();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(note).toHaveFocus();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("Space again closes", async () => {
    mount();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: " " });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("a key matching nothing closes and runs nothing", async () => {
    const { commands } = mount();

    // `x` is an editor edit, so the pane's opener has nothing under it.
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "x" });

    for (const command of Object.values(commands)) {
      expect(command).not.toHaveBeenCalled();
    }
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("while open y reaches nothing behind the panel", () => {
    const { note, commands } = mount();
    const onNote = vi.fn();
    const onDocument = vi.fn();
    note.addEventListener("keydown", onNote);
    document.addEventListener("keydown", onDocument);

    try {
      fireEvent.keyDown(note, { key: "y" });

      // `y` matches nothing, so the panel closes. Whether it is already gone or still
      // leaving is a matter of a microtask, so the check is the same for both: no open dialog.
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(onNote).not.toHaveBeenCalled();
      expect(onDocument).not.toHaveBeenCalled();
      for (const command of Object.values(commands)) {
        expect(command).not.toHaveBeenCalled();
      }
    } finally {
      note.removeEventListener("keydown", onNote);
      document.removeEventListener("keydown", onDocument);
    }
  });

  it("Tab stays inside the panel", () => {
    mount();
    const buttons = within(screen.getByRole("dialog")).getAllByRole("button");
    const first = buttons[0] as HTMLElement;
    const last = buttons[buttons.length - 1] as HTMLElement;

    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(first).toHaveFocus();

    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
  });

  it("a fading panel takes no click and is hidden from the accessibility tree", () => {
    // Not reduced: the close is still running when the panel is read, so it is fading.
    stubMatchMedia({});
    const { commands } = mount();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    const panel = document.querySelector<HTMLElement>("[role='dialog'][aria-label='Leader keys']");
    expect(panel).toHaveAttribute("inert");
    expect(panel).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("button", { name: /Toggle the file tree/ })).toBeNull();

    const row = screen.getByText("Toggle the file tree", { selector: "span" }).closest("button");
    fireEvent.click(row as HTMLElement);
    expect(commands.toggleTree).not.toHaveBeenCalled();
  });

  it("after c the tab row sits under Tabs", () => {
    mount();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "c" });

    const tabs = screen.getByRole("heading", { name: "Tabs" }).closest("section") as HTMLElement;
    expect(within(tabs).getByRole("button", { name: /Create a tab/ })).toBeInTheDocument();
  });

  it("on a phone Enter on a focused row runs it", () => {
    const commands = stubCommands();
    render(
      <>
        <button type="button">Note</button>
        <WhichKey phone />
      </>,
    );
    const note = screen.getByRole("button", { name: "Note" });
    note.focus();
    act(() => {
      beginLeader(paneOpener(commands));
    });
    const dialog = screen.getByRole("dialog", { name: "Leader keys" });
    const row = within(dialog).getByText("Toggle the file tree", { selector: "span" });
    const button = row.closest("button") as HTMLElement;
    button.focus();

    // The browser turns Enter on a focused button into its click. The panel must not take
    // the key first, so it is not prevented and the sheet stays up until the click.
    expect(fireEvent.keyDown(button, { key: "Enter" })).toBe(true);
    expect(screen.getByRole("dialog", { name: "Leader keys" })).toBe(dialog);
    fireEvent.click(button);
    expect(commands.toggleTree).toHaveBeenCalledTimes(1);
  });

  it("a press outside the panel closes it and the next key goes where the press put the focus", () => {
    const { commands } = mount();
    const other = document.createElement("button");
    other.type = "button";
    document.body.append(other);
    const seen = vi.fn();
    other.addEventListener("keydown", seen);

    try {
      fireEvent.pointerDown(other);
      other.focus();
      fireEvent.keyDown(other, { key: "f" });

      expect(seen).toHaveBeenCalledTimes(1);
      expect(commands.findNote).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).toBeNull();
    } finally {
      other.remove();
    }
  });

  it("keys sent in the same task as Space still go to the panel", () => {
    render(
      <>
        <button type="button">Note</button>
        <WhichKey phone={false} />
      </>,
    );
    const note = screen.getByRole("button", { name: "Note" });
    note.focus();
    const commands = stubCommands();
    const bubbled = vi.fn();
    note.addEventListener("keydown", bubbled);

    try {
      // No act in between: React has not committed the panel when the keys land.
      beginLeader(paneOpener(commands));
      for (let press = 0; press < 2; press += 1) {
        note.dispatchEvent(
          new KeyboardEvent("keydown", { key: "f", bubbles: true, cancelable: true }),
        );
      }

      expect(commands.findNote).toHaveBeenCalledTimes(1);
      expect(bubbled).not.toHaveBeenCalled();
    } finally {
      note.removeEventListener("keydown", bubbled);
    }
  });

  it("a command that moves the focus keeps it there", () => {
    const input = document.createElement("input");
    document.body.append(input);
    try {
      const commands = { ...stubCommands(), findNote: vi.fn(() => input.focus()) };
      mount(paneOpener, commands);
      const panel = screen.getByRole("dialog");

      fireEvent.keyDown(panel, { key: "f" });
      fireEvent.keyDown(panel, { key: "f" });

      expect(commands.findNote).toHaveBeenCalledTimes(1);
      expect(input).toHaveFocus();
    } finally {
      input.remove();
    }
  });

  it("a held Shift keeps the panel and Space E reveals the tree", () => {
    const { commands } = mount();
    const panel = screen.getByRole("dialog");

    fireEvent.keyDown(panel, { key: "Shift", shiftKey: true });
    expect(screen.getByRole("dialog")).toBe(panel);

    fireEvent.keyDown(panel, { key: "E", shiftKey: true });
    expect(commands.revealTree).toHaveBeenCalledTimes(1);
  });

  it("Space 3 goes to the third tab", () => {
    const { commands } = mount();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "3" });

    expect(commands.goToTab).toHaveBeenCalledWith(2);
  });

  it("the desktop panel sits at the foot of the opener's pane", () => {
    render(
      <>
        <div data-pane="">
          <button type="button">Note</button>
        </div>
        <WhichKey phone={false} />
      </>,
    );
    const note = screen.getByRole("button", { name: "Note" });
    const pane = note.parentElement as HTMLElement;
    pane.getBoundingClientRect = () =>
      ({
        left: 120,
        width: 640,
        top: 100,
        right: 760,
        bottom: 500,
        height: 400,
        x: 120,
        y: 100,
        toJSON: () => ({}),
      }) as DOMRect;
    note.focus();

    act(() => {
      beginLeader(paneOpener(stubCommands()));
    });

    const panel = screen.getByRole("dialog");
    expect(panel.style.left).toBe("120px");
    expect(panel.style.width).toBe("640px");
    expect(panel.style.bottom).toBe(`${window.innerHeight - 500}px`);
  });
});
