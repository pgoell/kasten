import "@testing-library/jest-dom/vitest";

// jsdom does no layout, so a Range has none of the rect methods CodeMirror
// measures text with. CodeMirror runs that measurement on an animation frame,
// which lands after any test that waits for something, and the throw is then
// charged to whichever test happened to be running. Empty rects are enough:
// nothing here asks where a character sits on screen.
Range.prototype.getClientRects = () =>
  Object.assign([] as DOMRect[], { item: () => null }) as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

// Nothing to scroll for the same reason, so jsdom implements the method not at
// all and a component that keeps its cursor on screen throws before it can be
// asserted on. Here rather than a `?.()` at the call site, which would swallow
// the day a real browser stops having it too.
Element.prototype.scrollIntoView = () => {};
