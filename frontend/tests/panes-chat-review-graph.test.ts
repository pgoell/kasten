import { openBeside, openInFocused } from "@/lib/pane-contents";
import {
  emptyLayout,
  fillFocused,
  focusedPane,
  nextPane,
  splitFocused,
  tabPanes,
} from "@/lib/panes";

describe("the chat over the focused pane", () => {
  it("puts the chat over the focused pane, the note and its line gone", () => {
    const layout = fillFocused(emptyLayout("a.md", 12), { chat: true });

    expect(focusedPane(layout)).toEqual({ id: focusedPane(layout).id, chat: true });
  });

  it("leaves an empty pane behind when the chat is taken out", () => {
    const layout = fillFocused(fillFocused(emptyLayout(), { chat: true }), {});

    expect(focusedPane(layout).chat).toBeUndefined();
    expect(tabPanes(layout)).toHaveLength(1);
  });
});

describe("the review over the focused pane", () => {
  it("puts the review in the focused pane and clears what it held", () => {
    const layout = fillFocused(openInFocused(emptyLayout("a"), "notes/borges.md"), {
      review: true,
    });

    const pane = focusedPane(layout);
    expect(pane?.review).toBe(true);
    expect(pane?.path).toBeUndefined();
  });

  it("leaves every other pane alone", () => {
    const split = splitFocused(emptyLayout("a"), "row");

    const layout = fillFocused(split, { review: true });

    expect(tabPanes(layout).filter((pane) => pane.review === true)).toHaveLength(1);
    expect(tabPanes(layout)).toHaveLength(2);
  });
});

describe("the graph in a pane", () => {
  const NOTE = "ideas/rag.md";

  it("puts the whole vault's graph over the focused pane", () => {
    const layout = fillFocused(emptyLayout(NOTE), { graph: {} });

    expect(tabPanes(layout)).toHaveLength(1);
    expect(focusedPane(layout)).toMatchObject({ graph: {} });
    expect(focusedPane(layout).path).toBeUndefined();
  });

  it("puts a note's local graph beside it, and goes back to it on a second press", () => {
    const once = openBeside(
      emptyLayout(NOTE),
      (pane) => pane.graph?.around === NOTE,
      { graph: { around: NOTE } },
      "row",
    );
    const drawing = focusedPane(once).id;

    expect(tabPanes(once).map((pane) => pane.graph?.around ?? null)).toEqual([null, NOTE]);

    const twice = openBeside(
      nextPane(once),
      (pane) => pane.graph?.around === NOTE,
      { graph: { around: NOTE } },
      "row",
    );

    expect(tabPanes(twice)).toHaveLength(2);
    expect(focusedPane(twice).id).toBe(drawing);
  });
});
