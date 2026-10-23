import { act, cleanup, render, screen } from "@testing-library/react";
import { HtmlPane } from "@/components/html-pane";
import { COARSE, stubMatchMedia } from "./match-media";
import { stubCommands } from "./stub-commands";

// Where the take button sits for a selection: above the words with a mouse,
// below them on a touch screen, and inside the frame either way. The take
// itself is in html-pane-take.test.tsx.

const PATH = "30 Research/report.html";
const RECT = { left: 100, top: 100, right: 160, bottom: 120 };

/** A message as the window hears it, from `source`, the way a page's script posts one. */
function fromPage(source: Window | null, data: unknown) {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, source }));
  });
}

/** What the page sends for a selection, with the fields the test does not name. */
function selection(over: Record<string, unknown> = {}) {
  return {
    kasten: "selection",
    text: "A passage of the report.",
    heading: "Results",
    anchor: "results",
    rect: RECT,
    ...over,
  };
}

/** The DOMRect a measured element answers with, which jsdom leaves as zeros. */
function boxAt(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

function renderPane(path = PATH, props: { anchor?: string } = {}) {
  const view = render(
    <HtmlPane path={path} {...props} commands={stubCommands()} onFocus={() => {}} />,
  );
  const frame = view.container.querySelector("iframe") as HTMLIFrameElement;
  return { frame };
}

/** The frame's box and its wrapper's, both at the same place on a 600 by 400 pane. */
function measure(frame: HTMLIFrameElement) {
  const wrapper = frame.parentElement as HTMLElement;
  vi.spyOn(frame, "getBoundingClientRect").mockReturnValue(boxAt(0, 50, 600, 400));
  vi.spyOn(wrapper, "getBoundingClientRect").mockReturnValue(boxAt(0, 50, 600, 400));
}

/** The take button, as a reader finds it. */
function takeButton() {
  return screen.queryByRole("button", { name: "Take the passage" });
}

beforeEach(() => {
  localStorage.clear();
  stubMatchMedia({});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("placing the take button", () => {
  it("the button sits above the words on a fine pointer", () => {
    const { frame } = renderPane();
    measure(frame);

    frame.focus();
    fromPage(frame.contentWindow, selection());

    const button = takeButton();
    expect({
      left: button?.style.left,
      top: button?.style.top,
      above: button?.classList.contains("-translate-y-full"),
    }).toEqual({ left: "130px", top: "100px", above: true });
  });

  it("the button sits below the words on a touch screen, clear of the phone's menu", () => {
    stubMatchMedia({ [COARSE]: true });
    const { frame } = renderPane();
    measure(frame);

    frame.focus();
    fromPage(frame.contentWindow, selection());

    const button = takeButton();
    expect({
      left: button?.style.left,
      top: button?.style.top,
      above: button?.classList.contains("-translate-y-full"),
    }).toEqual({ left: "130px", top: "152px", above: false });
  });

  it("the button is kept inside the frame when the words sit at its top left corner", () => {
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(157);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(24);
    const { frame } = renderPane();
    measure(frame);

    frame.focus();
    fromPage(frame.contentWindow, selection({ rect: { left: 0, top: 0, right: 10, bottom: 10 } }));

    // Half its width in from the left, and its full height down from the top.
    const button = takeButton();
    expect({ left: button?.style.left, top: button?.style.top }).toEqual({
      left: "78.5px",
      top: "24px",
    });
  });

  it("a wide button near the left edge stays inside the frame", () => {
    // A 157px button, as the heading makes it, centred on a selection 66px from the left.
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(157);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(24);
    const { frame } = renderPane();
    measure(frame);

    frame.focus();
    fromPage(
      frame.contentWindow,
      selection({ rect: { left: 46, top: 100, right: 86, bottom: 120 } }),
    );

    const button = takeButton();
    expect(Number.parseFloat(button?.style.left ?? "") - 157 / 2).toBeGreaterThanOrEqual(0);
  });

  it("opens the frame at the heading a link named, in the pane's own anchor", () => {
    const { frame } = renderPane(PATH, { anchor: "the paper" });

    expect(frame.getAttribute("src")?.endsWith("#the%20paper")).toBe(true);
  });
});
