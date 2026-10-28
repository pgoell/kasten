/**
 * Pinch, pan and double tap on a real pdf pane, in real Chromium (#991): a phone
 * fits an A4 page to the pane at about 44 % of its size, too small to read.
 *
 * The pinch and the taps are `TouchEvent`s made in the page, which reach the
 * pane's listeners the way a finger's do. A one-finger pan has to be the
 * browser's own scroll, which such an event never starts, so it goes through
 * the DevTools protocol (`touchDrag`), as the wheel does.
 */

import "./pdf-take-api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { flushSync } from "react-dom";
import { commands as browser, page, userEvent } from "vitest/browser";
import { PdfPane } from "@/components/pdf-pane";
import { useVim } from "@/lib/editor/vim-setting";
import { toggleTheme } from "@/lib/theme";
import "@/styles/app.css";
import { api, type Mounted, setUp, takeButton, tearDown } from "./html-take-fixture";
import { PAGE_ONE } from "./pdf-fixture";

const PATH = "take/plan.pdf";
const WORDS = PAGE_ONE[0] ?? "";

vi.setConfig({ testTimeout: 40_000 });

let mounted: Mounted;

beforeEach(async () => {
  mounted = await setUp();
});

afterEach(async () => {
  await tearDown(mounted);
});

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  flushSync(() =>
    mounted.root.render(
      <QueryClientProvider client={client}>
        <div className="flex h-dvh flex-row">
          <div data-pane className="flex min-w-0 flex-1 flex-col">
            <PdfPane
              path={PATH}
              opened={1}
              commands={mounted.spy}
              focusSignal={1}
              onNoteBeside={() => {}}
            />
          </div>
        </div>
      </QueryClientProvider>,
    ),
  );
}

const pane = () => mounted.host.querySelector(`[data-pdf-pane="${PATH}"]`) as HTMLElement;
const box = () => pane().querySelector("[data-pdf-box]") as HTMLElement;
const slot = (number = 1) => box().querySelector(`[data-pdf-page="${number}"]`) as HTMLElement;
const readout = () => pane().querySelector("[aria-live]")?.textContent;
const zoomIn = () => pane().querySelector('[aria-label="Zoom in"]') as HTMLButtonElement;

/** Waits for page one's canvas and text, the page drawn. */
async function drawn() {
  await vi.waitFor(
    () => {
      const span = [...slot().querySelectorAll(".textLayer span")].find((one) =>
        (one.textContent ?? "").includes(WORDS),
      );
      expect(span).toBeDefined();
    },
    { timeout: 20_000 },
  );
}

/** A phone at 414 by 896 with touch, the pane over the fixture, drawn. */
async function phone() {
  await page.viewport(414, 896);
  await browser.emulateMedia({ touch: true });
  mount();
  await drawn();
}

interface Point {
  x: number;
  y: number;
}

/** A point of the box, in the page's coordinates, from one in the box's. */
function inPage(at: Point): Point {
  const rect = box().getBoundingClientRect();
  return { x: rect.left + at.x, y: rect.top + at.y };
}

/** A `TouchEvent` of `type` with fingers at `points` (box coordinates) on the box. */
function touch(type: string, points: Point[], changed: Point[] = points): TouchEvent {
  const target = box();
  const make = (point: Point, index: number) => {
    const { x, y } = inPage(point);
    return new Touch({ identifier: index, target, clientX: x, clientY: y });
  };
  const event = new TouchEvent(type, {
    touches: points.map(make),
    changedTouches: changed.map(make),
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

/**
 * Two fingers about `middle`, spread `from` px apart and moved in steps to `to`.
 * Returns the last move, to read whether it was cancelled.
 */
function pinch(middle: Point, from: number, to: number, lift = true): TouchEvent {
  const fingers = (spread: number): Point[] => [
    { x: middle.x - spread / 2, y: middle.y },
    { x: middle.x + spread / 2, y: middle.y },
  ];
  touch("touchstart", fingers(from));
  let last = touch("touchmove", fingers(from));
  for (let step = 1; step <= 5; step += 1)
    last = touch("touchmove", fingers(from + ((to - from) * step) / 5));
  if (lift) touch("touchend", [], fingers(to));
  return last;
}

/** A tap at `at`, down and up. */
function tap(at: Point) {
  touch("touchstart", [at]);
  touch("touchend", [], [at]);
}

/** Where `at` (box coordinates) falls on page one, as shares of its width and height. */
function onPage(at: Point): Point {
  const page = slot().getBoundingClientRect();
  const { x, y } = inPage(at);
  return { x: (x - page.left) / page.width, y: (y - page.top) / page.height };
}

const MIDDLE = { x: 150, y: 200 };

describe("the pdf pane zooms under fingers", () => {
  it("two fingers zoom the page around the pinch point", async () => {
    await phone();
    const before = onPage(MIDDLE);
    const fit = slot().getBoundingClientRect().width;

    pinch(MIDDLE, 100, 200);

    await vi.waitFor(() => expect(readout()).toBe("200%"));
    expect(slot().getBoundingClientRect().width).toBeCloseTo(fit * 2, 0);
    const after = onPage(MIDDLE);
    expect(after.x).toBeCloseTo(before.x, 2);
    expect(after.y).toBeCloseTo(before.y, 2);
  });

  it("the browser does not zoom the app under two fingers, and one finger is left to it", async () => {
    await phone();

    expect(getComputedStyle(box()).touchAction).toBe("pan-x pan-y");
    expect(pinch(MIDDLE, 100, 150).defaultPrevented).toBe(true);
    touch("touchstart", [MIDDLE]);
    expect(touch("touchmove", [{ x: MIDDLE.x, y: MIDDLE.y - 40 }]).defaultPrevented).toBe(false);
    touch("touchend", [], [MIDDLE]);
  });

  it("after a pinch the page is drawn again at the new zoom, sharp", async () => {
    await phone();

    pinch(MIDDLE, 100, 200);

    const fit = box().clientWidth;
    await vi.waitFor(() => {
      const canvas = slot().querySelector("canvas") as HTMLCanvasElement;
      expect(slot().clientWidth).toBeGreaterThan(fit * 1.9);
      expect(canvas.width).toBe(Math.floor(slot().clientWidth * window.devicePixelRatio));
    });
  });

  it("at zoom one finger pans the page both ways", async () => {
    await phone();
    pinch(MIDDLE, 100, 200);
    await vi.waitFor(() => expect(readout()).toBe("200%"));
    const left = box().scrollLeft;
    const top = box().scrollTop;

    await browser.touchDrag(
      [0, 1, 2, 3, 4, 5].map((step) => inPage({ x: 300 - step * 30, y: 500 - step * 30 })),
    );

    await vi.waitFor(() => {
      expect(box().scrollLeft).toBeGreaterThan(left + 50);
      expect(box().scrollTop).toBeGreaterThan(top + 50);
    });
    expect(readout()).toBe("200%");
  });

  it("at fit width one finger scrolls the pages down", async () => {
    await phone();
    expect(getComputedStyle(box()).touchAction).toBe("pan-x pan-y");

    await browser.touchDrag(
      [0, 1, 2, 3, 4, 5].map((step) => inPage({ x: 200, y: 600 - step * 60 })),
    );

    await vi.waitFor(() => expect(box().scrollTop).toBeGreaterThan(100));
    expect(box().scrollLeft).toBe(0);
    expect(readout()).toBe("100%");
  });

  it("a double tap toggles fit width and 200 % around the tapped point", async () => {
    await phone();
    const before = onPage(MIDDLE);

    tap(MIDDLE);
    tap(MIDDLE);

    await vi.waitFor(() => expect(readout()).toBe("200%"));
    expect(onPage(MIDDLE).x).toBeCloseTo(before.x, 2);
    expect(onPage(MIDDLE).y).toBeCloseTo(before.y, 2);

    tap(MIDDLE);
    tap(MIDDLE);

    await vi.waitFor(() => expect(readout()).toBe("100%"));
    expect(slot().style.width).toBe("100%");
  });

  it("two taps far apart or slow leave the zoom", async () => {
    await phone();

    tap(MIDDLE);
    tap({ x: MIDDLE.x + 100, y: MIDDLE.y });
    tap(MIDDLE);
    await new Promise((resolve) => setTimeout(resolve, 400));
    tap(MIDDLE);

    expect(readout()).toBe("100%");
  });

  it("the buttons step on from a pinched zoom, and a pinch stops at 300 %", async () => {
    await phone();

    pinch(MIDDLE, 100, 137);
    await vi.waitFor(() => expect(readout()).toBe("137%"));
    await userEvent.click(zoomIn());
    expect(readout()).toBe("150%");
    expect(slot().style.width).toBe("150%");

    pinch(MIDDLE, 100, 400);
    await vi.waitFor(() => expect(readout()).toBe("300%"));
    expect(slot().style.width).toBe("300%");
    expect(zoomIn()).toBeDisabled();

    pinch(MIDDLE, 400, 10);
    await vi.waitFor(() => expect(readout()).toBe("50%"));
    expect(slot().style.width).toBe("50%");
  });

  it("lifting one finger mid pinch keeps the zoom and the place", async () => {
    await phone();
    const fingers = [
      { x: 100, y: 200 },
      { x: 250, y: 200 },
    ];
    pinch(MIDDLE, 100, 150, false);
    const left = box().scrollLeft;
    const top = box().scrollTop;

    touch("touchend", [fingers[0] as Point], [fingers[1] as Point]);
    touch("touchmove", [{ x: 110, y: 210 }]);

    await vi.waitFor(() => expect(readout()).toBe("150%"));
    expect(Math.abs(box().scrollLeft - left)).toBeLessThan(2);
    expect(Math.abs(box().scrollTop - top)).toBeLessThan(2);
    touch("touchend", [], [{ x: 110, y: 210 }]);
  });

  it("a theme switch after a pinch keeps the zoom and the place", async () => {
    await phone();
    pinch(MIDDLE, 100, 200);
    await vi.waitFor(() => expect(readout()).toBe("200%"));
    const left = box().scrollLeft;
    const top = box().scrollTop;
    const before = slot().querySelector("canvas");

    toggleTheme();

    await vi.waitFor(() => expect(slot().querySelector("canvas")).not.toBe(before));
    expect(readout()).toBe("200%");
    expect(slot().style.width).toBe("200%");
    expect(box().scrollLeft).toBe(left);
    expect(box().scrollTop).toBe(top);
  });

  it.each(["on", "off"])(
    "with vim %s the keys step from a pinched zoom, on a phone and on a desktop",
    async (mode) => {
      localStorage.setItem("kasten.vim", mode);
      const vim = renderHook(() => useVim());
      expect(vim.result.current).toBe(mode === "on");
      vim.unmount();
      await phone();

      pinch(MIDDLE, 100, 137);
      await vi.waitFor(() => expect(readout()).toBe("137%"));
      pane().focus();
      await userEvent.keyboard("-");
      expect(readout()).toBe("125%");

      await page.viewport(1440, 900);
      await browser.emulateMedia({});
      await userEvent.keyboard("+");
      expect(readout()).toBe("150%");
      expect(slot().style.width).toBe("150%");
    },
  );

  it("on a desktop with a mouse the buttons zoom, the wheel scrolls and a take still posts", async () => {
    mount();
    await drawn();

    await userEvent.click(zoomIn());
    expect(readout()).toBe("125%");
    await vi.waitFor(() => {
      const canvas = slot().querySelector("canvas") as HTMLCanvasElement;
      expect(canvas.width).toBe(Math.floor(slot().clientWidth * window.devicePixelRatio));
    });

    await browser.wheel(inPage({ x: 200, y: 300 }), 400);
    await vi.waitFor(() => expect(box().scrollTop).toBeGreaterThan(100));

    box().scrollTop = 0;
    const span = await vi.waitFor(() => {
      const found = [...slot().querySelectorAll(".textLayer span")].find((one) =>
        (one.textContent ?? "").includes(WORDS),
      );
      expect(found).toBeDefined();
      return found as Element;
    });
    const range = document.createRange();
    range.selectNodeContents(span);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    await vi.waitFor(() => expect(takeButton(mounted)).not.toBeNull());
    await userEvent.keyboard("y");
    await vi.waitFor(() => expect(api.dumps).toHaveLength(1));
    expect(readout()).toBe("125%");
  });
});
