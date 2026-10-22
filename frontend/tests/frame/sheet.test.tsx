/**
 * The bottom sheet in a real browser, driven by pointer events the way a finger
 * or a mouse sends them. Each assertion reads the panel's transform and the
 * scrim's opacity off the DOM, so the numbers are the ones on screen.
 */

import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import type { Mock } from "vitest";
import { commands, page } from "vitest/browser";
import { Sheet } from "@/components/sheet";
import { rubberBand } from "@/lib/sheet-math";
import "@/styles/app.css";

const LABEL = "Test sheet";

let host: HTMLDivElement;
let root: Root;
let onClose: Mock<() => void>;
let before: HTMLButtonElement;

/** Mounts or takes down the sheet, synchronously, so the commit's own frame is read. */
function show(open: boolean) {
  flushSync(() =>
    root.render(
      <Sheet
        open={open}
        onClose={onClose}
        label={LABEL}
        header={<button type="button">Header action</button>}
      >
        <div style={{ height: 1200 }}>
          <button type="button">In content</button>
        </div>
      </Sheet>,
    ),
  );
}

function panelOf(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[role='dialog'][aria-label='${LABEL}']`);
}

/** The panel's offset in px, read from its inline transform. NaN once it is gone. */
function offsetOf(panel: HTMLElement | null): number {
  // The browser writes the inline transform back in its own form, so the
  // number is read as the Y of whichever form it is.
  const match = /px,\s*(-?[\d.e+-]+)px/.exec(panel?.style.transform ?? "");
  return match ? Number(match[1]) : Number.NaN;
}

function grabberOf(): HTMLElement {
  return panelOf()?.querySelector<HTMLElement>("[data-sheet-drag]") as HTMLElement;
}

function headerButtonOf(): HTMLButtonElement {
  return panelOf()?.querySelector<HTMLButtonElement>(
    "[data-sheet-drag] button",
  ) as HTMLButtonElement;
}

/** Where a press on the grabber lands: the middle of it. */
function centreOf(element: Element): { x: number; y: number } {
  const box = element.getBoundingClientRect();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A pointer event as a mouse sends it. The buttons are held from down to move. */
function pointer(
  target: Element,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  x: number,
  y: number,
) {
  target.dispatchEvent(
    new PointerEvent(type, {
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: type === "pointerdown" || type === "pointermove" ? 1 : 0,
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
    }),
  );
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Waits until the sheet has come to rest at the top, where it is open. */
async function settled() {
  await expect.poll(() => offsetOf(panelOf()), { timeout: 3000 }).toBe(0);
}

beforeEach(async () => {
  await page.viewport(390, 844);
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  // Beside the host, not in it: React clears a root's container when it renders.
  before = document.body.appendChild(document.createElement("button"));
  before.type = "button";
  before.textContent = "Before";
  onClose = vi.fn();
});

afterEach(async () => {
  flushSync(() => root.unmount());
  host.remove();
  before.remove();
  await commands.emulateMedia({});
});

it("it enters from the bottom: the first frame's offset equals the panel height, then reaches 0", async () => {
  show(true);
  const panel = panelOf() as HTMLElement;
  // Read before any frame has run, so this is the position the spring starts from.
  expect(offsetOf(panel)).toBe(panel.offsetHeight);
  expect(panel.offsetHeight).toBeGreaterThan(0);
  await settled();
  expect(onClose).not.toHaveBeenCalled();
});

it("a move under 10 px leaves the sheet where it is; past 10 px it follows the finger 1:1 and the grabber holds the pointer", async () => {
  show(true);
  await settled();
  const grab = grabberOf();
  const start = centreOf(grab);

  pointer(grab, "pointerdown", start.x, start.y);
  pointer(grab, "pointermove", start.x, start.y + 5);
  expect(offsetOf(panelOf())).toBe(0);

  // Synthetic events have no active pointer, so the browser keeps no capture
  // for them. The call is spied on instead: it is what the sheet owes.
  const capture = vi.spyOn(grab, "setPointerCapture");
  pointer(grab, "pointermove", start.x, start.y + 20);
  expect(offsetOf(panelOf())).toBe(20);
  expect(capture).toHaveBeenCalledWith(1);

  pointer(grab, "pointermove", start.x, start.y + 50);
  expect(offsetOf(panelOf())).toBe(50);

  // Let go after a pause, so the release is a slow one and springs back.
  await wait(120);
  pointer(grab, "pointerup", start.x, start.y + 50);
  await settled();
});

it("a sideways move past the slop gives the gesture up, and later vertical moves do not move the sheet", async () => {
  show(true);
  await settled();
  const grab = grabberOf();
  const start = centreOf(grab);

  pointer(grab, "pointerdown", start.x, start.y);
  pointer(grab, "pointermove", start.x + 30, start.y + 5);
  pointer(grab, "pointermove", start.x + 30, start.y + 60);
  expect(offsetOf(panelOf())).toBe(0);

  pointer(grab, "pointerup", start.x + 30, start.y + 60);
  await settled();
  expect(onClose).not.toHaveBeenCalled();
});

it("a drag that starts in the content does not move the sheet", async () => {
  show(true);
  await settled();
  const content = [...(panelOf()?.querySelectorAll("button") ?? [])].find(
    (one) => one.textContent === "In content",
  ) as HTMLButtonElement;
  const start = centreOf(content);

  pointer(content, "pointerdown", start.x, start.y);
  pointer(content, "pointermove", start.x, start.y + 80);
  expect(offsetOf(panelOf())).toBe(0);
  pointer(content, "pointerup", start.x, start.y + 80);
  await settled();
});

it("pulling up 100 px rubber-bands, and springs back to 0 on release", async () => {
  show(true);
  await settled();
  const grab = grabberOf();
  const start = centreOf(grab);
  const height = panelOf()?.offsetHeight ?? 0;

  pointer(grab, "pointerdown", start.x, start.y);
  pointer(grab, "pointermove", start.x, start.y - 100);
  // The browser writes the transform to four decimals, so two is what it can hold to.
  expect(offsetOf(panelOf())).toBeCloseTo(rubberBand(-100, height), 2);

  pointer(grab, "pointerup", start.x, start.y - 100);
  await settled();
  expect(onClose).not.toHaveBeenCalled();
});

it("a quick downward flick closes the sheet", async () => {
  show(true);
  await settled();
  const grab = grabberOf();
  const start = centreOf(grab);

  pointer(grab, "pointerdown", start.x, start.y);
  pointer(grab, "pointermove", start.x, start.y + 40);
  // A few ms apart, not the same instant: the clock behind performance.now
  // is coarse, and two events in one tick would read as no speed at all.
  await wait(5);
  pointer(grab, "pointermove", start.x, start.y + 80);
  pointer(grab, "pointerup", start.x, start.y + 80);

  await expect.poll(() => onClose.mock.calls.length, { timeout: 3000 }).toBe(1);
  await expect.poll(() => panelOf(), { timeout: 3000 }).toBeNull();
});

it("a slow drag to 40 percent of the height springs back when it is let go after a pause", async () => {
  show(true);
  await settled();
  const grab = grabberOf();
  const start = centreOf(grab);
  const height = panelOf()?.offsetHeight ?? 0;

  pointer(grab, "pointerdown", start.x, start.y);
  pointer(grab, "pointermove", start.x, start.y + height * 0.4);
  // Past the 90 ms after which the finger counts as stopped, so its speed is 0.
  await wait(120);
  pointer(grab, "pointerup", start.x, start.y + height * 0.4);

  await settled();
  expect(onClose).not.toHaveBeenCalled();
});

it("a slow drag to 60 percent of the height closes when it is let go after a pause", async () => {
  show(true);
  await settled();
  const grab = grabberOf();
  const start = centreOf(grab);
  const height = panelOf()?.offsetHeight ?? 0;

  pointer(grab, "pointerdown", start.x, start.y);
  pointer(grab, "pointermove", start.x, start.y + height * 0.6);
  await wait(120);
  pointer(grab, "pointerup", start.x, start.y + height * 0.6);

  await expect.poll(() => onClose.mock.calls.length, { timeout: 3000 }).toBe(1);
  await expect.poll(() => panelOf(), { timeout: 3000 }).toBeNull();
});

it("the scrim's opacity is 1 minus the offset over the height while the sheet is dragged", async () => {
  show(true);
  await settled();
  const panel = panelOf() as HTMLElement;
  const scrim = panel.previousElementSibling as HTMLElement;
  const grab = grabberOf();
  const start = centreOf(grab);
  const height = panel.offsetHeight;

  pointer(grab, "pointerdown", start.x, start.y);
  pointer(grab, "pointermove", start.x, start.y + height / 4);
  expect(Number(scrim.style.opacity)).toBeCloseTo(0.75, 5);

  pointer(grab, "pointerup", start.x, start.y + height / 4);
  await settled();
});

it("a press while the sheet is still rising catches it where it is", async () => {
  show(true);
  const panel = panelOf() as HTMLElement;
  const grab = grabberOf();
  const start = centreOf(grab);
  const height = panel.offsetHeight;

  // Let the spring run for a while, so the press lands mid-flight.
  await wait(120);
  pointer(grab, "pointerdown", start.x, start.y);
  const caught = offsetOf(panel);
  expect(caught).toBeGreaterThan(0);
  expect(caught).toBeLessThan(height);

  // The spring has stopped, so the offset holds from frame to frame.
  await nextFrame();
  await nextFrame();
  expect(offsetOf(panel)).toBe(caught);

  // A tap on the sheet carries it on to the top.
  pointer(grab, "pointerup", start.x, start.y);
  await settled();
});

it("no click follows a drag, and a plain tap on a header button still clicks it", async () => {
  show(true);
  await settled();
  const button = headerButtonOf();
  const clicks = vi.fn();
  button.addEventListener("click", clicks);
  const start = centreOf(button);

  // A drag that ends over the button: the browser would send a click there.
  pointer(button, "pointerdown", start.x, start.y);
  pointer(button, "pointermove", start.x, start.y + 30);
  pointer(button, "pointerup", start.x, start.y + 30);
  button.click();
  expect(clicks).not.toHaveBeenCalled();
  await settled();

  // A tap with no move is a tap, and the click goes through.
  pointer(button, "pointerdown", start.x, start.y);
  pointer(button, "pointerup", start.x, start.y);
  button.click();
  expect(clicks).toHaveBeenCalledTimes(1);
});

it("Esc closes the sheet along the same path, never reaches the document, and returns focus", async () => {
  before.focus();
  show(true);
  await settled();
  const panel = panelOf() as HTMLElement;
  expect(document.activeElement).toBe(panel);

  const reached = vi.fn();
  document.addEventListener("keydown", reached);
  panel.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
  document.removeEventListener("keydown", reached);
  expect(reached).not.toHaveBeenCalled();

  await expect.poll(() => onClose.mock.calls.length, { timeout: 3000 }).toBe(1);
  await expect.poll(() => panelOf(), { timeout: 3000 }).toBeNull();
  expect(document.activeElement).toBe(before);
});

it("under reduced motion the sheet fades in place and closes by fading", async () => {
  await commands.emulateMedia({ reducedMotion: "reduce" });
  show(true);
  const panel = panelOf() as HTMLElement;
  expect(offsetOf(panel)).toBe(0);
  expect(getComputedStyle(panel).transitionProperty).toContain("opacity");
  await expect.poll(() => Number(getComputedStyle(panel).opacity), { timeout: 3000 }).toBe(1);

  show(false);
  await wait(50);
  const fading = Number(getComputedStyle(panel).opacity);
  expect(fading).toBeGreaterThan(0);
  expect(fading).toBeLessThan(1);
  expect(offsetOf(panel)).toBe(0);

  await expect.poll(() => panelOf(), { timeout: 3000 }).toBeNull();
});

it("under reduced motion a drag still follows the finger and a drag past half closes it", async () => {
  await commands.emulateMedia({ reducedMotion: "reduce" });
  show(true);
  const panel = panelOf() as HTMLElement;
  await expect.poll(() => Number(getComputedStyle(panel).opacity), { timeout: 3000 }).toBe(1);
  const grab = grabberOf();
  const start = centreOf(grab);
  const height = panel.offsetHeight;

  pointer(grab, "pointerdown", start.x, start.y);
  pointer(grab, "pointermove", start.x, start.y + height / 4);
  expect(offsetOf(panelOf())).toBeCloseTo(height / 4, 2);

  pointer(grab, "pointermove", start.x, start.y + height * 0.6);
  expect(offsetOf(panelOf())).toBeCloseTo(height * 0.6, 2);

  // Let go after a pause, so the release is a slow one and only the distance decides.
  await wait(120);
  pointer(grab, "pointerup", start.x, start.y + height * 0.6);

  await expect.poll(() => onClose.mock.calls.length, { timeout: 3000 }).toBe(1);
  await expect.poll(() => panelOf(), { timeout: 3000 }).toBeNull();
});

it("a key press after a drag still clicks a header button", async () => {
  show(true);
  await settled();
  const button = headerButtonOf();
  const clicks = vi.fn();
  button.addEventListener("click", clicks);
  const start = centreOf(button);

  pointer(button, "pointerdown", start.x, start.y);
  pointer(button, "pointermove", start.x, start.y + 30);
  pointer(button, "pointerup", start.x, start.y + 30);
  await settled();

  // Enter on a focused button sends a keydown, then a click, and no pointerdown.
  button.focus();
  button.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  button.click();
  expect(clicks).toHaveBeenCalledTimes(1);
});

it("the grabber does not pan the page, and the panel is solid paper with no blur", async () => {
  show(true);
  await settled();
  expect(getComputedStyle(grabberOf()).touchAction).toBe("none");
  expect(getComputedStyle(panelOf() as HTMLElement).backdropFilter).toBe("none");
});
