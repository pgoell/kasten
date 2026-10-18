/**
 * Whether a card drags on the board in a real browser (#397): a long press
 * lifts it on a phone and a tab takes it, a mouse lifts it past the slop on a
 * desktop and a column takes it. The pointer events are dispatched on the
 * elements, as a finger or a mouse would send them.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { page } from "vitest/browser";
import { TodoPane } from "@/components/todo-pane";
import type { SearchHit } from "@/lib/api";
import type { TodoState } from "@/lib/todo";
import { DEFAULT_VIEWS } from "@/lib/todo-view";
import { COARSE, NARROW, stubMatchMedia } from "../match-media";
import { stubCommands } from "../stub-commands";
import { shot } from "./shots";
import "@/styles/app.css";

// The pane's reads, answered here, as the board's frame test answers them.
const { fetchTodos } = vi.hoisted(() => ({ fetchTodos: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  fetchTodos,
  fetchNote: () => Promise.resolve(DEFAULT_VIEWS),
  fetchFiles: () => Promise.resolve([]),
  createNote: () => Promise.resolve(),
}));

const TODAY = "2026-10-18";
const DAILY = "01 Periodic/00 Daily/2026-10-18.md";
const HITS = [
  { path: DAILY, line: 3, text: "- [ ] send the deck #client", project: "02 Projects/FDE" },
  { path: DAILY, line: 4, text: "- [/] book the flights #client", project: null },
];

/** The board over `HITS` at one size, and what `onCycle` was handed. */
async function mount(width: number, height: number) {
  await page.viewport(width, height);
  const cycled: [SearchHit, TodoState | undefined][] = [];
  const host = document.body.appendChild(document.createElement("div"));
  host.style.cssText = `width: 100%; height: ${height}px; background: #282c34;`;
  const root = createRoot(host);
  root.render(
    <QueryClientProvider client={new QueryClient()}>
      <TodoPane
        commands={stubCommands()}
        onOpen={() => {}}
        onCycle={(hit, state) => cycled.push([hit, state])}
        onAdd={() => {}}
        onSubtask={() => {}}
        onEdit={() => {}}
        onBlock={() => {}}
        onTimer={() => {}}
        onRefile={() => {}}
        onNotice={() => {}}
        focusSignal={0}
        today={TODAY}
        archive={false}
      />
    </QueryClientProvider>,
  );
  await expect.poll(() => host.querySelector("[data-row]")).not.toBeNull();
  host
    .querySelector("section[aria-label='Todos']")
    ?.dispatchEvent(new KeyboardEvent("keydown", { key: "c", bubbles: true }));
  await expect.poll(() => host.querySelector("[data-testid='todo-card']")).not.toBeNull();
  const card = [...host.querySelectorAll<HTMLElement>("[data-testid='todo-card']")].find((one) =>
    one.textContent?.includes("send the deck"),
  ) as HTMLElement;
  return { host, root, cycled, card };
}

/** A pointer event as a finger or a mouse sends it, over the middle of `element`. */
function point(element: Element, type: string, pointerType: string, nudge = 0) {
  const box = element.getBoundingClientRect();
  element.dispatchEvent(
    new PointerEvent(type, {
      pointerType,
      pointerId: pointerType === "touch" ? 2 : 1,
      isPrimary: true,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      clientX: box.x + box.width / 2 + nudge,
      clientY: box.y + box.height / 2,
      bubbles: true,
      cancelable: true,
    }),
  );
}

it("#397 A3 a phone's long press lifts a card, and a drop on a tab sets the state", async () => {
  fetchTodos.mockResolvedValue(HITS);
  stubMatchMedia({ [COARSE]: true, [NARROW]: true });
  try {
    const { host, root, cycled, card } = await mount(414, 896);

    point(card, "pointerdown", "touch");
    // The long press, waited out in the browser's own time.
    await expect.poll(() => card.hasAttribute("data-lifted")).toBe(true);

    // The finger now carries the card, so the page must not scroll under it.
    const move = new Event("touchmove", { bubbles: true, cancelable: true });
    card.dispatchEvent(move);
    expect(move.defaultPrevented).toBe(true);

    const tab = [...host.querySelectorAll("[role='tab']")].find((one) =>
      one.textContent?.startsWith("Done"),
    ) as HTMLElement;
    point(tab, "pointerover", "touch");
    await expect.poll(() => tab.hasAttribute("data-over")).toBe(true);
    expect(await shot(host, "todo-board-drag-414")).toBe(414);

    point(tab, "pointerup", "touch");
    expect(cycled).toEqual([[HITS[0], "done"]]);
    root.unmount();
    host.remove();
  } finally {
    vi.unstubAllGlobals();
    await page.viewport(414, 896);
  }
});

it("#397 A1 a desktop mouse drag lifts a card, and a drop on another column sets the state", async () => {
  fetchTodos.mockResolvedValue(HITS);
  try {
    const { host, root, cycled, card } = await mount(1280, 900);

    point(card, "pointerdown", "mouse");
    point(card, "pointermove", "mouse", 20);
    await expect.poll(() => card.hasAttribute("data-lifted")).toBe(true);

    const cell = host.querySelector("[data-lane='#client'][data-column='waiting']") as HTMLElement;
    point(cell, "pointerover", "mouse");
    await expect.poll(() => cell.hasAttribute("data-over")).toBe(true);
    expect(await shot(host, "todo-board-drag-1280")).toBe(1280);

    point(cell, "pointerup", "mouse");
    expect(cycled).toEqual([[HITS[0], "waiting"]]);
    root.unmount();
    host.remove();
  } finally {
    await page.viewport(414, 896);
  }
});
