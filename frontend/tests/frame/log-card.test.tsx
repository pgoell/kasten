/**
 * The drink card in a real browser (#620): its buttons and amount field are big
 * enough for a finger on a phone, and the page does not scroll sideways at 414px.
 */

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { page } from "vitest/browser";
import { logCard } from "@/lib/log-card";
import { notePath } from "@/lib/todo-commands";
import { shot } from "./shots";
import "@/styles/app.css";

const DAILY = "01 Periodic/00 Daily/2026-10-20.md";
const NOTE = [
  "# 2026-10-20 Tuesday",
  "",
  "[[01 Periodic/00 Daily/2026-10-19]] | [[01 Periodic/00 Daily/2026-10-21]]",
  "",
  "## Log",
  "- 💧 500 ml",
  "- ☕ 1",
  "- 🍺 1 0.5 l 5%",
  "",
  "## Done",
].join("\n");

/** The note on a page of this size, with the card as the note draws it. */
async function mount(width: number, height: number) {
  await page.viewport(width, height);
  const host = document.body.appendChild(document.createElement("div"));
  host.style.cssText = `width: 100%; height: ${height}px; background: #282c34;`;
  const view = new EditorView({
    state: EditorState.create({
      doc: NOTE,
      // As the app mounts it: a long wikilink line wraps, rather than widening the card.
      extensions: [notePath.of(DAILY), logCard, EditorView.lineWrapping],
    }),
    parent: host,
  });
  await expect.poll(() => view.dom.querySelector(".cm-log button")).not.toBeNull();
  return { host, view };
}

it("#620 a phone's buttons are finger-sized and the page does not scroll sideways", async () => {
  try {
    const { host, view } = await mount(414, 896);

    for (const button of view.dom.querySelectorAll<HTMLElement>(".cm-log button")) {
      expect(
        button.getBoundingClientRect().height,
        button.textContent ?? "",
      ).toBeGreaterThanOrEqual(44);
    }
    const field = view.dom.querySelector<HTMLInputElement>(".cm-log-amount");
    expect(field).not.toBeNull();
    expect(getComputedStyle(field as HTMLInputElement).fontSize).toBe("16px");
    const edge = view.dom.getBoundingClientRect().right;
    const controls = [...view.dom.querySelectorAll<HTMLElement>(".cm-log button"), field];
    const past = controls
      .map((control) => ({ control, right: control?.getBoundingClientRect().right ?? 0 }))
      .filter(({ right }) => right > edge)
      .map(({ control, right }) => `${control?.className} right ${right} past ${edge}`);
    expect(past, "controls past the card's right edge").toEqual([]);
    expect(document.documentElement.scrollWidth, "page scrolls sideways").toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
    expect(await shot(host, "log-card-414")).toBe(414);
    view.destroy();
    host.remove();
  } finally {
    await page.viewport(414, 896);
  }
});

it("#620 the card lays out on a desktop without scrolling sideways", async () => {
  try {
    const { host, view } = await mount(1200, 900);

    for (const button of view.dom.querySelectorAll<HTMLElement>(".cm-log button")) {
      expect(
        button.getBoundingClientRect().height,
        button.textContent ?? "",
      ).toBeGreaterThanOrEqual(44);
    }
    const field = view.dom.querySelector(".cm-log-amount") as HTMLInputElement;
    expect(getComputedStyle(field).fontSize).toBe("16px");
    const edge = view.dom.getBoundingClientRect().right;
    const controls = [...view.dom.querySelectorAll<HTMLElement>(".cm-log button"), field];
    const past = controls
      .filter((control) => control.getBoundingClientRect().right > edge)
      .map((control) => control.textContent ?? "");
    expect(past, "controls past the card's right edge").toEqual([]);
    expect(document.documentElement.scrollWidth, "page scrolls sideways").toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
    expect(await shot(host, "log-card-1200")).toBe(1200);
    view.destroy();
    host.remove();
  } finally {
    await page.viewport(414, 896);
  }
});
