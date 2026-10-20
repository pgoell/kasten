import { addTab, emptyLayout, goToTab, splitFocused, stepTab, tabPanes } from "@/lib/panes";
import { open } from "./panes-fixture";

describe("tabs", () => {
  it("starts a new one on an empty pane and goes to it", () => {
    const layout = addTab(emptyLayout("a.md"));

    expect(layout.tabs).toHaveLength(2);
    expect(layout.active).toBe(1);
    expect(open(layout)).toBeNull();
  });

  it("wraps walking forward and back", () => {
    const two = addTab(emptyLayout());

    expect(stepTab(two, 1).active).toBe(0);
    expect(stepTab(stepTab(two, 1), -1).active).toBe(1);
  });

  it("jumps to one by position", () => {
    const three = addTab(addTab(emptyLayout()));

    expect(goToTab(three, 0).active).toBe(0);
    expect(goToTab(three, 2).active).toBe(2);
  });

  it("ignores a digit naming a tab that is not open", () => {
    const two = addTab(emptyLayout());

    expect(goToTab(two, 9)).toBe(two);
  });

  it("keeps each tab's own panes and focus apart", () => {
    const first = splitFocused(emptyLayout("a.md"), "row");
    const second = addTab(first);

    expect(tabPanes(second)).toHaveLength(1);
    expect(tabPanes(goToTab(second, 0))).toHaveLength(2);
  });
});
