import { fireEvent, render, screen } from "@testing-library/react";
import { TerminalPrompt } from "@/components/terminal-prompt";
import { PANEL, PANEL_NARROW } from "@/lib/overlay-styles";

const SESSIONS = ["agent-kasten", "notes", "scratch"];

function renderPrompt(sessions = SESSIONS) {
  const onOpen = vi.fn();
  const onClose = vi.fn();
  render(<TerminalPrompt sessions={sessions} onOpen={onOpen} onClose={onClose} />);

  return {
    onOpen,
    onClose,
    dialog: screen.getByRole("dialog", { name: "Open terminal" }),
    field: screen.getByLabelText("terminal"),
  };
}

describe("TerminalPrompt", () => {
  it("takes the focus so the keys reach it", () => {
    const { field } = renderPrompt();

    expect(field).toHaveFocus();
  });

  it("opens the session the name spells", () => {
    const { onOpen, dialog, field } = renderPrompt();

    fireEvent.change(field, { target: { value: "agent-kasten" } });
    fireEvent.keyDown(dialog, { key: "Enter" });

    expect(onOpen).toHaveBeenCalledExactlyOnceWith("agent-kasten");
  });

  it("closes on escape without opening anything", () => {
    const { onOpen, onClose, dialog } = renderPrompt();

    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("refuses a name herdr cannot take, and says why", () => {
    // A key that does nothing and says nothing reads as a key that is broken,
    // so the rule is on screen rather than only in the regular expression.
    const { onOpen, dialog, field } = renderPrompt();

    fireEvent.change(field, { target: { value: "my session" } });
    fireEvent.keyDown(dialog, { key: "Enter" });

    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(/letters, numbers/i);
  });

  it("does nothing on an empty name", () => {
    const { onOpen, dialog } = renderPrompt();

    fireEvent.keyDown(dialog, { key: "Enter" });

    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(/letters, numbers/i);
  });

  it("is built from the shared panel table, at the prompt's width", () => {
    // Not compared against the finder's or the search's: both are PANEL_WIDE,
    // so that comparison would fail for a reason that is not a defect. This is
    // the prompt's own pair, which the note prompt uses too.
    const { dialog } = renderPrompt();

    expect((dialog.firstElementChild as HTMLElement).className).toBe(`${PANEL} ${PANEL_NARROW}`);
  });

  it("offers the sessions that already exist", () => {
    renderPrompt();

    for (const name of SESSIONS) {
      expect(screen.getByRole("option", { name })).toBeInTheDocument();
    }
  });

  it("narrows the list to what has been typed", () => {
    const { field } = renderPrompt();

    fireEvent.change(field, { target: { value: "not" } });

    expect(screen.getByRole("option", { name: "notes" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "scratch" })).not.toBeInTheDocument();
  });

  it("takes the highlighted session on Tab, so a name need not be typed out", () => {
    const { dialog, field } = renderPrompt();

    fireEvent.change(field, { target: { value: "scr" } });
    fireEvent.keyDown(dialog, { key: "Tab" });

    expect(field).toHaveValue("scratch");
  });

  it("opens the session a row is clicked on", () => {
    const { onOpen } = renderPrompt();

    fireEvent.click(screen.getByRole("option", { name: "notes" }));

    expect(onOpen).toHaveBeenCalledExactlyOnceWith("notes");
  });

  it("still takes a name nothing answers to, which starts a session", () => {
    const { onOpen, dialog, field } = renderPrompt();

    fireEvent.change(field, { target: { value: "brand-new" } });
    fireEvent.keyDown(dialog, { key: "Enter" });

    expect(onOpen).toHaveBeenCalledExactlyOnceWith("brand-new");
  });

  it("draws no list when the backend named no sessions", () => {
    // The mount is optional and the shell container need not be up, so the
    // prompt has to work as a bare input.
    renderPrompt([]);

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
