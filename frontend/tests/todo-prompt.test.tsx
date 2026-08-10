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
    /** The terms offered under the input, as they are drawn. */
    hints: () => screen.queryAllByTestId("todo-hint").map((chip) => chip.textContent ?? ""),
    /** Take one of them, the way a click does. */
    take: (label: string) =>
      fireEvent.click(
        screen
          .getAllByTestId("todo-hint")
          .find((chip) => chip.textContent === label) as HTMLElement,
      ),
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

  it("offers the terms the input has not used, in the shorthand it reads", () => {
    const prompt = renderPrompt();

    fireEvent.change(prompt.field, { target: { value: "call the dentist due:08-14" } });

    // The due date is written, so it is not on offer. The glyph is drawn beside
    // the name, the input taking the word.
    expect(prompt.hints()).toEqual([
      "⏳ scheduled",
      "🛫 start",
      "🔺 highest",
      "⏫ high",
      "🔼 medium",
      "🔽 low",
      "⏬ lowest",
      "🔁 daily",
      "🔁 weekly",
      "🔁 monthly",
      "⏲ estimate",
    ]);
  });

  it("writes the term a hint names, and offers the days it takes next", () => {
    const prompt = renderPrompt();

    fireEvent.change(prompt.field, { target: { value: "call the dentist" } });
    prompt.take("⏳ scheduled");
    expect(prompt.field).toHaveValue("call the dentist sched:");

    prompt.take("2026-08-11 tomorrow");
    expect(prompt.field).toHaveValue("call the dentist sched:2026-08-11");
    // And the preview reads it back, which is the whole check that the two
    // halves speak the same language.
    expect(prompt.preview()).toHaveTextContent("⏳ 2026-08-11");
    expect(prompt.field).toHaveFocus();
  });

  it("writes nothing on enter pressed on a hint", () => {
    const prompt = renderPrompt();

    fireEvent.change(prompt.field, { target: { value: "call the dentist" } });
    // Tab reaches the buttons, and the key that takes one bubbles to the
    // dialog, where Enter is the key that writes the todo.
    fireEvent.keyDown(screen.getAllByTestId("todo-hint")[0] as HTMLElement, { key: "Enter" });

    expect(prompt.onAdd).not.toHaveBeenCalled();
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
