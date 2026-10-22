/**
 * The side sheet in a real browser: the desktop graph's sheet, a 540 px panel at
 * the right edge of the note's pane. It mounts in its own positioned box, so the
 * box's edge is the reference the panel is measured against. The bottom sheet's
 * rig is in `sheet-fixture.tsx`, which this file takes its shared pieces from.
 */

import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { commands, page } from "vitest/browser";
import { Sheet } from "@/components/sheet";
import { before, onClose, wait } from "./sheet-fixture";

const LABEL = "Side sheet";

let host: HTMLDivElement;
let box: HTMLDivElement;
let root: Root;

function show(open: boolean) {
  flushSync(() =>
    root.render(
      <Sheet
        open={open}
        onClose={onClose}
        label={LABEL}
        side
        header={<button type="button">Header action</button>}
      >
        <div style={{ height: 1200 }}>
          <button type="button">In content</button>
        </div>
      </Sheet>,
    ),
  );
}

function sideOf(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[role='dialog'][aria-label='${LABEL}']`);
}

beforeEach(async () => {
  await page.viewport(1000, 700);
  host = document.body.appendChild(document.createElement("div"));
  box = host.appendChild(document.createElement("div"));
  box.style.position = "relative";
  box.style.width = "1000px";
  box.style.height = "700px";
  root = createRoot(box);
  // Beside the host, not in it: the note's pane is the box, and focus goes back out to `before`.
  document.body.appendChild(before);
  onClose.mockClear();
});

afterEach(async () => {
  flushSync(() => root.unmount());
  host.remove();
  before.remove();
  await commands.emulateMedia({});
});

it("A8 a side sheet is 540 px wide at the right edge of the box it sits in, over the note", async () => {
  show(true);
  // The slide is 240 ms; the wait is past it, so the panel is where it rests.
  await wait(400);
  const panel = sideOf() as HTMLElement;
  const edge = box.getBoundingClientRect();
  const rect = panel.getBoundingClientRect();

  expect(panel.getAttribute("role")).toBe("dialog");
  expect(panel.getAttribute("aria-label")).toBe(LABEL);
  expect(rect.width).toBe(540);
  expect(rect.right).toBeCloseTo(edge.right, 0);
  expect(rect.top).toBeCloseTo(edge.top, 0);
  expect(rect.height).toBeCloseTo(edge.height, 0);
});

it("A8 a side sheet slides in on transform with the ease-out, and no spring writes its style", async () => {
  show(true);
  const panel = sideOf() as HTMLElement;
  const style = getComputedStyle(panel);

  expect(style.transitionProperty).toContain("transform");
  expect(style.transitionDuration).toBe("0.24s");
  expect(style.transitionTimingFunction).toBe("cubic-bezier(0.23, 1, 0.32, 1)");

  // Partway through the slide the panel is still moving, and it ends at rest.
  await wait(60);
  expect(getComputedStyle(panel).transform).not.toBe("none");
  await expect.poll(() => getComputedStyle(panel).transform, { timeout: 3000 }).toBe("none");
  expect(panel.style.transform).not.toContain("translate3d");
});

it("A10 Esc closes a side sheet and gives the focus back to what had it", async () => {
  before.focus();
  show(true);
  await wait(400);
  const panel = sideOf() as HTMLElement;
  expect(panel.getBoundingClientRect().width).toBe(540);
  expect(document.activeElement).toBe(panel);

  // A keydown listener on the box's parent: Esc must stop at the sheet and not reach it.
  const reached = vi.fn();
  host.addEventListener("keydown", reached);
  panel.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
  host.removeEventListener("keydown", reached);
  expect(reached).not.toHaveBeenCalled();

  await expect.poll(() => onClose.mock.calls.length, { timeout: 3000 }).toBe(1);
  await expect.poll(() => sideOf(), { timeout: 3000 }).toBeNull();
  expect(document.activeElement).toBe(before);
});

it("A10 a click on the scrim closes a side sheet", async () => {
  show(true);
  await wait(400);
  const panel = sideOf() as HTMLElement;
  expect(panel.getBoundingClientRect().width).toBe(540);
  const scrim = panel.previousElementSibling as HTMLElement;

  scrim.click();

  await expect.poll(() => onClose.mock.calls.length, { timeout: 3000 }).toBe(1);
  await expect.poll(() => sideOf(), { timeout: 3000 }).toBeNull();
});

it("A8 under reduced motion a side sheet fades and does not slide", async () => {
  await commands.emulateMedia({ reducedMotion: "reduce" });
  show(true);
  const panel = sideOf() as HTMLElement;
  expect(panel.getBoundingClientRect().width).toBe(540);
  expect(getComputedStyle(panel).transitionProperty).toContain("opacity");
  expect(getComputedStyle(panel).transitionProperty).not.toContain("transform");

  await expect.poll(() => Number(getComputedStyle(panel).opacity), { timeout: 3000 }).toBe(1);
  // It never left the right edge: the fade is the only motion.
  expect(panel.getBoundingClientRect().right).toBeCloseTo(box.getBoundingClientRect().right, 0);
});

it("A10 Esc right after a side sheet opens still closes it", async () => {
  show(true);
  (sideOf() as HTMLElement).dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );

  await expect.poll(() => onClose.mock.calls.length, { timeout: 3000 }).toBe(1);
  await expect.poll(() => sideOf(), { timeout: 3000 }).toBeNull();
});

it("A10 a side sheet asked shut during its open slide leaves the DOM", async () => {
  show(true);
  show(false);

  await expect.poll(() => sideOf(), { timeout: 3000 }).toBeNull();
});
