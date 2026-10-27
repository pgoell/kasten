/**
 * The which-key panel in a real browser: how it leaves, how Space catches it on
 * the way out, whether narrowing moves it, where it sits in a split, and how it
 * is a sheet on a phone. Each assertion reads the DOM the way the screen shows
 * it: the opacity and transform the spring writes, frame by frame.
 */

import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { commands, page } from "vitest/browser";
import { Toolbar } from "@/components/toolbar";
import { WhichKey } from "@/components/which-key";
import { beginLeader, paneOpener } from "@/lib/which-key";
import "@/styles/app.css";
import { stubCommands } from "../stub-commands";

let host: HTMLDivElement;
let root: Root;

/** A note's pane, with the opener in it, and a second pane when `split` is set. */
function Fixture({ phone, split }: { phone: boolean; split: boolean }) {
  return (
    <div className="flex h-dvh">
      {split && (
        <div data-pane className="min-w-0 flex-1">
          <p>Another note, in the left pane.</p>
        </div>
      )}
      <div data-pane className="min-w-0 flex-1">
        <button type="button">Note</button>
      </div>
      <WhichKey phone={phone} />
    </div>
  );
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function mount(phone: boolean, split = false) {
  flushSync(() => root.render(<Fixture phone={phone} split={split} />));
}

/** The opener, focused as a pane leaves it when Space is pressed. */
function opener(): HTMLElement {
  return host.querySelector("button") as HTMLElement;
}

/** Presses Space on the opener: focus it, then hand the leader to the panel. */
async function openPanel(): Promise<HTMLElement> {
  // Effects run after the commit, so the panel's host is registered a frame later.
  await nextFrame();
  opener().focus();
  const begun = flushSync(() => beginLeader(paneOpener(stubCommands())));
  expect(begun).toBe(true);
  return panelOf() as HTMLElement;
}

function panelOf(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[role='dialog'][aria-label='Leader keys']");
}

/** The sheet's offset in px, read from its inline transform. NaN once it is gone. */
function offsetOf(panel: HTMLElement | null): number {
  const match = /,\s*(-?[\d.e+-]+)px/.exec(panel?.style.transform ?? "");
  return match ? Number(match[1]) : Number.NaN;
}

function key(target: Element, key: string) {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

/** A pointer event as a finger or a mouse sends it. The button is held from down to move. */
function pointer(
  target: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  x: number,
  y: number,
) {
  target.dispatchEvent(
    new PointerEvent(type, {
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
    }),
  );
}

function centreOf(element: Element): { x: number; y: number } {
  const box = element.getBoundingClientRect();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The opacity the panel shows, one reading a frame, for as many frames as asked. */
async function opacityFrames(panel: HTMLElement, frames: number): Promise<number[]> {
  const seen: number[] = [];
  for (let at = 0; at < frames; at += 1) {
    seen.push(Number(panel.style.opacity || 1));
    await nextFrame();
  }
  return seen;
}

beforeEach(async () => {
  await page.viewport(1440, 900);
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});

afterEach(async () => {
  flushSync(() => root.unmount());
  host.remove();
  await page.viewport(1440, 900);
  await commands.emulateMedia({});
});

it("on a desktop Esc fades the panel out and then it is gone", async () => {
  mount(false);
  const panel = await openPanel();

  key(panel, "Escape");
  const seen = await opacityFrames(panel, 30);

  expect(seen.some((value) => value > 0 && value < 1)).toBe(true);
  expect(Math.min(...seen)).toBeLessThan(1);
  expect(panel.style.transform).toBe("");
  await expect.poll(() => panelOf(), { timeout: 3000 }).toBeNull();
});

it("Space while the panel fades catches it and brings it back", async () => {
  mount(false);
  const panel = await openPanel();

  key(panel, "Escape");
  // Read frame by frame: a poll on a timer can arrive after the fade has landed.
  let caught = 1;
  for (let at = 0; at < 30 && caught >= 0.9; at += 1) {
    await nextFrame();
    caught = Number(panel.style.opacity);
  }
  expect(caught).toBeGreaterThan(0);
  expect(caught).toBeLessThan(0.9);

  // The opener holds the focus again, as Esc left it.
  flushSync(() => beginLeader(paneOpener(stubCommands())));

  // The spring keeps the fade's speed as it turns, so for a frame or two it dips
  // a few hundredths below where Space caught it before it climbs, by as much as
  // the frame's length. Read frame by frame until it is back there: a fade that
  // started over from nothing would dip far below half.
  let lowest = caught;
  let now = Number(panel.style.opacity);
  for (let at = 0; at < 60 && now < caught; at += 1) {
    await nextFrame();
    expect(panelOf()).toBe(panel);
    now = Number(panel.style.opacity);
    lowest = Math.min(lowest, now);
  }
  expect(panelOf()).toBe(panel);
  expect(lowest).toBeGreaterThan(caught / 2);
  expect(now).toBeGreaterThanOrEqual(caught);
  await expect.poll(() => Number(panel.style.opacity), { timeout: 2000 }).toBe(1);
});

it("narrowing keeps the element and its opacity", async () => {
  mount(false);
  const panel = await openPanel();

  key(panel, "g");
  await nextFrame();
  await nextFrame();

  expect(panelOf()).toBe(panel);
  expect(panel.getAnimations()).toEqual([]);
  expect(getComputedStyle(panel).opacity).toBe("1");
});

it("in a split the panel sits at the foot of the focused pane", async () => {
  mount(false, true);
  const panel = await openPanel();

  const pane = opener().closest("[data-pane]") as HTMLElement;
  const rect = pane.getBoundingClientRect();
  const shown = panel.getBoundingClientRect();
  expect(Math.abs(shown.left - rect.left)).toBeLessThan(1);
  expect(Math.abs(shown.width - rect.width)).toBeLessThan(1);
  expect(Math.abs(shown.bottom - rect.bottom)).toBeLessThan(1);
});

it("on a phone the panel is the sheet with a grabber, and Esc slides it down", async () => {
  await page.viewport(390, 844);
  await commands.emulateMedia({ touch: true });
  mount(true);
  const panel = await openPanel();

  expect(panel.querySelector("[data-sheet-drag]")).not.toBeNull();
  await expect.poll(() => offsetOf(panel), { timeout: 3000 }).toBe(0);

  key(panel, "Escape");
  await expect.poll(() => offsetOf(panel), { timeout: 2000 }).toBeGreaterThan(0);
  await expect.poll(() => panelOf(), { timeout: 3000 }).toBeNull();
});

it("on a phone a flick down closes the panel", async () => {
  await page.viewport(390, 844);
  await commands.emulateMedia({ touch: true });
  mount(true);
  const panel = await openPanel();
  await expect.poll(() => offsetOf(panel), { timeout: 3000 }).toBe(0);

  const grabber = panel.querySelector("[data-sheet-drag]") as HTMLElement;
  const start = centreOf(grabber);
  pointer(grabber, "pointerdown", start.x, start.y);
  pointer(grabber, "pointermove", start.x, start.y + 40);
  // A few ms apart, so the release reads as a speed and not as no movement at all.
  await wait(5);
  pointer(grabber, "pointermove", start.x, start.y + 80);
  pointer(grabber, "pointerup", start.x, start.y + 80);

  await expect.poll(() => panelOf(), { timeout: 3000 }).toBeNull();
});

it("on a phone the toolbar's space button opens the panel", async () => {
  await page.viewport(390, 844);
  await commands.emulateMedia({ touch: true });
  flushSync(() => {
    root.render(
      <>
        <button type="button">Note</button>
        <Toolbar commands={stubCommands()} split={false} />
        <WhichKey phone />
      </>,
    );
  });
  await nextFrame();
  opener().focus();

  const space = document.querySelector<HTMLButtonElement>(
    "button[aria-label='Show the leader keys']",
  ) as HTMLButtonElement;
  const at = centreOf(space);
  pointer(space, "pointerdown", at.x, at.y);
  pointer(space, "pointerup", at.x, at.y);
  space.click();

  await expect.poll(() => panelOf(), { timeout: 2000 }).not.toBeNull();
  expect(panelOf()?.querySelector("[data-sheet-drag]")).not.toBeNull();
});

it("on a phone Tab stays inside the sheet", async () => {
  await page.viewport(390, 844);
  await commands.emulateMedia({ touch: true });
  mount(true);
  const panel = await openPanel();
  await expect.poll(() => offsetOf(panel), { timeout: 3000 }).toBe(0);

  const rows = panel.querySelectorAll<HTMLButtonElement>("button");
  const first = rows[0] as HTMLButtonElement;
  const last = rows[rows.length - 1] as HTMLButtonElement;

  last.focus();
  key(last, "Tab");
  expect(first).toHaveFocus();

  // Shift Tab from the first row goes round to the last.
  first.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }),
  );
  expect(last).toHaveFocus();
});
