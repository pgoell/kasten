/**
 * The bottom sheet's test rig, shared by `sheet.test.tsx` (drags) and
 * `sheet-close.test.tsx` (closes): a host to mount the sheet in, the pointer and
 * wait helpers both use, and the hooks that set each test up and take it down.
 */

import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { commands, page } from "vitest/browser";
import { Sheet } from "@/components/sheet";
import "@/styles/app.css";

const LABEL = "Test sheet";

/** The `onClose` the sheet is given. Cleared before each test. */
export const onClose = vi.fn<() => void>();

/** The button beside the host, which focus returns to when the sheet closes. */
export const before = document.createElement("button");
before.type = "button";
before.textContent = "Before";

let host: HTMLDivElement;
let root: Root;
let contentHeight = 1200;

/** Sets the height of the tall content, for a test that needs the sheet to start small. */
export function setContentHeight(height: number) {
  contentHeight = height;
}

/** Mounts or takes down the sheet, synchronously, so the commit's own frame is read. */
export function show(open: boolean) {
  flushSync(() =>
    root.render(
      <Sheet
        open={open}
        onClose={onClose}
        label={LABEL}
        header={<button type="button">Header action</button>}
      >
        <div style={{ height: contentHeight }}>
          <button type="button">In content</button>
        </div>
      </Sheet>,
    ),
  );
}

export function panelOf(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[role='dialog'][aria-label='${LABEL}']`);
}

/** The panel's offset in px, read from its inline transform. NaN once it is gone. */
export function offsetOf(panel: HTMLElement | null): number {
  // The browser writes the inline transform back in its own form, so the
  // number is read as the Y of whichever form it is.
  const match = /px,\s*(-?[\d.e+-]+)px/.exec(panel?.style.transform ?? "");
  return match ? Number(match[1]) : Number.NaN;
}

export function grabberOf(): HTMLElement {
  return panelOf()?.querySelector<HTMLElement>("[data-sheet-drag]") as HTMLElement;
}

export function headerButtonOf(): HTMLButtonElement {
  return panelOf()?.querySelector<HTMLButtonElement>(
    "[data-sheet-drag] button",
  ) as HTMLButtonElement;
}

/** Where a press on the grabber lands: the middle of it. */
export function centreOf(element: Element): { x: number; y: number } {
  const box = element.getBoundingClientRect();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A pointer event as a mouse sends it. The buttons are held from down to move. */
export function pointer(
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

export const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Waits until the sheet has come to rest at the top, where it is open. */
export async function settled() {
  await expect.poll(() => offsetOf(panelOf()), { timeout: 3000 }).toBe(0);
}

/**
 * Sets the sheet's rig up before each test of the calling file and takes it down
 * after. Called once at the top of a test file.
 */
export function registerSheetFixture() {
  beforeEach(async () => {
    await page.viewport(390, 844);
    host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    // Beside the host, not in it: React clears a root's container when it renders.
    document.body.appendChild(before);
    onClose.mockClear();
    contentHeight = 1200;
  });

  afterEach(async () => {
    flushSync(() => root.unmount());
    host.remove();
    before.remove();
    await commands.emulateMedia({});
  });
}
