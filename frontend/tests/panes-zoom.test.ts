import {
  activeTab,
  addTab,
  emptyLayout,
  focusedPane,
  focusPane,
  nextPane,
  removeFocused,
  splitFocused,
  tabPanes,
  toggleZoom,
} from "@/lib/panes";
import { at } from "./panes-fixture";

describe("zooming a pane", () => {
  it("starts off, turns on and turns back off", () => {
    const layout = splitFocused(emptyLayout("a.md"), "row");

    expect(activeTab(layout).zoom).not.toBe(true);
    expect(activeTab(toggleZoom(layout)).zoom).toBe(true);
    expect(activeTab(toggleZoom(toggleZoom(layout))).zoom).toBe(false);
  });

  it("is one tab's own, the way the focus is", () => {
    const zoomed = toggleZoom(splitFocused(emptyLayout("a.md"), "row"));

    expect(at(addTab(zoomed).tabs, 1).zoom).not.toBe(true);
  });

  it("comes off when the focus moves to another pane", () => {
    const zoomed = toggleZoom(splitFocused(emptyLayout("a.md"), "row"));
    const first = at(tabPanes(zoomed), 0);

    expect(activeTab(focusPane(zoomed, first.id)).zoom).toBe(false);
    expect(activeTab(nextPane(zoomed)).zoom).toBe(false);
  });

  it("stays on while the focus stays put, which a click in the pane reports", () => {
    const zoomed = toggleZoom(splitFocused(emptyLayout("a.md"), "row"));

    expect(activeTab(focusPane(zoomed, focusedPane(zoomed).id)).zoom).toBe(true);
  });

  it("comes off when a pane is opened or closed under it", () => {
    const zoomed = toggleZoom(splitFocused(emptyLayout("a.md"), "row"));

    expect(activeTab(splitFocused(zoomed, "col")).zoom).toBe(false);
    expect(activeTab(removeFocused(zoomed)).zoom).toBe(false);
  });
});
