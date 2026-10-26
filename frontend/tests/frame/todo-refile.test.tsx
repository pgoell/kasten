/**
 * Whether the refile key reaches a person in a real browser (#396): a row's
 * `⋯` strip on a phone holds `refile`, and a desktop's footer names `m`.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { page } from "vitest/browser";
import { TodoPane } from "@/components/todo-pane";
import type { TodoHit } from "@/lib/api";
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
  { path: DAILY, line: 3, text: "- [ ] send the deck", project: "02 Projects/FDE" },
  { path: DAILY, line: 4, text: "- [ ] book the flights", project: null, shared: false },
];

/** The pane over `HITS` at one size, and what `onRefile` was handed. */
async function mount(width: number, height: number) {
  await page.viewport(width, height);
  const refiled: TodoHit[] = [];
  const host = document.body.appendChild(document.createElement("div"));
  host.style.cssText = `width: 100%; height: ${height}px; background: #282c34;`;
  const root = createRoot(host);
  root.render(
    <QueryClientProvider client={new QueryClient()}>
      <TodoPane
        commands={stubCommands()}
        onOpen={() => {}}
        onCycle={() => {}}
        onAdd={() => {}}
        onSubtask={() => {}}
        onEdit={() => {}}
        onBlock={() => {}}
        onTimer={() => {}}
        onAgent={() => {}}
        onRefile={(hit) => refiled.push(hit)}
        onNotice={() => {}}
        focusSignal={0}
        today={TODAY}
        archive={false}
      />
    </QueryClientProvider>,
  );
  await expect.poll(() => host.querySelector("[data-row]")).not.toBeNull();
  return { host, root, refiled };
}

it("#396 A4 a phone's row strip holds refile, and a tap refiles", async () => {
  fetchTodos.mockResolvedValue(HITS);
  stubMatchMedia({ [COARSE]: true, [NARROW]: true });
  try {
    const { host, root, refiled } = await mount(414, 896);

    host.querySelector<HTMLElement>("[aria-label='more for send the deck']")?.click();
    await expect
      .poll(() => host.querySelector("[aria-label='refile send the deck']"))
      .not.toBeNull();
    expect(await shot(host, "todo-refile-414")).toBe(414);

    host.querySelector<HTMLElement>("[aria-label='refile send the deck']")?.click();
    expect(refiled).toEqual([HITS[0]]);
    root.unmount();
    host.remove();
  } finally {
    vi.unstubAllGlobals();
    await page.viewport(414, 896);
  }
});

it("#396 A1 a desktop's footer names m refile, and m refiles the row", async () => {
  fetchTodos.mockResolvedValue(HITS);
  try {
    const { host, root, refiled } = await mount(1280, 900);

    expect(host.querySelector("[data-testid='todo-footer']")?.textContent).toContain("m refile");
    expect(await shot(host, "todo-refile-1280")).toBe(1280);

    host
      .querySelector("section[aria-label='Todos']")
      ?.dispatchEvent(new KeyboardEvent("keydown", { key: "m", bubbles: true }));
    expect(refiled).toEqual([HITS[0]]);
    root.unmount();
    host.remove();
  } finally {
    await page.viewport(414, 896);
  }
});
