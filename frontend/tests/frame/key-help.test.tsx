/**
 * Where the key help draws its groups (#516).
 *
 * jsdom lays nothing out, so whether the groups sit in reading order and stay
 * inside a phone's width is answered here in a real browser.
 */

import { createRoot, type Root } from "react-dom/client";
import { page } from "vitest/browser";
import { KeyHelp } from "@/components/key-help";
import "@/styles/app.css";
import { shot } from "./shots";

let root: Root | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  root?.unmount();
  root = undefined;
  host?.remove();
  host = undefined;
});

/** The groups that are not leader keys, written out rather than read off the panel. */
const OTHER = ["Editor", "Terminal", "File tree", "Todo pane", "Screens you type"];

/** Every group card on the panel, in the order the page holds them. */
function cards(at: HTMLElement): { title: string; card: HTMLElement }[] {
  return [...at.querySelectorAll("h3")].map((heading) => ({
    title: heading.textContent ?? "",
    card: heading.closest("section") as HTMLElement,
  }));
}

/**
 * Check that every key in every card starts at its card's first key's left edge (#580).
 *
 * The text is measured and not the `dt`: a `dt` is a grid item stretched to
 * its column, so its own box starts at the same left edge whatever the text
 * inside it does, and right-aligned keys would pass.
 */
function expectKeysLinedUp(at: HTMLElement, width: number) {
  for (const { title, card } of cards(at)) {
    const lefts = [...card.querySelectorAll("dt")].map((dt) => {
      const range = document.createRange();
      range.selectNodeContents(dt);
      return { key: dt.textContent ?? "", left: range.getBoundingClientRect().left };
    });
    const [first] = lefts;
    for (const { key, left } of lefts) {
      expect.soft(left, `${width}: ${title}: ${key}`).toBe(first?.left);
    }
  }
}

/** Render the panel with vim set to `vim`, and check its keys line up at both widths. */
async function keysLineUp(vim: "on" | "off") {
  try {
    localStorage.setItem("kasten.vim", vim);
    await page.viewport(1280, 800);
    host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    root.render(<KeyHelp onClose={() => {}} />);
    const at = host;
    await expect.poll(() => cards(at).length).toBeGreaterThan(0);
    const panel = at.querySelector('[role="dialog"]')?.firstElementChild as HTMLElement;

    expectKeysLinedUp(at, 1280);
    await shot(panel, `key-help-1280-vim-${vim}`);

    await page.viewport(414, 896);
    expectKeysLinedUp(at, 414);
    await shot(panel, `key-help-414-vim-${vim}`);
  } finally {
    localStorage.removeItem("kasten.vim");
    await page.viewport(414, 896);
  }
}

it("key help lines its keys up on the left, vim on", async () => {
  await keysLineUp("on");
});

it("key help lines its keys up on the left, vim off", async () => {
  await keysLineUp("off");
});

it("key help lays its groups out in reading order, at desktop and at phone width", async () => {
  try {
    await page.viewport(1280, 800);
    host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    root.render(<KeyHelp onClose={() => {}} />);
    const at = host;
    await expect.poll(() => cards(at).length).toBeGreaterThan(0);
    const panel = at.querySelector('[role="dialog"]')?.firstElementChild as HTMLElement;

    // Picked by title and not by block, so the same cards are measured
    // whatever the panel wraps them in.
    const leader = cards(at)
      .filter(({ title }) => !OTHER.includes(title))
      .map(({ card }) => card.getBoundingClientRect());
    expect(leader.length).toBeGreaterThan(3);
    const [first, second, , fourth] = leader as [DOMRect, DOMRect, DOMRect, DOMRect];
    // Soft, so a failed width still measures the other.
    expect.soft(second.left).toBeGreaterThan(first.right);
    expect.soft(second.top).toBe(first.top);
    expect.soft(fourth.left).toBe(first.left);
    await shot(panel, "key-help-1280");

    await page.viewport(414, 896);
    const lefts = cards(at).map(({ card }) => card.getBoundingClientRect().left);
    expect(new Set(lefts).size).toBe(1);
    const scroller = panel.querySelector(".overflow-auto") as HTMLElement;
    expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth);
    await shot(panel, "key-help-414");
  } finally {
    await page.viewport(414, 896);
  }
});
