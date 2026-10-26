/**
 * The todo pane over one fixed vault, drawn in a real browser for the frame tests of
 * the overview and board redesign (#811). The test file that uses this sets the
 * `@/lib/api` doubles itself, so its `vi.mock` hoists where it has to.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// For its types alone: the provider is what gives `cdp()` a typed `send`.
import type {} from "@vitest/browser-playwright";
import { createRoot } from "react-dom/client";
import { cdp, page } from "vitest/browser";
import { TodoPane } from "@/components/todo-pane";
import type { TodoHit } from "@/lib/api";
import { VIEWS_NOTE } from "@/lib/todo-view";
import { COARSE, NARROW, stubMatchMedia } from "../match-media";
import { stubCommands } from "../stub-commands";
import "@/styles/app.css";

export const TODAY = "2026-10-25";
export const DAILY = "01 Periodic/00 Daily/2026-10-25.md";
export const SHARED_NOTE = "05 Shared/Einkauf.md";
export const PASCAL = "03 Areas/08 People/Pascal.md";

/** The vault's answers the pane asks for. */
export const FILES = [VIEWS_NOTE, DAILY, SHARED_NOTE, PASCAL];

const KASTEN = "02 Projects/Kasten";
const HAUS = "02 Projects/Haus";

/**
 * One todo for each state and each date group, with the tags, projects, parts,
 * waits, blockers and clocks the rows carry, and two shared shopping items.
 */
export const HITS: TodoHit[] = [
  // Overdue, the one date in the past.
  {
    path: DAILY,
    line: 1,
    text: "- [ ] file the expense report #client 📅 2026-10-20",
    project: KASTEN,
    shared: false,
  },
  // Today.
  {
    path: DAILY,
    line: 2,
    text: "- [ ] book the dentist #private 📅 2026-10-25",
    project: null,
    shared: false,
  },
  // This week.
  {
    path: DAILY,
    line: 3,
    text: "- [ ] draft the offer #client 📅 2026-10-28",
    project: KASTEN,
    shared: false,
  },
  // Later, with an assignee.
  {
    path: DAILY,
    line: 4,
    text: "- [ ] buy paint 👤 [[Pascal]] 📅 2026-11-02",
    project: null,
    shared: false,
  },
  // No date and no tag.
  { path: DAILY, line: 5, text: "- [ ] water the plants", project: null, shared: false },
  // Doing, with a clock.
  {
    path: DAILY,
    line: 6,
    text: "- [/] write the parser tests #internal ⏱ 45m",
    project: KASTEN,
    shared: false,
  },
  // Review.
  {
    path: DAILY,
    line: 7,
    text: "- [r] check the budget sheet #internal",
    project: HAUS,
    shared: false,
  },
  // Waiting on Ada since the 20th.
  {
    path: DAILY,
    line: 8,
    text: "- [w] send the invoice 👤 2026-10-20 [[Ada]] #client",
    project: KASTEN,
    shared: false,
  },
  // Blocked by the lamp below.
  {
    path: DAILY,
    line: 9,
    text: "- [b] wait for the paint ⛔ d7k2 #internal",
    project: HAUS,
    shared: false,
  },
  // Open, and the id the blocked todo names.
  {
    path: DAILY,
    line: 10,
    text: "- [ ] order the lamp 🆔 d7k2 #internal",
    project: HAUS,
    shared: false,
  },
  // Done two days back.
  {
    path: DAILY,
    line: 11,
    text: "- [x] pay the rent ✅ 2026-10-23 #private",
    project: null,
    shared: false,
  },
  // Rejected three days back.
  {
    path: DAILY,
    line: 12,
    text: "- [-] cancel the gym ❌ 2026-10-22",
    project: null,
    shared: false,
  },
  // A parent with two parts, one of them done: `1/2`.
  {
    path: DAILY,
    line: 13,
    text: "- [ ] ship the release #client 📅 2026-10-30",
    project: KASTEN,
    shared: false,
  },
  {
    path: DAILY,
    line: 14,
    text: "  - [x] tag the build ✅ 2026-10-24",
    project: KASTEN,
    shared: false,
  },
  { path: DAILY, line: 15, text: "  - [ ] write the notes", project: KASTEN, shared: false },
  // Two items of the share folder, which the toggle hides by default.
  { path: SHARED_NOTE, line: 1, text: "- [ ] Milch", project: null, shared: true },
  { path: SHARED_NOTE, line: 2, text: "- [ ] Eier", project: null, shared: true },
];

/** The key of the cursor's row or card, which is `path:line`. */
export function cursorKey(host: Element): string {
  return host.querySelector<HTMLElement>("[data-row][tabindex='0']")?.dataset.row ?? "";
}

/** A key pressed on the pane, which is where the pane's keys are read. */
export function press(host: Element, key: string) {
  host
    .querySelector("section[aria-label='Todos']")
    ?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}

/** The page coordinates of `element`'s centre, which the DevTools protocol takes. */
export function pagePoint(element: Element): [number, number] {
  const box = element.getBoundingClientRect();
  const frame = window.frameElement?.getBoundingClientRect();
  return [
    box.left + box.width / 2 + (frame?.left ?? 0),
    box.top + box.height / 2 + (frame?.top ?? 0),
  ];
}

/** A left button pressed and let go on `element`, as a mouse does. */
export async function click(element: Element): Promise<void> {
  const [x, y] = pagePoint(element);
  const at = { x, y, button: "left" as const, clickCount: 1 };
  await cdp().send("Input.dispatchMouseEvent", { type: "mousePressed", ...at });
  await cdp().send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at });
}

/** A finger put down at page `[x, y]`, which is a touch the browser turns into pointer events. */
export async function touchDown(x: number, y: number): Promise<void> {
  await cdp().send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
}

/** The finger moved to page `[x, y]` while it is down. */
export async function touchTo(x: number, y: number): Promise<void> {
  await cdp().send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
}

/** The finger lifted. */
export async function touchUp(): Promise<void> {
  await cdp().send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/**
 * The pane at one size, drawn as the list or, with `board`, as the board. Resolves
 * once the rows have arrived, so a row or card is there to find.
 */
export async function mount(
  width: number,
  height: number,
  options: { coarse?: boolean; board?: boolean; reduced?: boolean } = {},
) {
  await page.viewport(width, height);
  // The stub answers the reduced query too, since the app reads motion through it,
  // and the browser's own answer is not the one a spring asks.
  stubMatchMedia({
    [NARROW]: width < 768,
    [COARSE]: options.coarse === true,
    "(prefers-reduced-motion: reduce)": options.reduced === true,
  });
  const onOpen = vi.fn();
  const onCycle = vi.fn();
  const host = document.body.appendChild(document.createElement("div"));
  host.style.cssText = `width: 100%; height: ${height}px;`;
  const root = createRoot(host);
  root.render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <TodoPane
        commands={stubCommands()}
        onOpen={onOpen}
        onCycle={onCycle}
        onAdd={() => {}}
        onSubtask={() => {}}
        onEdit={() => {}}
        onBlock={() => {}}
        onTimer={() => {}}
        onAgent={() => {}}
        onRefile={() => {}}
        onNotice={() => {}}
        focusSignal={0}
        today={TODAY}
        archive={false}
      />
    </QueryClientProvider>,
  );
  await expect.poll(() => host.querySelector("[data-row]")).not.toBeNull();
  if (options.board) {
    press(host, "c");
    await expect.poll(() => host.querySelector("[data-card]")).not.toBeNull();
  }
  return {
    host,
    onOpen,
    onCycle,
    unmount() {
      root.unmount();
      host.remove();
    },
  };
}
