import { openLogInFocused } from "@/lib/pane-contents";
import { emptyLayout, focusedPane, tabPanes } from "@/lib/panes";
import { loadWorkspace, saveWorkspace } from "@/lib/workspace";

const FINE = "kasten.workspace.1";

afterEach(() => {
  localStorage.removeItem(FINE);
});

describe("the log in a pane", () => {
  it("#624 the log pane opens in the focused pane and is kept in the saved layout", () => {
    const before = emptyLayout("a.md", 12);
    const layout = openLogInFocused(before);

    expect(focusedPane(layout).log).toBe(true);
    expect(focusedPane(layout).path).toBeUndefined();
    expect(focusedPane(layout).id).toBe(focusedPane(before).id);
    expect(tabPanes(layout)).toHaveLength(1);

    saveWorkspace(false, layout, true);
    expect(loadWorkspace(false)?.layout.tabs[0]?.root).toMatchObject({ log: true });
  });
});
