import { act, cleanup, render, screen, within } from "@testing-library/react";
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

describe("reading the page's selection", () => {
  it("a selection from the focused frame shows the button with the heading and the y hint", () => {
    const { frame } = renderPane();

    frame.focus();
    fromPage(frame.contentWindow, selection());

    const button = takeButton();
    expect({
      present: button !== null,
      heading: button !== null && within(button).getByText("Results").textContent,
      hint: button !== null && within(button).getByText("y").textContent,
    }).toEqual({ present: true, heading: "Results", hint: "y" });
  });

  it("a selection while the frame is not focused shows nothing", () => {
    const { frame } = renderPane();

    fromPage(frame.contentWindow, selection());
    expect(takeButton()).toBeNull();

    // The same selection once the frame holds the focus is shown, so the nothing
    // above was the focus and not the message.
    frame.focus();
    fromPage(frame.contentWindow, selection());
    expect(takeButton()).not.toBeNull();
  });

  it("an empty selection takes the button away", () => {
    const { frame } = renderPane();

    frame.focus();
    fromPage(frame.contentWindow, selection());
    expect(takeButton()).not.toBeNull();

    fromPage(frame.contentWindow, selection({ text: "", heading: "", rect: null }));
    expect(takeButton()).toBeNull();
  });

  it("a selection from another window shows nothing", () => {
    const { frame } = renderPane();
    // A frame nested in the page would be another window, as would one the page opened.
    const nested = document.createElement("iframe");
    document.body.appendChild(nested);

    frame.focus();
    for (const source of [nested.contentWindow, window, null]) {
      fromPage(source, selection());
    }
    expect(takeButton()).toBeNull();

    // The same message from the frame itself is heard.
    fromPage(frame.contentWindow, selection());
    expect(takeButton()).not.toBeNull();
    nested.remove();
  });

  it("malformed selection messages throw nothing and show nothing", () => {
    const { frame } = renderPane();
    const errors = vi.fn();
    window.addEventListener("error", errors);

    frame.focus();
    for (const data of [
      { kasten: "selection" },
      selection({ text: 5 }),
      selection({ heading: undefined }),
      selection({ rect: 5 }),
      selection({ rect: { left: "1", top: 0, right: 1, bottom: 1 } }),
      selection({ rect: { left: Number.NaN, top: 0, right: 1, bottom: 1 } }),
      null,
      "selection",
    ]) {
      fromPage(frame.contentWindow, data);
    }

    expect({ button: takeButton() !== null, errors: errors.mock.calls.length }).toEqual({
      button: false,
      errors: 0,
    });

    // A well-formed selection after them is shown, so the nothing above was the malformed.
    fromPage(frame.contentWindow, selection());
    expect(takeButton()).not.toBeNull();
    window.removeEventListener("error", errors);
  });

  it("a forged selection with a huge heading is clipped", () => {
    const { frame } = renderPane();

    frame.focus();
    fromPage(frame.contentWindow, selection({ heading: "h".repeat(400) }));

    const heading = takeButton()?.querySelector(".max-w-64");
    expect(Array.from(heading?.textContent ?? "").length).toBe(300);
  });
});
