import "@testing-library/jest-dom/vitest";

// pdf.js throws at load in jsdom, which has no canvas to sniff. `pdf-view.ts`
// loads it only when a pdf embed opens its file, but a test that draws one
// with the default renderer would load it, so it goes for all of them; a test
// of a pdf embed hands the widget a fake renderer instead.
vi.mock("foliate-pdfjs", () => ({}));

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

// No layout, so no box ever changes size, and jsdom leaves `ResizeObserver`
// out. Every editor watches its scroller with one, so every test that draws a
// note would throw. One that never reports is what a browser's would do here.
// Assigned rather than `vi.stubGlobal`, for the reason `matchMedia` is below:
// a test that stubs its own wins, and unstubbing falls back to this.
window.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// No layout means no media queries either, and jsdom leaves `matchMedia` out
// altogether, so anything that reads `useViewport` throws on render. Every
// query answers no, which is a wide window and a mouse: the desktop every test
// here was written against. `stubMatchMedia` in `tests/match-media.ts` is for
// the test that wants a phone. Assigned rather than `vi.stubGlobal`, so a
// test's `vi.unstubAllGlobals()` falls back to this and not to nothing.
window.matchMedia = (query: string) =>
  ({
    media: query,
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }) as unknown as MediaQueryList;
