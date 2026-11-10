import { fireEvent, render, screen } from "@testing-library/react";
import { Toolbar } from "@/components/toolbar";
import { stubCommands } from "./stub-commands";

const BUTTONS = [
  ["File tree", "toggleTree"],
  ["Find a note", "findNote"],
  ["Open today's note", "openDaily"],
  ["Open the todo pane", "openTodos"],
  ["Open the chat with Claude Code", "openChat"],
  ["Run a command by name", "openPalette"],
  ["Move to the next pane", "nextPane"],
] as const;

describe("Toolbar", () => {
  it.each(BUTTONS)("%s calls %s and nothing else", (name, command) => {
    const commands = stubCommands();
    render(<Toolbar commands={commands} pane="1/2" />);

    fireEvent.click(screen.getByRole("button", { name }));

    for (const [key, spy] of Object.entries(commands)) {
      expect(spy).toHaveBeenCalledTimes(key === command ? 1 : 0);
    }
  });

  it("offers the next pane only where the tab holds one", () => {
    render(<Toolbar commands={stubCommands()} />);

    // Six commands and the space button, which opens the leader on every phone.
    expect(screen.getAllByRole("button")).toHaveLength(7);
    expect(screen.queryByRole("button", { name: "Move to the next pane" })).toBeNull();
  });

  it("shows which pane of the split is in view on the next-pane button", () => {
    render(<Toolbar commands={stubCommands()} pane="2/3" />);

    expect(screen.getByRole("button", { name: "Move to the next pane" })).toHaveTextContent("2/3");
  });

  // jsdom lays nothing out, so this reads the classes that carry the size.
  it("makes every button at least 44px each way", () => {
    render(<Toolbar commands={stubCommands()} pane="1/2" />);

    for (const button of screen.getAllByRole("button")) {
      expect(button).toHaveClass("min-h-11", "min-w-11");
    }
  });

  it("leaves the focus where it was, so the palette opens over the editor", () => {
    render(<Toolbar commands={stubCommands()} pane="1/2" />);

    // An unhandled press is what moves the focus onto a button.
    for (const button of screen.getAllByRole("button")) {
      expect(fireEvent.mouseDown(button)).toBe(false);
      expect(fireEvent.pointerDown(button)).toBe(false);
      expect(button).toHaveAttribute("tabindex", "-1");
    }
  });

  it("goes out of reach when the route says so", () => {
    render(<Toolbar commands={stubCommands()} pane="1/2" inert />);

    expect(screen.getByRole("toolbar", { name: "Commands" })).toHaveAttribute("inert");
  });
});
