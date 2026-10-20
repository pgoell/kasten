import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { DEFAULT_VIEWS, parseViews } from "@/lib/todo-view";
import { toggleVim } from "@/lib/vim-setting";
import { COARSE, NARROW, stubMatchMedia } from "./match-media";
import { boardHooks, renderPane, TAP } from "./todo-board-pane-fixture";

// The module rather than `fetch`, as the list's own tests stand it in.
const { fetchTodos, fetchNote, fetchFiles, createNote } = vi.hoisted(() => ({
  fetchTodos: vi.fn(),
  fetchNote: vi.fn(),
  fetchFiles: vi.fn(),
  createNote: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ fetchTodos, fetchNote, fetchFiles, createNote }));

boardHooks();

describe("the board by mouse (#419)", () => {
  // The vim setting lives in localStorage, so the two tests that set it put
  // it back for whoever runs next.
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  /** The pane with its rows drawn, which a strip of buttons no longer says. */
  async function listPane(options?: Parameters<typeof renderPane>[0]) {
    const pane = renderPane(options);
    await waitFor(() => expect(document.querySelector("[data-row]")).not.toBeNull());
    return pane;
  }

  const button = (name: string) => screen.getByRole("button", { name });

  it("#419 A1 A4 the strip names its keys on a fine pointer and stays bare on a coarse one", async () => {
    const media = stubMatchMedia();
    await listPane();

    for (const name of ["d done", "n next", "v view", "c board"]) {
      expect(button(name).className).not.toContain("min-h-11");
    }

    media.set(COARSE, true);

    for (const name of ["done", "next", "view", "board"]) {
      expect(button(name).className).toContain("min-h-11 px-3");
      expect(button(name).tabIndex).toBe(-1);
    }
    expect(screen.queryByRole("button", { name: "c board" })).toBeNull();
  });

  it("#419 A6 c and the c board button reach the board, vim on", async () => {
    toggleVim();
    toggleVim();
    expect(localStorage.getItem("kasten.vim")).toBe("on");
    const pane = await listPane();

    pane.press("c");
    await waitFor(() => expect(pane.cards().length).toBeGreaterThan(0));
    pane.press("c");
    expect(pane.cards()).toHaveLength(0);
    fireEvent.click(button("c board"));
    expect(pane.cards().length).toBeGreaterThan(0);
  });

  it("#419 A6 c and the c board button reach the board, vim off", async () => {
    toggleVim();
    expect(localStorage.getItem("kasten.vim")).toBe("off");
    const pane = await listPane();

    pane.press("c");
    await waitFor(() => expect(pane.cards().length).toBeGreaterThan(0));
    pane.press("c");
    expect(pane.cards()).toHaveLength(0);
    fireEvent.click(button("c board"));
    expect(pane.cards().length).toBeGreaterThan(0);
  });

  it("#419 I1 a click on c board leaves the keys on the board, and c goes back to the list", async () => {
    const pane = await listPane({ focusSignal: 1 });
    // What a browser does with a mouse down on a button that jsdom does not.
    act(() => button("c board").focus());

    fireEvent.click(button("c board"));
    await waitFor(() => expect(pane.cards().length).toBeGreaterThan(0));
    const card = document.activeElement as HTMLElement;
    expect(card.hasAttribute("data-card")).toBe(true);
    expect(card.tabIndex).toBe(0);

    fireEvent.keyDown(card, { key: "c" });
    expect(pane.cards()).toHaveLength(0);
    expect(document.activeElement?.hasAttribute("data-row")).toBe(true);
  });

  it("#419 I2 the list footer names c board on a desktop", async () => {
    await listPane();

    expect(screen.getByTestId("todo-footer").textContent).toContain("c board");
  });

  it("#419 B1 a click on the strip while a row is an input leaves the edit be", async () => {
    const pane = await listPane();
    pane.press("i");
    expect(screen.getByLabelText("edit line")).not.toBeNull();

    fireEvent.click(button("c board"));
    fireEvent.click(button("d done"));

    expect(pane.cards()).toHaveLength(0);
    expect(button("d done").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByLabelText("edit line")).not.toBeNull();
  });

  it("#419 B2 a click on the strip while picking a blocker leaves the picker be", async () => {
    const pane = await listPane();
    pane.press("b");
    expect(screen.getByTestId("todo-pick")).not.toBeNull();

    fireEvent.click(button("c board"));
    fireEvent.click(button("d done"));

    expect(pane.cards()).toHaveLength(0);
    expect(button("d done").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTestId("todo-pick")).not.toBeNull();
  });

  /** Every word on the touch strip, tapped once. */
  function tapStrip() {
    for (const name of ["board", "done", "next", "view"]) fireEvent.click(button(name));
  }

  /**
   * The views read and walked back round to none. The vault is only asked at
   * the first `view`, so without this a stray tap would change nothing until
   * the answer came, and a check right after it would pass either way.
   */
  async function viewsInHand(pane: ReturnType<typeof renderPane>) {
    fireEvent.click(button("view"));
    await waitFor(() => expect(pane.filter().value).toBe("due:today"));
    // A tap for each view after the first, and one more past the last.
    const views = parseViews(DEFAULT_VIEWS).length;
    for (let left = 0; left < views; left++) fireEvent.click(button("view"));
    expect(pane.filter().value).toBe("");
  }

  /** What tapStrip must not have changed, the list's own state and the view. */
  function stripUnmoved(pane: ReturnType<typeof renderPane>) {
    expect(pane.cards()).toHaveLength(0);
    expect(button("done").getAttribute("aria-pressed")).toBe("false");
    expect(button("next").getAttribute("aria-pressed")).toBe("false");
    expect(pane.filter().value).toBe("");
    expect(screen.queryByTestId("todo-view")).toBeNull();
  }

  it("#421 A1 I4 a tap on the strip while a row is edited leaves the edit be, vim on", async () => {
    toggleVim();
    toggleVim();
    expect(localStorage.getItem("kasten.vim")).toBe("on");
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await listPane();
    await viewsInHand(pane);
    fireEvent.click(screen.getByLabelText("more for fix the tap"));
    fireEvent.click(screen.getByLabelText("edit fix the tap"));
    expect(screen.getByLabelText("edit line")).not.toBeNull();

    tapStrip();

    stripUnmoved(pane);
    expect(screen.getByLabelText("edit line")).not.toBeNull();
  });

  it("#421 A2 I4 a tap on the strip while picking a blocker leaves the picker be, vim off", async () => {
    toggleVim();
    expect(localStorage.getItem("kasten.vim")).toBe("off");
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await listPane();
    await viewsInHand(pane);
    fireEvent.click(screen.getByLabelText("more for fix the tap"));
    fireEvent.click(screen.getByLabelText("blocked by fix the tap"));
    expect(screen.getByTestId("todo-pick")).not.toBeNull();

    tapStrip();

    stripUnmoved(pane);
    expect(screen.getByTestId("todo-pick")).not.toBeNull();
  });

  it("#421 I1 once the edit ends a tap on the strip works again", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await listPane();
    fireEvent.click(screen.getByLabelText("more for fix the tap"));
    fireEvent.click(screen.getByLabelText("edit fix the tap"));
    fireEvent.keyDown(screen.getByLabelText("edit line"), { key: "Escape" });
    expect(screen.queryByLabelText("edit line")).toBeNull();

    fireEvent.click(button("board"));
    expect(pane.cards().length).toBeGreaterThan(0);
  });

  it("#421 I1 once the edit is written with Enter a tap on the strip works again", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await listPane();
    fireEvent.click(screen.getByLabelText("more for fix the tap"));
    fireEvent.click(screen.getByLabelText("edit fix the tap"));
    fireEvent.keyDown(screen.getByLabelText("edit line"), { key: "Enter" });
    expect(pane.onEdit).toHaveBeenCalledWith(TAP, TAP?.text);
    expect(screen.queryByLabelText("edit line")).toBeNull();

    fireEvent.click(button("board"));
    expect(pane.cards().length).toBeGreaterThan(0);
  });

  it("#421 I2 once the picker is cancelled a tap on the strip works again", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await listPane();
    fireEvent.click(screen.getByLabelText("more for fix the tap"));
    fireEvent.click(screen.getByLabelText("blocked by fix the tap"));
    fireEvent.click(button("cancel"));

    expect(screen.queryByTestId("todo-pick")).toBeNull();
    expect(button("done").getAttribute("aria-pressed")).toBe("false");
    expect(button("next").getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button("board"));
    expect(pane.cards().length).toBeGreaterThan(0);
  });

  it("#419 I3 the desktop strip stays out of the tab order", async () => {
    await listPane();

    for (const name of ["d done", "n next", "v view", "c board"]) {
      expect(button(name).tabIndex).toBe(-1);
    }
  });

  it("#419 I5 the desktop strip says which of done, next and board is on", async () => {
    const pane = await listPane();
    const pressed = (name: string) => button(name).getAttribute("aria-pressed");
    expect([pressed("d done"), pressed("n next"), pressed("c board")]).toEqual([
      "false",
      "false",
      "false",
    ]);

    pane.press("d");
    expect([pressed("d done"), pressed("n next")]).toEqual(["true", "false"]);
    pane.press("n");
    expect([pressed("d done"), pressed("n next")]).toEqual(["false", "true"]);
    pane.press("c");
    expect(pressed("c board")).toBe("true");
  });
});
