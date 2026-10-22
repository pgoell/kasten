/**
 * How the bottom sheet closes in a real browser: by Esc, a tap on the scrim, a
 * tap on the grabber while it is already closing, and a drag that rescues it.
 * The drags themselves are in `sheet.test.tsx`; the rig is in `sheet-fixture.tsx`.
 */

import { commands } from "vitest/browser";
import {
  before,
  centreOf,
  grabberOf,
  nextFrame,
  offsetOf,
  onClose,
  panelOf,
  pointer,
  registerSheetFixture,
  setContentHeight,
  settled,
  show,
  wait,
} from "./sheet-fixture";

registerSheetFixture();

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

it("a tap on the scrim closes the sheet along the same path and returns focus", async () => {
  before.focus();
  show(true);
  await settled();
  const panel = panelOf() as HTMLElement;
  const scrim = panel.previousElementSibling as HTMLElement;
  const height = panel.offsetHeight;

  // The offset is read every frame while the sheet is still in the DOM, since it
  // is gone the moment it reaches the bottom.
  const seen: number[] = [];
  let sampling = true;
  const sample = () => {
    const offset = offsetOf(panelOf());
    if (!Number.isNaN(offset)) seen.push(offset);
    if (sampling) requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);

  scrim.click();

  // The same path as a release past half: down to the bottom, then gone.
  await expect.poll(() => panelOf(), { timeout: 3000 }).toBeNull();
  sampling = false;
  expect(Math.max(...seen)).toBeCloseTo(height, 0);
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(before);
});

it("content that grows after open is measured again: Esc closes down to the new height", async () => {
  setContentHeight(100);
  show(true);
  await settled();
  const panel = panelOf() as HTMLElement;
  const tall = panel.querySelector<HTMLElement>("div[style*='height']") as HTMLElement;
  // The graph arriving: the content grows after the sheet has opened.
  tall.style.height = "1200px";
  await nextFrame();
  await nextFrame();
  const height = panel.offsetHeight;
  expect(height).toBeGreaterThan(300);

  const seen: number[] = [];
  let sampling = true;
  const sample = () => {
    const offset = offsetOf(panelOf());
    if (!Number.isNaN(offset)) seen.push(offset);
    if (sampling) requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);

  panel.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
  await expect.poll(() => panelOf(), { timeout: 3000 }).toBeNull();
  sampling = false;
  expect(Math.max(...seen)).toBeCloseTo(height, 0);
});

it("the panel has a paper skirt below its foot", async () => {
  show(true);
  await settled();
  const panel = panelOf() as HTMLElement;
  const skirt = panel.querySelector<HTMLElement>("[data-sheet-skirt]");
  if (!skirt) throw new Error("the panel has no skirt");

  // An overshoot past the rest point leaves the panel's foot above the screen's
  // edge; the skirt keeps the note from showing through that gap.
  expect(getComputedStyle(skirt).backgroundColor).toBe(getComputedStyle(panel).backgroundColor);
  expect(skirt.getBoundingClientRect().top).toBeCloseTo(panel.getBoundingClientRect().bottom, 0);
});

it("Esc in an input inside the sheet stays with the input", async () => {
  show(true);
  await settled();
  const panel = panelOf() as HTMLElement;
  const input = document.createElement("input");
  // An input whose own handler takes Esc, as the graph's filter line does.
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") event.preventDefault();
  });
  (panel.lastElementChild as HTMLElement).prepend(input);
  input.focus();

  input.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
  await wait(300);

  expect(panelOf()).not.toBeNull();
  expect(offsetOf(panelOf())).toBe(0);
  expect(onClose).not.toHaveBeenCalled();
});

it("a sheet rescued from a close by a drag springs back for good: a later tap during a spring back does not close it", async () => {
  show(true);
  await settled();
  const panel = panelOf() as HTMLElement;
  const grab = grabberOf();
  const start = centreOf(grab);

  // Esc starts the sheet closing by itself.
  panel.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
  await wait(60);

  // A grab mid-close, dragged up, released above half: the sheet springs back to the top.
  pointer(grab, "pointerdown", start.x, start.y);
  pointer(grab, "pointermove", start.x, start.y - 200);
  pointer(grab, "pointerup", start.x, start.y - 200);

  // A tap while that spring back is still running.
  pointer(grab, "pointerdown", start.x, start.y);
  pointer(grab, "pointerup", start.x, start.y);

  await settled();
  expect(panelOf()).not.toBeNull();
  expect(onClose).not.toHaveBeenCalled();
});

it("a tap on the grabber while the sheet closes itself lets it finish closing", async () => {
  show(true);
  await settled();
  const panel = panelOf() as HTMLElement;
  const grab = grabberOf();
  const start = centreOf(grab);

  // Esc starts the sheet closing by itself, while `open` still reads true.
  panel.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
  await wait(60);

  // A tap on the grabber in the middle of that close.
  pointer(grab, "pointerdown", start.x, start.y);
  pointer(grab, "pointerup", start.x, start.y);

  await expect.poll(() => panelOf(), { timeout: 3000 }).toBeNull();
  expect(onClose).toHaveBeenCalledTimes(1);
});
