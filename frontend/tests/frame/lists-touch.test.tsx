import { render, screen, within } from "@testing-library/react";
// For its types alone: the provider is what gives `cdp()` a typed `send`.
import type {} from "@vitest/browser-playwright";
import { cdp, commands, page } from "vitest/browser";
import { ListsApp } from "@/lists/lists-app";
import { fakeShare, type Seed } from "../lists-fixture";

const SEED: Record<string, Seed[]> = {
  Einkauf: [
    { text: "Milch", done: false },
    { text: "Vollkornbrot", done: false, assignee: "[[Alicia]]" },
    { text: "Eier", done: true, ticked_by: "Alicia", ticked_at: "2026-10-24T09:05:00Z" },
  ],
  Todo: [],
};

/** The page coordinates of `element`'s centre, which the DevTools protocol takes. */
function pagePoint(element: Element): [number, number] {
  const box = element.getBoundingClientRect();
  const frame = window.frameElement?.getBoundingClientRect();
  return [
    box.left + box.width / 2 + (frame?.left ?? 0),
    box.top + box.height / 2 + (frame?.top ?? 0),
  ];
}

/** A finger put down on `element` and lifted, which the browser turns into a tap. */
async function tap(element: Element): Promise<void> {
  const [x, y] = pagePoint(element);
  await cdp().send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await cdp().send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** A left button pressed and let go on `element`, as a mouse does. */
async function click(element: Element): Promise<void> {
  const [x, y] = pagePoint(element);
  const at = { x, y, button: "left" as const, clickCount: 1 };
  await cdp().send("Input.dispatchMouseEvent", { type: "mousePressed", ...at });
  await cdp().send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at });
}

/** A key pressed and let go, as the keyboard sends it: a key with text (Enter, Space) turns into a click on a button. */
async function key(name: string, code: string, keyCode: number, text = ""): Promise<void> {
  const base = { key: name, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
  await cdp().send("Input.dispatchKeyEvent", {
    type: text ? "keyDown" : "rawKeyDown",
    text,
    ...base,
  });
  await cdp().send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
}

/** Draw the app with the fake share, and wait for its first list. */
async function draw(seed: Record<string, Seed[]> = SEED) {
  localStorage.clear();
  const share = fakeShare(seed);
  vi.stubGlobal("fetch", share.fetch);
  // A stream that never opens, so the poll draws the list and nothing leaves the page.
  vi.stubGlobal(
    "EventSource",
    class {
      readyState = 0;
      onopen = null;
      onerror = null;
      onmessage = null;
      close() {}
    },
  );
  render(<ListsApp />);
  await screen.findByRole("checkbox", { name: "Milch" });
  return share;
}

/** The chip of the row whose words are `text`. Several rows can have nobody, so "Wer?" alone is not one chip. */
function chipOf(text: string): HTMLElement {
  const chip = screen
    .getByRole("checkbox", { name: text })
    .closest(".row")
    ?.querySelector<HTMLElement>(".chip");
  if (!chip) throw new Error(`no assignee chip in the row ${text}`);
  return chip;
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await commands.emulateMedia({});
  await page.viewport(1280, 900);
});

describe("the lists app in a browser, by touch, keys and mouse", () => {
  it("#810 A12 at 390x844 by touch every tap target is at least 44 px and nothing scrolls sideways", async () => {
    await page.viewport(390, 844);
    await commands.emulateMedia({ touch: true });
    await draw();

    expect(screen.getByRole("button", { name: "Hinzufügen" })).toBeInTheDocument();
    const targets = [...document.querySelectorAll<HTMLElement>("button, input.field")];
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) {
      expect(target.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
  }, 30_000);

  it("#810 A12 at 390x844 by touch a tap opens the chip menu and a pick sends the assign", async () => {
    await page.viewport(390, 844);
    await commands.emulateMedia({ touch: true });
    const share = await draw();

    await tap(chipOf("Milch"));
    const menu = screen.getByRole("menu");
    await tap(within(menu).getByRole("menuitemradio", { name: "Alicia" }));

    await vi.waitFor(() =>
      expect(share.posts.some((post) => post.path.endsWith("/assign"))).toBe(true),
    );
    expect(share.posts.at(-1)?.body).toEqual({ line: 0, assignee: "Alicia", sha: "1" });
    expect(screen.queryByRole("menu")).toBeNull();
  }, 30_000);

  it("#810 I8 with reduced motion the chip, the tick and the press have no transition or animation", async () => {
    await page.viewport(390, 844);
    await commands.emulateMedia({ reducedMotion: "reduce", touch: true });
    await draw();

    const chip = chipOf("Milch");
    const tick = screen
      .getByRole("checkbox", { name: "Milch" })
      .querySelector(".check") as HTMLElement;
    for (const element of [chip, tick]) {
      const style = getComputedStyle(element);
      expect([style.transitionDuration, style.animationName]).toEqual(["0s", "none"]);
    }
    const fill = getComputedStyle(tick, "::before");
    expect([fill.transitionDuration, fill.animationName]).toEqual(["0s", "none"]);
  }, 30_000);

  it("#810 A12 at 1440x900 by keys Tab reaches the tick and the chip, and Enter and Escape open and close the menu", async () => {
    await page.viewport(1440, 900);
    await draw();

    screen.getByRole("checkbox", { name: "Milch" }).focus();
    await key("Tab", "Tab", 9);
    const chip = chipOf("Milch");
    expect(document.activeElement).toBe(chip);

    await key("Enter", "Enter", 13, "\r");
    expect(screen.getByRole("menuitemradio", { name: "Niemand" })).toHaveFocus();

    await key("ArrowUp", "ArrowUp", 38);
    expect(screen.getByRole("menuitemradio", { name: "Alicia" })).toHaveFocus();

    await key("Escape", "Escape", 27);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(chip).toHaveFocus();
  }, 30_000);

  it("#810 I7 at 1440x900 a mouse press outside the open menu closes it", async () => {
    await page.viewport(1440, 900);
    await draw();

    await click(chipOf("Milch"));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    await click(screen.getByRole("heading", { name: "Listen" }));
    expect(screen.queryByRole("menu")).toBeNull();
  }, 30_000);
});
