import { fireEvent, render, screen } from "@testing-library/react";
import { TodoPrompt } from "@/components/todo-prompt";
import { PANEL, PANEL_NARROW } from "@/lib/overlay-styles";

/** The day every test below is written against, so no assertion expires. */
const TODAY = "2026-08-10";

function renderPrompt() {
  const onAdd = vi.fn();
  const onClose = vi.fn();
  render(<TodoPrompt onAdd={onAdd} onClose={onClose} today={TODAY} />);

  return {
    onAdd,
    onClose,
    dialog: screen.getByRole("dialog", { name: "Add todo" }),
    field: screen.getByLabelText("todo"),
    preview: () => screen.getByRole("status"),
  };
}

describe("the same prompt opened on a row", () => {
  it("says which todo the part is going under", () => {
    render(<TodoPrompt onAdd={vi.fn()} onClose={vi.fn()} today={TODAY} under="go to japan" />);

    // The one thing that tells this press from `a`, which writes into today's
    // note wherever the cursor sits.
    expect(screen.getByRole("dialog", { name: "Add part" })).toHaveTextContent("go to japan");
    expect(screen.getByLabelText("part")).toHaveFocus();
  });
});

describe("TodoPrompt", () => {
  const TYPED = "call the dentist due:08-14 !high #health";

  it("takes the focus so the keys reach it", () => {
    const { field } = renderPrompt();

    expect(field).toHaveFocus();
  });

  it("shows the line the vault will get", () => {
    const { field, preview } = renderPrompt();

    fireEvent.change(field, { target: { value: TYPED } });

    expect(preview()).toHaveTextContent(
      "- [ ] call the dentist #health 📅 2026-08-14 ⏫ ➕ 2026-08-10",
    );
  });

  it("adds what was typed rather than what it read out of it", () => {
    // The raw input: the route reads the clock and expands it there, so a
    // prompt left open over midnight writes the date it was taken on.
    const { onAdd, dialog, field } = renderPrompt();

    fireEvent.change(field, { target: { value: TYPED } });
    fireEvent.keyDown(dialog, { key: "Enter" });

    expect(onAdd).toHaveBeenCalledExactlyOnceWith(TYPED);
  });

  it("closes on escape without adding anything", () => {
    const { onAdd, onClose, dialog, field } = renderPrompt();

    fireEvent.change(field, { target: { value: TYPED } });
    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("does nothing on an empty input, and previews nothing either", () => {
    const { onAdd, onClose, dialog, preview } = renderPrompt();

    fireEvent.keyDown(dialog, { key: "Enter" });

    expect(onAdd).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(preview()).toHaveTextContent("");
  });

  it("is built from the shared panel table, at the prompt's width", () => {
    const { dialog } = renderPrompt();

    expect((dialog.firstElementChild as HTMLElement).className).toBe(`${PANEL} ${PANEL_NARROW}`);
  });
});
