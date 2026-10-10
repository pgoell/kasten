import { render } from "@testing-library/react";
import { useRef } from "react";
import { useKeyboardInset } from "@/lib/use-keyboard-inset";

function Frame({ on }: { on: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  useKeyboardInset(box, on);
  return <div ref={box} data-testid="frame" />;
}

/** A visual viewport a test moves by hand, the way a keyboard moves a real one. */
function stubViewport() {
  const listeners = new Map<string, () => void>();
  const viewport = {
    scale: 1,
    offsetTop: 0,
    height: 800,
    addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
  };
  vi.stubGlobal("visualViewport", viewport);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    bottom: 800,
  } as DOMRect);
  // The layout viewport's height, which jsdom reports as nothing.
  vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(800);
  return { viewport, listeners };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useKeyboardInset", () => {
  it("pads away what an on-screen keyboard covers, and gives it back", () => {
    const { viewport, listeners } = stubViewport();
    const { getByTestId, unmount } = render(<Frame on />);
    const frame = getByTestId("frame");
    expect(frame.style.paddingBottom).toBe("0px");

    viewport.height = 500;
    listeners.get("resize")?.();
    expect(frame.style.paddingBottom).toBe("300px");
    // What a fixed panel inside the frame reads, padding not reaching it.
    expect(frame.style.getPropertyValue("--keyboard")).toBe("300px");

    // The page panned up under the keyboard: less of the frame is covered.
    viewport.offsetTop = 100;
    listeners.get("scroll")?.();
    expect(frame.style.paddingBottom).toBe("200px");

    // A pinch zoom is not a keyboard: the whole layout still shows, at half
    // the height in its own pixels, wherever the reader has panned to.
    viewport.scale = 2;
    viewport.height = 400;
    viewport.offsetTop = 250;
    listeners.get("scroll")?.();
    expect(frame.style.paddingBottom).toBe("0px");

    // A keyboard under a zoom still covers. Safari zooms on the focus of a
    // small input and stays zoomed, so this is a phone's ordinary state. The
    // keyboard is 300px of glass, which at twice the size hides 150 of the
    // layout's pixels: 400 would show, and 250 do.
    viewport.height = 250;
    listeners.get("resize")?.();
    expect(frame.style.paddingBottom).toBe("150px");

    viewport.scale = 1;
    viewport.offsetTop = 0;
    viewport.height = 800;
    listeners.get("resize")?.();
    expect(frame.style.paddingBottom).toBe("0px");

    viewport.height = 500;
    listeners.get("resize")?.();
    unmount();
    expect(frame.style.paddingBottom).toBe("");
    expect(frame.style.getPropertyValue("--keyboard")).toBe("");
    expect(listeners.size).toBe(0);
  });

  it("listens to nothing when it is off", () => {
    const { viewport, listeners } = stubViewport();
    viewport.height = 500;
    const { getByTestId } = render(<Frame on={false} />);

    expect(getByTestId("frame").style.paddingBottom).toBe("");
    expect(listeners.size).toBe(0);
  });

  it("does nothing in a browser with no visual viewport", () => {
    vi.stubGlobal("visualViewport", undefined);
    const { getByTestId } = render(<Frame on />);

    expect(getByTestId("frame").style.paddingBottom).toBe("");
  });
});
