import { openInFocused } from "@/lib/pane-contents";
import {
  addTab,
  closeTab,
  emptyLayout,
  goToTab,
  homeTab,
  isEmptyTab,
  type Layout,
  type Tab,
} from "@/lib/panes";

/** Tabs named by these notes: the first is the window's own, each other one a new tab holding its note. */
function tabsOf(...paths: string[]): Layout {
  return paths
    .slice(1)
    .reduce((layout, path) => openInFocused(addTab(layout), path), emptyLayout(paths[0]));
}

/** The tab at a position, which every test here built and so always exists. */
function tabAt(layout: Layout, index: number): Tab {
  const tab = layout.tabs[index];
  if (tab === undefined) throw new Error(`no tab ${index}`);
  return tab;
}

describe("closeTab", () => {
  it("I1 keeps the active tab active when a tab before it closes", () => {
    const layout = goToTab(tabsOf("a.md", "b.md", "c.md"), 2);

    const closed = closeTab(layout, 0);

    expect(closed.tabs.map((tab) => tab.id)).toEqual([layout.tabs[1]?.id, layout.tabs[2]?.id]);
    expect(closed.active).toBe(1);
  });

  it("I1 moves to the tab that slides into the place of the active one when it closes", () => {
    const layout = goToTab(tabsOf("a.md", "b.md", "c.md"), 1);

    const closed = closeTab(layout, 1);

    expect(closed.tabs.map((tab) => tab.id)).toEqual([layout.tabs[0]?.id, layout.tabs[2]?.id]);
    expect(closed.active).toBe(1);
  });

  it("I1 moves to the last tab when the active one at the end closes", () => {
    const layout = goToTab(tabsOf("a.md", "b.md", "c.md"), 2);

    expect(closeTab(layout, 2).active).toBe(1);
  });

  it("I1 leaves the active tab where it is when a tab after it closes", () => {
    const layout = goToTab(tabsOf("a.md", "b.md", "c.md"), 0);

    expect(closeTab(layout, 2).active).toBe(0);
  });

  it("I1 closing the last tab leaves one empty tab, which is Today", () => {
    const closed = closeTab(emptyLayout("a.md"), 0);

    expect(closed.tabs).toHaveLength(1);
    expect(closed.active).toBe(0);
    expect(isEmptyTab(tabAt(closed, 0))).toBe(true);
  });
});

describe("homeTab", () => {
  it("I2 goes to the first tab holding one empty pane", () => {
    const layout = goToTab(addTab(addTab(tabsOf("a.md", "b.md"))), 0);

    const home = homeTab(layout);

    expect(home.active).toBe(2);
    expect(home.tabs).toHaveLength(4);
  });

  it("I2 starts a new empty tab when no tab is one empty pane", () => {
    const home = homeTab(tabsOf("a.md", "b.md"));

    expect(home.tabs).toHaveLength(3);
    expect(home.active).toBe(2);
    expect(isEmptyTab(tabAt(home, 2))).toBe(true);
  });

  it("I2 does not count a tab showing a note as empty", () => {
    expect(isEmptyTab(tabAt(tabsOf("a.md"), 0))).toBe(false);
  });
});
