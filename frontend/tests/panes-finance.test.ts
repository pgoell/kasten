import { isWholePane } from "@/components/pane-body";

import { emptyLayout, fillFocused, focusedPane, isEmptyTab } from "@/lib/panes/layout/panes";
import { loadWorkspace, saveWorkspace } from "@/lib/panes/layout/workspace";

const FINE = "kasten.workspace.1";

afterEach(() => {
  localStorage.removeItem(FINE);
});

describe("the finance pane in a pane", () => {
  it("#1035 opens in the focused pane, fills it, and is kept in the saved layout", () => {
    const before = emptyLayout("a.md", 12);
    const layout = fillFocused(before, { finance: true });
    const pane = focusedPane(layout);

    expect(pane.finance).toBe(true);
    expect(pane.path).toBeUndefined();
    expect(pane.id).toBe(focusedPane(before).id);
    expect(isWholePane(pane)).toBe(true);
    expect(layout.tabs.every((tab) => !isEmptyTab(tab))).toBe(true);

    saveWorkspace(false, layout, true);
    expect(loadWorkspace(false)?.layout.tabs[0]?.root).toMatchObject({ finance: true });
  });
});

describe("a pane that fills the whole pane", () => {
  it("#1718 is the training pane, not a chat pane, a note or a kind set to false", () => {
    expect(isWholePane({ id: "p", training: true })).toBe(true);
    expect(isWholePane({ id: "p", chat: true })).toBe(false);
    expect(isWholePane({ id: "p", path: "a.md" })).toBe(false);
    expect(isWholePane({ id: "p", training: false })).toBe(false);
  });
});
