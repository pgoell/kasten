/**
 * The todo pane, its board and a person's card, drawn in a real browser for the
 * frame tests of the assignee chip (#809). The test file that uses this sets the
 * `@/lib/api` doubles itself, so its `vi.mock` hoists where it has to.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// For its types alone: the provider is what gives `cdp()` a typed `send`.
import type {} from "@vitest/browser-playwright";
import { createRoot } from "react-dom/client";
import { cdp, page } from "vitest/browser";
import { PersonFooter } from "@/components/person-card";
import { TodoPane } from "@/components/todo-pane";
import type { TodoHit } from "@/lib/api";
import { VIEWS_NOTE } from "@/lib/todo-view";
import { COARSE, NARROW, stubMatchMedia } from "../match-media";
import { stubCommands } from "../stub-commands";
import "@/styles/app.css";

export const TODAY = "2026-10-25";
export const DAILY = "01 Periodic/00 Daily/2026-10-25.md";
export const PASCAL = "03 Areas/08 People/Pascal.md";
export const ALICIA = "03 Areas/08 People/Alicia.md";

/** The two person notes, each `type: Person`, as the vault holds them. */
export const PEOPLE: Record<string, string> = {
  [PASCAL]: "---\ntype: Person\n---\n\n# Pascal\n",
  [ALICIA]: "---\ntype: Person\n---\n\n# Alicia\n",
};

/** The vault's answers the pane asks for, the person notes among them. */
export const FILES = [VIEWS_NOTE, DAILY, PASCAL, ALICIA];

/** One line for each shape of assignee, a wait, a tag, and two todos with no name. */
export const HITS: TodoHit[] = [
  { path: DAILY, line: 1, text: "- [ ] buy paint 👤 [[Pascal]] 📅 2026-10-27", project: null },
  {
    path: DAILY,
    line: 2,
    text: "- [/] book the flat viewing 👤 [[Alicia]] #private",
    project: null,
  },
  {
    path: DAILY,
    line: 3,
    text: "- [w] the contract back 👤 [[Pascal]] 👤 2026-10-20 [[Alicia]] 📅 2026-10-30",
    project: null,
  },
  { path: DAILY, line: 4, text: "- [ ] call the plumber 👤 [[Nobody]]", project: null },
  { path: DAILY, line: 5, text: "- [ ] water the plants", project: null },
  { path: DAILY, line: 6, text: "- [ ] renew the passport 📅 2026-11-02", project: null },
];

/** The chip a row or card draws for `name`, the text it shows. */
export function chipNamed(host: Element, name: string): HTMLElement {
  const chip = [...host.querySelectorAll<HTMLElement>("[data-person]")].find(
    (one) => one.textContent === name,
  );
  if (chip === undefined) throw new Error(`no chip for ${name}`);
  return chip;
}

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
function pagePoint(element: Element): [number, number] {
  const box = element.getBoundingClientRect();
  const frame = window.frameElement?.getBoundingClientRect();
  return [
    box.left + box.width / 2 + (frame?.left ?? 0),
    box.top + box.height / 2 + (frame?.top ?? 0),
  ];
}

/** A finger put down on `element` and lifted, which the browser turns into a tap. */
export async function tap(element: Element): Promise<void> {
  const [x, y] = pagePoint(element);
  await cdp().send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await cdp().send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** A left button pressed and let go on `element`, as a mouse does. */
export async function click(element: Element): Promise<void> {
  const [x, y] = pagePoint(element);
  const at = { x, y, button: "left" as const, clickCount: 1 };
  await cdp().send("Input.dispatchMouseEvent", { type: "mousePressed", ...at });
  await cdp().send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at });
}

/**
 * The pane at one size, drawn as a list or, with `board`, as the board. Resolves
 * once the rows and the person notes have arrived, so a chip is there to find.
 */
export async function mount(
  width: number,
  height: number,
  options: { coarse?: boolean; board?: boolean } = {},
) {
  await page.viewport(width, height);
  stubMatchMedia({ [NARROW]: width < 768, [COARSE]: options.coarse === true });
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
  await expect.poll(() => host.querySelector("[data-person-path]")).not.toBeNull();
  if (options.board) {
    press(host, "c");
    await expect.poll(() => host.querySelector("[data-testid='todo-card']")).not.toBeNull();
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

/**
 * Pascal's note with its card under it, at one size. The card draws only where the
 * note's frontmatter says `type: Person`, which PEOPLE gives it.
 */
export async function mountCard(width: number, height: number) {
  await page.viewport(width, height);
  stubMatchMedia({ [NARROW]: width < 768, [COARSE]: false });
  const onOpen = vi.fn();
  const host = document.body.appendChild(document.createElement("div"));
  host.style.cssText = `width: 100%; height: ${height}px; display: flex; flex-direction: column;`;
  const root = createRoot(host);
  root.render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <div className="flex min-h-0 flex-1 flex-col bg-k-bg font-sans text-k-ink">
        <p className="px-6 pt-6 text-k-15"># Pascal</p>
        <PersonFooter path={PASCAL} paths={FILES} onOpen={onOpen} />
      </div>
    </QueryClientProvider>,
  );
  await expect.poll(() => host.textContent?.includes("buy paint")).toBe(true);
  return {
    host,
    onOpen,
    unmount() {
      root.unmount();
      host.remove();
    },
  };
}
