/**
 * Whether the agent key reaches a person in a real browser (#523): a row's
 * `⋯` strip on a phone holds `agent`, a desktop's footer names `@`, and the
 * refusal for client work fits the foot under the pane.
 *
 * The route is not mounted: the notice is the status bar's, handed the
 * sentence the route puts there, so the picture shows both as they stack.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { page } from "vitest/browser";
import { StatusBar } from "@/components/status-bar";
import { TodoPane } from "@/components/todo-pane";
import type { SearchHit } from "@/lib/api";
import { DEFAULT_VIEWS } from "@/lib/todo/todo-view";
import { COARSE, NARROW, stubMatchMedia } from "../match-media";
import { stubCommands } from "../stub-commands";
import { shot } from "./shots";
import "@/styles/app.css";

// The pane's reads, answered here, as the refile frame test answers them.
const { fetchTodos } = vi.hoisted(() => ({ fetchTodos: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  fetchTodos,
  fetchNote: () => Promise.resolve(DEFAULT_VIEWS),
  fetchFiles: () => Promise.resolve([]),
  createNote: () => Promise.resolve(),
}));

const TODAY = "2026-10-19";
const DAILY = "01 Periodic/00 Daily/2026-10-19.md";
const HITS = [
  {
    path: DAILY,
    line: 3,
    text: "- [ ] draft the release notes #agent 📅 2026-10-20",
    project: null,
  },
  { path: DAILY, line: 4, text: "- [ ] bill the March hours #client", project: null },
];
const REFUSED = "Nothing moved: the agent skips client work";

/** The pane over `HITS` with the status bar under it, saying `REFUSED` once `@` is asked of the client row. */
function Screen({ asked }: { asked: SearchHit[] }) {
  const [notice, setNotice] = useState<string>();
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        <TodoPane
          commands={stubCommands()}
          onOpen={() => {}}
          onCycle={() => {}}
          onAdd={() => {}}
          onSubtask={() => {}}
          onEdit={() => {}}
          onBlock={() => {}}
          onTimer={() => {}}
          onAgent={(hit) => {
            asked.push(hit);
            setNotice(REFUSED);
          }}
          onRefile={() => {}}
          onNotice={() => {}}
          focusSignal={0}
          today={TODAY}
          archive={false}
        />
      </div>
      <StatusBar version="0.0.0" notice={notice} />
    </div>
  );
}

async function mount(width: number, height: number) {
  await page.viewport(width, height);
  const asked: SearchHit[] = [];
  const host = document.body.appendChild(document.createElement("div"));
  host.style.cssText = `width: 100%; height: ${height}px; background: #282c34;`;
  const root = createRoot(host);
  root.render(
    <QueryClientProvider client={new QueryClient()}>
      <Screen asked={asked} />
    </QueryClientProvider>,
  );
  await expect.poll(() => host.querySelector("[data-row]")).not.toBeNull();
  return { host, root, asked };
}

const notice = (host: HTMLElement) =>
  host.querySelector("[data-testid='notice']")?.textContent ?? null;

it("#523 A9 a phone's row strip holds agent, and the refusal fits the foot", async () => {
  fetchTodos.mockResolvedValue(HITS);
  stubMatchMedia({ [COARSE]: true, [NARROW]: true });
  try {
    const { host, root, asked } = await mount(414, 896);

    host
      .querySelector<HTMLElement>("[aria-label='more for bill the March hours #client']")
      ?.click();
    await expect
      .poll(() => host.querySelector("[aria-label='agent bill the March hours #client']"))
      .not.toBeNull();
    host.querySelector<HTMLElement>("[aria-label='agent bill the March hours #client']")?.click();
    await expect.poll(() => notice(host)).toBe(REFUSED);
    expect(asked).toEqual([HITS[1]]);
    expect(document.documentElement.scrollWidth, "page scrolls sideways").toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
    expect(await shot(host, "todo-agent-414")).toBe(414);
    root.unmount();
    host.remove();
  } finally {
    vi.unstubAllGlobals();
    await page.viewport(414, 896);
  }
});

it("#523 A10 a desktop's footer names @ agent, and @ asks for the row", async () => {
  fetchTodos.mockResolvedValue(HITS);
  try {
    const { host, root, asked } = await mount(1280, 900);

    expect(host.querySelector("[data-testid='todo-footer']")?.textContent).toContain("@ agent");
    const pane = host.querySelector("section[aria-label='Todos']") as HTMLElement;
    pane.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
    // A frame for the cursor to land, or `@` reads the row it left.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    pane.dispatchEvent(new KeyboardEvent("keydown", { key: "@", bubbles: true }));
    await expect.poll(() => notice(host)).toBe(REFUSED);
    expect(asked).toEqual([HITS[1]]);
    expect(await shot(host, "todo-agent-1280")).toBe(1280);
    root.unmount();
    host.remove();
  } finally {
    await page.viewport(414, 896);
  }
});
