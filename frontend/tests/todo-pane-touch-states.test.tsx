import { act, fireEvent, screen, waitFor } from "@testing-library/react";
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

  it("asks on the first tap of the state and cycles on the second, opening nothing", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = renderPane();
    await waitFor(() => expect(row("buy milk")).toBeDefined());
    const state = screen.getByLabelText("cycle buy milk");

    fireEvent.click(state);
    // The state the second tap would leave, and a question mark.
    expect(state.querySelector('svg[data-state="doing"]')).not.toBeNull();
    expect(state.textContent).toBe("?");
    expect(state.getAttribute("aria-pressed")).toBe("true");
    expect(pane.onCycle).not.toHaveBeenCalled();

    fireEvent.click(state);
    // The hit and no state, which is what `x` sends.
    expect(pane.onCycle).toHaveBeenCalledTimes(1);
    expect(pane.onCycle).toHaveBeenCalledWith(TODOS[3]);
    expect(state.querySelector('svg[data-state="open"]')).not.toBeNull();
    expect(pane.onOpen).not.toHaveBeenCalled();
  });

  it("ticks a review row done on the second tap of its state", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const hit = { path: "a.md", line: 1, text: "- [r] write the parser 📅 2026-08-10" };
    const pane = renderPane([hit]);
    await waitFor(() => expect(row("write the parser")).toBeDefined());
    const state = screen.getByLabelText("cycle write the parser");
    expect(state.querySelector('svg[data-state="review"]')).not.toBeNull();

    fireEvent.click(state);
    // Review leaves the walk for done, which is the owner's approval.
    expect(state.querySelector('svg[data-state="done"]')).not.toBeNull();
    expect(state.textContent).toBe("?");
    expect(pane.onCycle).not.toHaveBeenCalled();

    fireEvent.click(state);
    expect(pane.onCycle).toHaveBeenCalledExactlyOnceWith(hit);
  });

  it("names the states in the strip in the order of the shifted keys", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    renderPane();
    await waitFor(() => expect(row("buy milk")).toBeDefined());

    fireEvent.click(screen.getByLabelText("more for buy milk"));

    const states = ["open", "doing", "review", "done", "blocked", "waiting", "rejected"];
    const labels = screen
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label") ?? "")
      .filter((label) => states.some((one) => label === `${one} buy milk`));
    expect(labels).toEqual(states.map((one) => `${one} buy milk`));
  });

  it("asks about one row at a time", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = renderPane();
    await waitFor(() => expect(row("buy milk")).toBeDefined());

    fireEvent.click(screen.getByLabelText("cycle buy milk"));
    fireEvent.click(screen.getByLabelText("cycle renew the passport"));

    expect(screen.getByLabelText("cycle buy milk").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByLabelText("cycle renew the passport").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(pane.onCycle).not.toHaveBeenCalled();
  });

  it("takes the question back on a tap elsewhere, which then does what it was for", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = renderPane();
    await waitFor(() => expect(row("buy milk")).toBeDefined());
    const state = screen.getByLabelText("cycle buy milk");

    fireEvent.click(state);
    // A tap is a press and then a click, and the press is what disarms.
    fireEvent.pointerDown(row("buy milk") as HTMLElement);
    fireEvent.click(row("buy milk") as HTMLElement);

    expect(state.getAttribute("aria-pressed")).toBe("false");
    expect(pane.onOpen).toHaveBeenCalledWith("projects/kasten.md", 20);

    // The press of the second tap on the armed button itself leaves it armed.
    fireEvent.click(state);
    fireEvent.pointerDown(state);
    expect(state.getAttribute("aria-pressed")).toBe("true");
    expect(pane.onCycle).not.toHaveBeenCalled();
  });

  it("does not carry the question onto another todo that lands on the line", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = renderPane();
    await waitFor(() => expect(row("buy milk")).toBeDefined());

    fireEvent.click(screen.getByLabelText("cycle buy milk"));
    // A write from elsewhere put a line above, so line 20 is another todo now.
    pane.answer(
      TODOS.map((hit) =>
        hit.line === 20 ? { ...hit, text: "- [ ] feed the cat 📅 2026-08-14 🔽" } : hit,
      ),
    );
    const state = await screen.findByLabelText("cycle feed the cat");
    expect(state.getAttribute("aria-pressed")).toBe("false");
    expect(state.querySelector('svg[data-state="open"]')).not.toBeNull();

    // A first tap for this todo, which asks and writes nothing.
    fireEvent.click(state);
    expect(state.getAttribute("aria-pressed")).toBe("true");
    expect(pane.onCycle).not.toHaveBeenCalled();
  });

  it("takes the question back when the list scrolls", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = renderPane();
    await waitFor(() => expect(row("buy milk")).toBeDefined());
    const state = screen.getByLabelText("cycle buy milk");

    fireEvent.click(state);
    fireEvent.scroll(state.closest(".overflow-auto") as HTMLElement);

    expect(state.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(state);
    expect(pane.onCycle).not.toHaveBeenCalled();
  });

  it("takes the question back after four seconds", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = renderPane();
    await waitFor(() => expect(row("buy milk")).toBeDefined());
    // Only now: `waitFor` polls on a timer, and a faked one never fires.
    vi.useFakeTimers();
    const state = screen.getByLabelText("cycle buy milk");

    fireEvent.click(state);
    act(() => vi.advanceTimersByTime(3999));
    expect(state.getAttribute("aria-pressed")).toBe("true");

    act(() => vi.advanceTimersByTime(1));
    expect(state.getAttribute("aria-pressed")).toBe("false");
    // A tap now is a first tap again.
    fireEvent.click(state);
    expect(pane.onCycle).not.toHaveBeenCalled();
  });

  it.each([
    ["open", "open"],
    ["doing", "doing"],
    ["review", "review"],
    ["done", "done"],
    ["blocked", "blocked"],
    ["waiting", "waiting"],
    ["rejected", "rejected"],
  ])("sets the state on a tap of %s, and closes the actions", async (label, state) => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = renderPane();
    await waitFor(() => expect(row("buy milk")).toBeDefined());

    fireEvent.click(screen.getByLabelText("more for buy milk"));
    fireEvent.click(screen.getByLabelText(`${label} buy milk`));

    // The row tapped and not the cursor's, with the state a shifted key sends,
    // and on the one tap: a state picked out of an open strip is meant.
    expect(pane.onCycle).toHaveBeenCalledExactlyOnceWith(TODOS[3], state);
    expect(screen.queryByLabelText(`${label} buy milk`)).toBeNull();
  });

  it("takes the question off a state button when a strip opens, this row's or another's", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = renderPane();
    await waitFor(() => expect(row("buy milk")).toBeDefined());
    const state = () => screen.getByLabelText("cycle buy milk");

    for (const other of ["more for buy milk", "more for ship it #kasten"]) {
      fireEvent.click(state());
      expect(state()).toHaveAttribute("aria-pressed", "true");

      fireEvent.click(screen.getByLabelText(other));

      expect(state()).toHaveAttribute("aria-pressed", "false");
      expect(state().textContent).not.toContain("?");
    }
    // So the next tap on the state asks again, and writes nothing.
    fireEvent.click(state());
    expect(pane.onCycle).not.toHaveBeenCalled();
  });

  it("does not carry an open strip onto another todo that lands on the line", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = renderPane();
    await waitFor(() => expect(row("buy milk")).toBeDefined());

    fireEvent.click(screen.getByLabelText("more for buy milk"));
    expect(screen.getByLabelText("done buy milk")).toBeInTheDocument();
    // A write from elsewhere put a line above, so line 20 is another todo now.
    pane.answer(
      TODOS.map((hit) =>
        hit.line === 20 ? { ...hit, text: "- [ ] feed the cat 📅 2026-08-14 🔽" } : hit,
      ),
    );
    const more = await screen.findByLabelText("more for feed the cat");

    // No strip under the todo nobody opened one for, so no `done` to tap.
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("done feed the cat")).toBeNull();
    expect(pane.onCycle).not.toHaveBeenCalled();
  });

  it("shuts an open strip when a state button is tapped, so only one of the two shows", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = renderPane();
    await waitFor(() => expect(row("buy milk")).toBeDefined());

    fireEvent.click(screen.getByLabelText("more for buy milk"));
    fireEvent.click(screen.getByLabelText("cycle ship it #kasten"));

    expect(screen.getByLabelText("cycle ship it #kasten")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("more for buy milk")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("done buy milk")).toBeNull();
    expect(pane.onCycle).not.toHaveBeenCalled();
  });
});
