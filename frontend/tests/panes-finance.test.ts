import { isWholePane } from "@/components/whole-pane";

import { emptyLayout, fillFocused, focusedPane, isEmptyTab } from "@/lib/panes";
import { loadWorkspace, saveWorkspace } from "@/lib/workspace";

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
