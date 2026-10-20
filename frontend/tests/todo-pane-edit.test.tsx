import { fireEvent, screen, waitFor } from "@testing-library/react";
import { paneHooks, renderPane, TODOS } from "./todo-pane-fixture";

// The doubles, the same in every todo-pane file: see todo-pane-fixture.tsx.
const { fetchTodos, fetchNote, fetchFiles, createNote } = vi.hoisted(() => ({
  fetchTodos: vi.fn(),
  fetchNote: vi.fn(),
  fetchFiles: vi.fn(),
  createNote: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ fetchTodos, fetchNote, fetchFiles, createNote }));

paneHooks();

describe("the todo pane", () => {
  it("opens the add prompt on a", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("a");

    // No row and no hit: the todo goes into today's note, wherever the cursor
    // happens to be sitting.
    expect(pane.onAdd).toHaveBeenCalledTimes(1);
  });

  it("opens the same prompt on s, bound to the row under the cursor", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("j");
    pane.press("s");

    // The hit, because the part goes in beside that line rather than into
    // today's note.
    expect(pane.onSubtask).toHaveBeenCalledExactlyOnceWith(TODOS[1]);
    expect(pane.onAdd).not.toHaveBeenCalled();
  });

  it("turns the row under the cursor into its own line on i", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("j");
    pane.press("i");

    // The line as the vault holds it, markdown and all: an edit reaches the
    // fields no shorthand spells by being the line itself.
    expect(pane.draft()).toHaveValue(TODOS[1]?.text);
    expect(pane.draft()).toHaveFocus();
  });

  it("hands the edited line back on enter, and draws a row again", async () => {
    const edited = "- [/] wire up the pane 📅 2026-08-10 ⏳ 2026-08-09 ⏫ #kasten";
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("j");
    pane.press("i");
    pane.write(edited);
    pane.send("Enter");

    // The hit and the line: the write finds the line by path and number, and
    // puts back what the input was left holding.
    expect(pane.onEdit).toHaveBeenCalledExactlyOnceWith(TODOS[1], edited);
    expect(pane.draft()).toBeNull();
  });

  it("writes nothing on escape, and gives the keys back to the row", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    (pane.cursor() as HTMLElement).focus();
    pane.press("i");
    pane.write("- [ ] something else entirely");
    pane.send("Escape");

    expect(pane.onEdit).not.toHaveBeenCalled();
    expect(pane.draft()).toBeNull();
    // The keys are the row's again, so the next one moves the cursor rather
    // than landing in an input that is no longer there.
    expect(pane.cursor()).toHaveFocus();
    pane.press("j");
    pane.press("x");
    expect(pane.onCycle).toHaveBeenCalledWith(TODOS[1]);
  });

  it("keeps the list's keys off the line being edited", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("i");
    // `x` cycles a row and `a` opens the add prompt. In here they are letters.
    fireEvent.keyDown(pane.draft() as HTMLElement, { key: "x" });
    fireEvent.keyDown(pane.draft() as HTMLElement, { key: "a" });

    expect(pane.onCycle).not.toHaveBeenCalled();
    expect(pane.onAdd).not.toHaveBeenCalled();
  });

  it("offers the fields the line has not got, under the line being edited", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("i");

    // The row is overdue and important, so neither the due date nor a priority
    // is a question. Every field a glyph writes and this line has not got is.
    expect(pane.hints()).toEqual([
      "⏳ scheduled",
      "🛫 start",
      "🔁 daily",
      "🔁 weekly",
      "🔁 monthly",
      "🔁 repeat",
      "⏲ estimate",
    ]);
  });

  it("writes the field a hint names, and offers the days it takes next", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("i");
    pane.take("⏳ scheduled");

    // The marker and the space after it, so the day it takes next stands off it.
    expect(pane.draft()).toHaveValue(`${TODOS[0]?.text} ⏳ `);
    // A marker with no day after it is half a field, so the days are what the
    // same row asks next.
    expect(pane.hints().slice(0, 2)).toEqual(["2026-08-10 today", "2026-08-11 tomorrow"]);

    pane.take("2026-08-11 tomorrow");
    expect(pane.draft()).toHaveValue(`${TODOS[0]?.text} ⏳ 2026-08-11`);
    // And the keys go back to the line, so what a hint wrote can be typed over.
    expect(pane.draft()).toHaveFocus();
  });

  it("keeps the list's keys off a hint", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("i");
    // Tab reaches the hints, and a key pressed on one bubbles to the pane. The
    // list is not what those keys are for while a line is being edited.
    fireEvent.keyDown(screen.getAllByTestId("todo-hint")[0] as HTMLElement, { key: "x" });

    expect(pane.onCycle).not.toHaveBeenCalled();
  });

  it("does nothing on i with no row to press it on", async () => {
    const pane = renderPane([]);
    await waitFor(() => expect(pane.rows()).toHaveLength(0));

    pane.press("i");

    expect(pane.draft()).toBeNull();
  });
});
