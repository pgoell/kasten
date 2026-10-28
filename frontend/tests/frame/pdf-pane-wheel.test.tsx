/**
 * ctrl+wheel and a trackpad pinch on a real pdf pane on a desktop, in real
 * Chromium (#1285): the browser zoomed the whole app, where Obsidian zooms the
 * page under the pointer.
 *
 * The wheels are `WheelEvent`s made in the page, which reach the box's listener
 * the way a wheel's or a trackpad's do; Chrome sends a trackpad pinch as
 * ctrl+wheel with small pixel deltas. Whether the event was cancelled is what
 * keeps the browser from zooming the app, as #991's touch pinch was proved. A
 * plain wheel has to scroll the box, which such an event never does, so it goes
 * through the DevTools protocol (`browser.wheel`).
 */

import "./pdf-take-api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { flushSync } from "react-dom";
import { commands as browser, page, userEvent } from "vitest/browser";
import { PdfPane } from "@/components/pdf-pane";
import { useVim } from "@/lib/editor/vim-setting";
import "@/styles/app.css";
import { type Mounted, setUp, tearDown } from "./html-take-fixture";
import { PAGE_ONE } from "./pdf-fixture";

const PATH = "take/plan.pdf";
const WORDS = PAGE_ONE[0] ?? "";

vi.setConfig({ testTimeout: 40_000 });

let mounted: Mounted;

beforeEach(async () => {
  mounted = await setUp();
  await page.viewport(1440, 900);
  await browser.emulateMedia({});
});

afterEach(async () => {
  await tearDown(mounted);
});

function mount(opened = 1) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  flushSync(() =>
    mounted.root.render(
      <QueryClientProvider client={client}>
        <div className="flex h-dvh flex-row">
          <div data-pane className="flex min-w-0 flex-1 flex-col">
            <PdfPane
              path={PATH}
              opened={opened}
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

async function desktop() {
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

/** A wheel of `deltaY` over `at` (box coordinates) on `target`, ctrl held unless told. Returns it. */
function wheel(
  at: Point,
  deltaY: number,
  init: WheelEventInit = { ctrlKey: true },
  target: Element = box(),
): WheelEvent {
  const { x, y } = inPage(at);
  const event = new WheelEvent("wheel", {
    deltaY,
    clientX: x,
    clientY: y,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

/** Where `at` (box coordinates) falls on page `number`, as shares of its width and height. */
function onPage(at: Point, number = 1): Point {
  const rect = slot(number).getBoundingClientRect();
  const { x, y } = inPage(at);
  return { x: (x - rect.left) / rect.width, y: (y - rect.top) / rect.height };
}

/** A Safari `GestureEvent` of `type` and `scale` about `at`, which Chromium has no constructor for. */
function gesture(type: string, scale: number, at: Point): Event {
  const { x, y } = inPage(at);
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { scale, clientX: x, clientY: y });
  box().dispatchEvent(event);
  return event;
}

/** A `TouchEvent` of `type` with fingers at `points` (box coordinates) on the box. */
function touch(type: string, points: Point[], changed: Point[] = points) {
  const target = box();
  const make = (point: Point, index: number) => {
    const { x, y } = inPage(point);
    return new Touch({ identifier: index, target, clientX: x, clientY: y });
  };
  target.dispatchEvent(
    new TouchEvent(type, {
      touches: points.map(make),
      changedTouches: changed.map(make),
      bubbles: true,
      cancelable: true,
    }),
  );
}

const fingers = (middle: Point, spread: number): Point[] => [
  { x: middle.x - spread / 2, y: middle.y },
  { x: middle.x + spread / 2, y: middle.y },
];

const POINTER = { x: 300, y: 250 };

describe("the pdf pane zooms under ctrl+wheel on a desktop", () => {
  it("ctrl+wheel zooms the page about the pointer and calls preventDefault", async () => {
    await desktop();
    const before = onPage(POINTER);
    const fit = slot().getBoundingClientRect().width;

    expect(wheel(POINTER, -100).defaultPrevented).toBe(true);

    await vi.waitFor(() => expect(readout()).toBe("120%"));
    expect(slot().getBoundingClientRect().width).toBeCloseTo(fit * 1.2, 0);
    const after = onPage(POINTER);
    expect(after.x).toBeCloseTo(before.x, 2);
    expect(after.y).toBeCloseTo(before.y, 2);
  });

  it("a trackpad-sized delta zooms smoothly within limits", async () => {
    await desktop();
    let width = slot().getBoundingClientRect().width;
    // Twenty frames of a pinch, each a few px, grow the page a little each time.
    for (let frame = 0; frame < 20; frame += 1) {
      expect(wheel(POINTER, -5).defaultPrevented).toBe(true);
      const next = slot().getBoundingClientRect().width;
      expect(next).toBeGreaterThan(width);
      expect(next / width).toBeLessThan(1.06);
      width = next;
    }
    // e to the one, the fingers' own scale.
    await vi.waitFor(() => expect(readout()).toBe("272%"));

    for (let frame = 0; frame < 40; frame += 1) wheel(POINTER, -5);
    await vi.waitFor(() => expect(readout()).toBe("300%"));
    expect(slot().style.width).toBe("300%");
    expect(zoomIn()).toBeDisabled();

    for (let frame = 0; frame < 200; frame += 1) wheel(POINTER, 5);
    await vi.waitFor(() => expect(readout()).toBe("50%"));
    expect(slot().style.width).toBe("50%");
  });

  it("turned back at a limit, the wheel zooms back at once", async () => {
    await desktop();
    for (let frame = 0; frame < 40; frame += 1) wheel(POINTER, -100);
    await vi.waitFor(() => expect(readout()).toBe("300%"));

    wheel(POINTER, 100);

    await vi.waitFor(() => expect(readout()).toBe("250%"));
  });

  it("the buttons, the keys and ctrl+wheel share one zoom", async () => {
    await desktop();

    wheel(POINTER, -100);
    await vi.waitFor(() => expect(readout()).toBe("120%"));
    await userEvent.click(zoomIn());
    expect(readout()).toBe("125%");
    expect(slot().style.width).toBe("125%");

    wheel(POINTER, -100);
    await vi.waitFor(() => expect(readout()).toBe("150%"));
    pane().focus();
    await userEvent.keyboard("-");
    expect(readout()).toBe("125%");
    expect(slot().style.width).toBe("125%");
  });

  it("a button pressed before a wheel zoom settles leaves the readout and the page agreeing", async () => {
    await desktop();

    wheel(POINTER, -100);
    await userEvent.click(zoomIn());
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(readout()).toBe("125%");
    expect(slot().style.width).toBe("125%");
  });

  it("a scroll straight after ctrl+wheel is kept once the zoom settles", async () => {
    await desktop();

    wheel(POINTER, -100);
    const top = box().scrollTop;
    await browser.wheel(inPage(POINTER), 400);
    await vi.waitFor(() => expect(readout()).toBe("120%"));
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(box().scrollTop).toBeGreaterThan(top + 100);
  });

  it("after ctrl+wheel the page is drawn again at the new zoom, sharp", async () => {
    await desktop();
    const fit = box().clientWidth;

    wheel(POINTER, -100);
    wheel(POINTER, -100);

    await vi.waitFor(() => {
      const canvas = slot().querySelector("canvas") as HTMLCanvasElement;
      expect(slot().clientWidth).toBeGreaterThan(fit * 1.3);
      expect(canvas.width).toBe(Math.floor(slot().clientWidth * window.devicePixelRatio));
    });
  });

  it("cmd+wheel zooms too, and a plain wheel scrolls the pages", async () => {
    await desktop();

    expect(wheel(POINTER, -100, { metaKey: true }).defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(readout()).toBe("120%"));

    expect(wheel(POINTER, 100, {}).defaultPrevented).toBe(false);
    await browser.wheel(inPage(POINTER), 400);
    await vi.waitFor(() => expect(box().scrollTop).toBeGreaterThan(100));
    expect(readout()).toBe("120%");
  });

  it("ctrl+wheel outside the pdf page is left to the browser", async () => {
    await desktop();
    const header = pane().querySelector("header") as HTMLElement;

    expect(wheel(POINTER, -100, { ctrlKey: true }, header).defaultPrevented).toBe(false);
    expect(wheel(POINTER, -100, { ctrlKey: true }, document.body).defaultPrevented).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(readout()).toBe("100%");
  });

  it("a line-mode wheel zooms one bounded step", async () => {
    await desktop();

    wheel(POINTER, -3, { ctrlKey: true, deltaMode: WheelEvent.DOM_DELTA_LINE });

    await vi.waitFor(() => expect(readout()).toBe("120%"));
  });

  it("far down the pdf ctrl+wheel keeps the point under the pointer on a later page", async () => {
    await desktop();
    box().scrollTop = slot(2).offsetTop - 100;
    const before = onPage(POINTER, 2);

    wheel(POINTER, -100);

    await vi.waitFor(() => expect(readout()).toBe("120%"));
    expect(onPage(POINTER, 2).x).toBeCloseTo(before.x, 2);
    expect(onPage(POINTER, 2).y).toBeCloseTo(before.y, 2);
  });

  it("a pdf opened again in the middle of a wheel zoom gets no late zoom from the old view", async () => {
    await desktop();

    wheel(POINTER, -100);
    mount(2);
    await drawn();
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(readout()).toBe("100%");
    expect(slot().style.width).toBe("");
  });

  it("Safari's gesture events zoom the page about the pointer", async () => {
    await desktop();
    const before = onPage(POINTER);

    expect(gesture("gesturestart", 1, POINTER).defaultPrevented).toBe(true);
    expect(gesture("gesturechange", 1.25, POINTER).defaultPrevented).toBe(true);
    expect(gesture("gesturechange", 1.5, POINTER).defaultPrevented).toBe(true);
    gesture("gestureend", 1.5, POINTER);

    await vi.waitFor(() => expect(readout()).toBe("150%"));
    expect(onPage(POINTER).x).toBeCloseTo(before.x, 2);
    expect(onPage(POINTER).y).toBeCloseTo(before.y, 2);
  });

  it("on an iPhone the gesture events under a touch pinch are not taken twice", async () => {
    await page.viewport(414, 896);
    await browser.emulateMedia({ touch: true });
    mount();
    await drawn();
    const middle = { x: 150, y: 200 };

    // iOS sends both, in Apple's order: the first finger, the gesture, then the
    // second finger; the gesture ends before the touches. The gesture's scale is
    // made to differ, so a second take of the pinch would show in the zoom.
    const [one, two] = fingers(middle, 100) as [Point, Point];
    touch("touchstart", [one]);
    gesture("gesturestart", 1, middle);
    touch("touchstart", [one, two]);
    for (let step = 1; step <= 5; step += 1) {
      touch("touchmove", fingers(middle, 100 + step * 20));
      gesture("gesturechange", 1 + step * 0.1, middle);
    }
    gesture("gestureend", 1.5, middle);
    touch("touchend", [], fingers(middle, 200));

    await vi.waitFor(() => expect(readout()).toBe("200%"));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(readout()).toBe("200%");
  });

  it.each(["on", "off"])(
    "with vim %s ctrl+wheel and the keys share the zoom on a desktop, and a phone pinch steps on from it",
    async (mode) => {
      localStorage.setItem("kasten.vim", mode);
      const vim = renderHook(() => useVim());
      expect(vim.result.current).toBe(mode === "on");
      vim.unmount();
      await desktop();

      wheel(POINTER, -100);
      wheel(POINTER, -100);
      await vi.waitFor(() => expect(readout()).toBe("144%"));
      pane().focus();
      await userEvent.keyboard("-");
      expect(readout()).toBe("125%");

      await page.viewport(414, 896);
      await browser.emulateMedia({ touch: true });
      const middle = { x: 150, y: 200 };
      touch("touchstart", fingers(middle, 100));
      for (let step = 1; step <= 5; step += 1) touch("touchmove", fingers(middle, 100 + step * 4));
      touch("touchend", [], fingers(middle, 120));
      await vi.waitFor(() => expect(readout()).toBe("150%"));
    },
  );
});
