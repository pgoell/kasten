import { fireEvent, screen } from "@testing-library/react";
import { COARSE, NARROW, stubMatchMedia } from "./match-media";
import { boardHooks, boardPane } from "./todo-board-pane-fixture";

// The module rather than `fetch`, as the list's own tests stand it in.
const { fetchTodos, fetchNote, fetchFiles, createNote } = vi.hoisted(() => ({
  fetchTodos: vi.fn(),
  fetchNote: vi.fn(),
  fetchFiles: vi.fn(),
  createNote: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ fetchTodos, fetchNote, fetchFiles, createNote }));

boardHooks();

/**
 * The button that folds a lane, found through its heading: the kind filter's
 * pill shares the lane's name, so a button by name alone would find two.
 */
function laneButton(name: string): HTMLButtonElement {
  const heading = screen.getAllByRole("heading").find((one) => one.textContent === name);
  const button = heading?.querySelector("button");
  if (!button) throw new Error(`no lane heading button named ${name}`);
  return button;
}

/** Pick a card up with the mouse: press, then move past what a click may wobble. */
function lift(card: HTMLElement) {
  fireEvent.pointerDown(card, { pointerType: "mouse", pointerId: 1, clientX: 10, clientY: 10 });
  fireEvent.pointerMove(card, { pointerType: "mouse", pointerId: 1, clientX: 30, clientY: 10 });
}

describe("the board's lanes, columns and folds (#811 A6 A7 I3 I5)", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("#811 A6 the lanes switch at the top changes kind to project", async () => {
    const pane = await boardPane();
    const project = screen.getByRole("button", { name: "project" });
    expect(project.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(project);

    expect(project.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "kind" }).getAttribute("aria-pressed")).toBe("false");
    expect(pane.headings()).toEqual(["No project", "FDE"]);
  });

  it("#811 A6 a tap on a lane heading folds the lane and a second unfolds it", async () => {
    const pane = await boardPane();
    const internal = laneButton("#internal");
    expect(internal.getAttribute("aria-expanded")).toBe("true");
    expect(pane.texts()).toContainEqual(expect.stringContaining("write the deck"));

    fireEvent.click(internal);

    // Folded, the lane draws no cards and keeps its count in the heading.
    expect(internal.getAttribute("aria-expanded")).toBe("false");
    expect(internal.getAttribute("data-count")).toBe("3");
    expect(pane.texts()).not.toContainEqual(expect.stringContaining("write the deck"));

    fireEvent.click(internal);

    expect(internal.getAttribute("aria-expanded")).toBe("true");
    expect(pane.texts()).toContainEqual(expect.stringContaining("write the deck"));
  });

  it("#811 A7 rejected is folded on a desktop and a click unfolds it", async () => {
    const pane = await boardPane();
    expect(pane.texts()).not.toContainEqual(expect.stringContaining("drop the logo"));
    const rejected = screen.getByRole("button", { name: "Rejected 1" });
    expect(rejected.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(rejected);

    expect(rejected.getAttribute("aria-expanded")).toBe("true");
    expect(pane.texts()).toContainEqual(expect.stringContaining("drop the logo"));

    fireEvent.click(rejected);

    expect(rejected.getAttribute("aria-expanded")).toBe("false");
    expect(pane.texts()).not.toContainEqual(expect.stringContaining("drop the logo"));
  });

  it("#811 I3 l onto rejected unfolds it while the cursor is there", async () => {
    const pane = await boardPane();
    expect(pane.texts()).not.toContainEqual(expect.stringContaining("drop the logo"));

    // From Open to Rejected is six columns.
    for (let step = 0; step < 6; step += 1) pane.press("l");

    expect(screen.getByRole("button", { name: "Rejected 1" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(pane.texts()).toContainEqual(expect.stringContaining("drop the logo"));

    pane.press("h");

    expect(pane.texts()).not.toContainEqual(expect.stringContaining("drop the logo"));
  });

  it("#811 I5 a card let go over a folded lane writes nothing", async () => {
    const pane = await boardPane();
    fireEvent.click(laneButton("#client"));
    expect(laneButton("#client").getAttribute("data-count")).toBe("1");

    lift(pane.card("write the deck"));
    expect(document.querySelectorAll("[data-lifted]").length).toBe(1);
    fireEvent.pointerUp(laneButton("#client"), { pointerType: "mouse", pointerId: 1 });

    expect(document.querySelectorAll("[data-lifted]").length).toBe(0);
    expect(pane.onCycle).not.toHaveBeenCalled();
    expect(pane.onRefile).not.toHaveBeenCalled();
    expect(pane.onNotice).not.toHaveBeenCalled();
  });

  it("#811 A8 lanes empty in the shown state are folded on the phone", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await boardPane();

    fireEvent.click(screen.getByRole("tab", { name: "Doing 1" }));

    // Doing holds one card, under #internal, so #client has nothing to show.
    const empty = laneButton("#client");
    expect(empty.disabled).toBe(true);
    expect(empty.getAttribute("aria-expanded")).toBe("false");
    expect(laneButton("#internal").getAttribute("aria-expanded")).toBe("true");
    expect(pane.texts()).toEqual([expect.stringContaining("draw the chart")]);
  });
});
