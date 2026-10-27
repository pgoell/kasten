import { fireEvent, screen, waitFor } from "@testing-library/react";
import { DEFAULT_VIEWS, VIEWS_NOTE } from "@/lib/todo/todo-view";
import { COARSE, NARROW, stubMatchMedia } from "./match-media";
import { paneHooks, pressFocused, renderPane, TWINS } from "./todo-pane-fixture";

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

  it("#541 A2 holds a row on an id two todos carry, the done twin listed last", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    renderPane(TWINS);
    await waitFor(() => expect(row("write the docs")).toBeDefined());

    expect(row("write the docs")?.textContent).toContain("⛔ kt-aaaaaa");
  });

  it("draws no button a mouse does not need", async () => {
    const pane = renderPane();
    await pane.loaded();
    expect(pane.rows()).toHaveLength(6);

    expect(screen.queryByLabelText("add todo")).toBeNull();
    expect(screen.queryByLabelText(/^cycle /)).toBeNull();
    expect(screen.queryByLabelText(/^more for /)).toBeNull();
    for (const name of ["done", "next", "view"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  it("sends every press of x, however fast, and asks nothing", async () => {
    // A mouse and a keyboard, where a key has never slipped.
    const pane = renderPane();
    await pane.loaded();
    expect(pane.rows()).toHaveLength(6);

    pane.press("x");
    pane.press("x");

    expect(pane.onCycle).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/\?$/)).toBeNull();
  });

  it("keeps the row the only tab stop", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    renderPane();
    await waitFor(() => expect(row("buy milk")).toBeDefined());

    const stops = screen.getAllByRole("button").filter((button) => button.tabIndex === 0);
    expect(stops.filter((button) => button.title !== "")).toHaveLength(1);
    expect(screen.getByLabelText("cycle buy milk").tabIndex).toBe(-1);
  });

  it("opens the add prompt from a button", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = renderPane();
    await waitFor(() => expect(row("buy milk")).toBeDefined());

    fireEvent.click(screen.getByLabelText("add todo"));

    expect(pane.onAdd).toHaveBeenCalledTimes(1);
  });

  const button = (name: string) => screen.getByRole("button", { name });

  it("swaps the list for the finished work from a button, as d does", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = renderPane();
    await waitFor(() => expect(row("buy milk")).toBeDefined());
    expect(button("done")).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(button("done"));

    // Each heading carries its row count beside the day (#811 A3).
    await waitFor(() => expect(pane.headings()).toEqual(["2026-08-10 1", "2026-08-08 1"]));
    expect(button("done")).toHaveAttribute("aria-pressed", "true");
    expect(row("buy milk")).toBeUndefined();

    // And back, the button being the toggle the key is.
    fireEvent.click(button("done"));
    await waitFor(() => expect(row("buy milk")).toBeDefined());
    expect(button("done")).toHaveAttribute("aria-pressed", "false");
  });

  it("shows one next action per todo from a button, as n does", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    renderPane([
      { path: "a.md", line: 1, text: "- [ ] pack" },
      { path: "a.md", line: 2, text: "  - [ ] socks" },
      { path: "a.md", line: 3, text: "  - [ ] shirts" },
    ]);
    await waitFor(() => expect(row("shirts")).toBeDefined());

    fireEvent.click(button("next"));

    // The first open part, named under what it is a part of, and not the rest.
    await waitFor(() => expect(row("shirts")).toBeUndefined());
    expect(row("socks")?.textContent).toContain("pack");
    expect(button("next")).toHaveAttribute("aria-pressed", "true");
    // One list at a time, so the other button reads as off.
    expect(button("done")).toHaveAttribute("aria-pressed", "false");
  });

  it("walks the views from a button, as v does", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = renderPane();
    await waitFor(() => expect(row("buy milk")).toBeDefined());

    fireEvent.click(button("view"));
    await waitFor(() => expect(pane.view()).toBe("today"));
    expect(pane.filter().value).toBe("due:today");
    expect(row("call the dentist")).toBeUndefined();

    fireEvent.click(button("view"));
    await waitFor(() => expect(pane.view()).toBe("doing"));
  });

  it("writes the views note from the button in a vault with none", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    fetchFiles.mockResolvedValue(["projects/kasten.md"]);
    const pane = renderPane();
    await waitFor(() => expect(row("buy milk")).toBeDefined());

    fireEvent.click(button("view"));

    await waitFor(() => expect(pane.view()).toBe("today"));
    expect(createNote).toHaveBeenCalledExactlyOnceWith(VIEWS_NOTE, DEFAULT_VIEWS);
  });

  it("#773 A1 enter on a focused phone state button arms it, not the cursor row's open", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = renderPane();
    await waitFor(() => expect(row("buy milk")).toBeDefined());
    const cycle = screen.getByLabelText("cycle buy milk");
    cycle.focus();

    pressFocused("Enter");

    expect(cycle).toHaveAttribute("aria-pressed", "true");
    expect(pane.onOpen).not.toHaveBeenCalled();
  });
});
