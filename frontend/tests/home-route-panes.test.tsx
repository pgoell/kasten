import { focusedPaneOf } from "./home-route-panes";

describe("focusedPaneOf", () => {
  it("R13 two visible panes with no focus line name no focused pane", () => {
    const container = document.createElement("div");
    container.innerHTML = `<div data-pane="a"></div><div data-pane="b"></div>`;

    expect(focusedPaneOf(container)).toBe(-1);
  });
});
