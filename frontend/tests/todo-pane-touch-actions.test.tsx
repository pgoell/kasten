import { fireEvent, screen, waitFor } from "@testing-library/react";
import { COARSE, NARROW, stubMatchMedia } from "./match-media";
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

describe("the todo pane by touch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const row = (text: string) =>
    screen
      .getAllByRole("button")
      .find((button) => button.title !== "" && button.textContent?.includes(text));

  it("opens the source line on a tap of the row", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = renderPane();
    await waitFor(() => expect(row("buy milk")).toBeDefined());

    fireEvent.click(row("buy milk") as HTMLElement);

    expect(pane.onOpen).toHaveBeenCalledWith("projects/kasten.md", 20);
    expect(pane.onCycle).not.toHaveBeenCalled();
  });

  it("opens one row's actions at a time, and closes them on a second tap", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    renderPane();
    await waitFor(() => expect(row("buy milk")).toBeDefined());
    const milk = screen.getByLabelText("more for buy milk");
    const ship = screen.getByLabelText("more for ship it #kasten");
    expect(milk).toHaveAttribute("aria-expanded", "false");
    expect(milk.tabIndex).toBe(-1);
    expect(screen.queryByLabelText("timer buy milk")).toBeNull();

    fireEvent.click(milk);
    expect(milk).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("timer buy milk").tabIndex).toBe(-1);

    fireEvent.click(ship);
    expect(milk).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("timer buy milk")).toBeNull();
    expect(screen.getByLabelText("timer ship it #kasten")).toBeDefined();

    fireEvent.click(ship);
    expect(ship).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("timer ship it #kasten")).toBeNull();
  });

  it("leaves a row being edited alone when edit is tapped on another", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = renderPane();
    await waitFor(() => expect(row("buy milk")).toBeDefined());

    fireEvent.click(screen.getByLabelText("more for buy milk"));
    fireEvent.click(screen.getByLabelText("edit buy milk"));
    pane.write("- [ ] buy oat milk");
    fireEvent.click(screen.getByLabelText("more for ship it #kasten"));
    fireEvent.click(screen.getByLabelText("edit ship it #kasten"));

    // The draft a key could not have dropped, a tap does not drop either.
    expect(pane.draft()).toHaveValue("- [ ] buy oat milk");
  });

  // jsdom applies no media query, so this reads the class that carries one.
  it("draws the line being edited at 16px under a finger, so Safari does not zoom", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = renderPane();
    await waitFor(() => expect(row("buy milk")).toBeDefined());

    fireEvent.click(screen.getByLabelText("more for buy milk"));
    fireEvent.click(screen.getByLabelText("edit buy milk"));

    expect(pane.draft()).toHaveClass("pointer-coarse:text-base");
    expect(screen.getByLabelText("filter todos")).toHaveClass("pointer-coarse:text-base");
  });

  it("starts or stops the timer of the row whose actions are open", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = renderPane();
    await waitFor(() => expect(row("buy milk")).toBeDefined());

    fireEvent.click(screen.getByLabelText("more for buy milk"));
    fireEvent.click(screen.getByLabelText("timer buy milk"));

    expect(pane.onTimer).toHaveBeenCalledExactlyOnceWith(TODOS[3]);
    expect(screen.queryByLabelText("timer buy milk")).toBeNull();
  });

  it("opens the part prompt for the row whose actions are open", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = renderPane();
    await waitFor(() => expect(row("buy milk")).toBeDefined());

    fireEvent.click(screen.getByLabelText("more for buy milk"));
    fireEvent.click(screen.getByLabelText("part buy milk"));

    expect(pane.onSubtask).toHaveBeenCalledExactlyOnceWith(TODOS[3]);
    expect(pane.onAdd).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("part buy milk")).toBeNull();
  });

  it("picks a blocker by taps: the strip, then the row, which opens nothing", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = renderPane();
    await waitFor(() => expect(row("buy milk")).toBeDefined());

    fireEvent.click(screen.getByLabelText("more for buy milk"));
    fireEvent.click(screen.getByLabelText("blocked by buy milk"));
    fireEvent.click(row("renew the passport") as HTMLElement);

    expect(pane.onBlock).toHaveBeenCalledExactlyOnceWith(TODOS[3], TODOS[4]);
    expect(pane.onOpen).not.toHaveBeenCalled();
  });

  it("takes the picker back from a button, there being no escape under a finger", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = renderPane();
    await waitFor(() => expect(row("buy milk")).toBeDefined());

    fireEvent.click(screen.getByLabelText("more for buy milk"));
    fireEvent.click(screen.getByLabelText("blocked by buy milk"));
    fireEvent.click(screen.getByText("cancel"));

    expect(pane.picking()).toBe("");
    expect(pane.onBlock).not.toHaveBeenCalled();
  });

  it("turns the row tapped into its line, wherever the cursor is", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = renderPane();
    await waitFor(() => expect(row("buy milk")).toBeDefined());

    fireEvent.click(screen.getByLabelText("more for buy milk"));
    fireEvent.click(screen.getByLabelText("edit buy milk"));

    // The cursor is still on the first row. The line is the fourth's.
    expect(pane.draft()).toHaveValue(TODOS[3]?.text);
    expect(pane.draft()).toHaveFocus();

    pane.write("- [ ] buy oat milk");
    pane.send("Enter");
    expect(pane.onEdit).toHaveBeenCalledExactlyOnceWith(TODOS[3], "- [ ] buy oat milk");
    expect(pane.draft()).toBeNull();
  });
});
