import {
  clearFocused,
  openChatInFocused,
  openGraphBeside,
  openGraphInFocused,
  openInFocused,
  openReviewInFocused,
} from "@/lib/pane-contents";
import { emptyLayout, focusedPane, nextPane, splitFocused, tabPanes } from "@/lib/panes";

describe("openChatInFocused", () => {
  it("puts the chat over the focused pane, the note and its line gone", () => {
    const layout = openChatInFocused(emptyLayout("a.md", 12));

    expect(focusedPane(layout)).toEqual({ id: focusedPane(layout).id, chat: true });
  });

  it("leaves an empty pane behind when the chat is taken out", () => {
    const layout = clearFocused(openChatInFocused(emptyLayout()));

    expect(focusedPane(layout).chat).toBeUndefined();
    expect(tabPanes(layout)).toHaveLength(1);
  });
});

describe("openReviewInFocused", () => {
  it("puts the review in the focused pane and clears what it held", () => {
    const layout = openReviewInFocused(openInFocused(emptyLayout("a"), "notes/borges.md"));

    const pane = focusedPane(layout);
    expect(pane?.review).toBe(true);
    expect(pane?.path).toBeUndefined();
  });

  it("leaves every other pane alone", () => {
    const split = splitFocused(emptyLayout("a"), "row");

    const layout = openReviewInFocused(split);

    expect(tabPanes(layout).filter((pane) => pane.review === true)).toHaveLength(1);
    expect(tabPanes(layout)).toHaveLength(2);
  });
});

describe("the graph in a pane", () => {
  const NOTE = "ideas/rag.md";

  it("puts the whole vault's graph over the focused pane", () => {
    const layout = openGraphInFocused(emptyLayout(NOTE));

    expect(tabPanes(layout)).toHaveLength(1);
    expect(focusedPane(layout)).toMatchObject({ graph: {} });
    expect(focusedPane(layout).path).toBeUndefined();
  });

  it("puts a note's local graph beside it, and goes back to it on a second press", () => {
    const once = openGraphBeside(emptyLayout(NOTE), NOTE);
    const drawing = focusedPane(once).id;

    expect(tabPanes(once).map((pane) => pane.graph?.around ?? null)).toEqual([null, NOTE]);

    const twice = openGraphBeside(nextPane(once), NOTE);

    expect(tabPanes(twice)).toHaveLength(2);
    expect(focusedPane(twice).id).toBe(drawing);
  });
});
