import { fireEvent, render, screen } from "@testing-library/react";
import { DumpPrompt } from "@/components/dump-prompt";

function renderPrompt() {
  const onCapture = vi.fn();
  const onClose = vi.fn();
  render(<DumpPrompt onCapture={onCapture} onClose={onClose} today="2026-09-29" />);

  return {
    onCapture,
    onClose,
    dialog: screen.getByRole("dialog", { name: "Capture a thought" }),
    field: screen.getByLabelText("dump"),
  };
}

describe("DumpPrompt", () => {
  it("takes the focus so the keys reach it, and says which day it writes to", () => {
    const { dialog, field } = renderPrompt();

    expect(field).toHaveFocus();
    expect(dialog).toHaveTextContent("2026-09-29");
  });

  it("hands over what was typed, trimmed, on Enter", () => {
    const { field, onCapture } = renderPrompt();

    fireEvent.change(field, { target: { value: "  ask Jonas about the flat  " } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(onCapture).toHaveBeenCalledWith("ask Jonas about the flat");
  });

  it("does nothing on Enter with nothing typed", () => {
    const { field, onCapture, onClose } = renderPrompt();

    fireEvent.change(field, { target: { value: "   " } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(onCapture).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on Escape and writes nothing", () => {
    const { field, onCapture, onClose } = renderPrompt();

    fireEvent.change(field, { target: { value: "half a thought" } });
    fireEvent.keyDown(field, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCapture).not.toHaveBeenCalled();
  });

  it("gives the focus back to whatever held it when it opened", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();

    const { unmount } = render(
      <DumpPrompt onCapture={vi.fn()} onClose={vi.fn()} today="2026-09-29" />,
    );
    unmount();

    expect(opener).toHaveFocus();
    opener.remove();
  });
});
