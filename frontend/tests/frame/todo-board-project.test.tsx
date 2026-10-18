/**
 * Whether the board draws a todo in the project lane the backend names (#395,
 * #394), in a real browser, on a phone and on a desktop.
 *
 * A daily todo tagged `#p/fde` carries no link and sits in no project folder,
 * so only the `project` the API answers with can put it in the FDE lane.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { page } from "vitest/browser";
import { TodoPane } from "@/components/todo-pane";
import { DEFAULT_VIEWS } from "@/lib/todo-view";
import { COARSE, NARROW, stubMatchMedia } from "../match-media";
import { stubCommands } from "../stub-commands";
import { shot } from "./shots";
import "@/styles/app.css";

// The pane's reads, answered here: the board is drawn off these and no server.
// The rest kept, as the browser checks every named import the graph holds.
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
  { path: DAILY, line: 3, text: "- [ ] send the deck #p/fde", project: "02 Projects/FDE" },
  { path: DAILY, line: 4, text: "- [ ] book the flights", project: null },
  {
    path: "02 Projects/Kasten/plan.md",
    line: 5,
    text: "- [ ] wire up the pane",
    project: "02 Projects/Kasten",
  },
];

/** The lane heading drawn above the card that holds `words`. */
function laneOf(host: Element, words: string): string | null | undefined {
  const card = [...host.querySelectorAll("[data-testid='todo-card']")].find((one) =>
    one.textContent?.includes(words),
  );
  // A phone draws a lane as a block holding its heading; a desktop as a
  // subgrid row whose first child is the heading.
  return card?.closest("div:has(> h3)")?.querySelector("h3")?.textContent;
}

it("A4 #394 draws a tagged daily todo in its tag's project lane, on a phone and a desktop", async () => {
  fetchTodos.mockResolvedValue(HITS);
  // In a `finally`, so a failed shot does not leave its viewport to the cases after it.
  try {
    for (const [width, height] of [
      [414, 896],
      [1280, 900],
    ] as const) {
      await page.viewport(width, height);
      // The board picks its tabs off the pointer, not the width, so the
      // shot is a phone's only with a coarse one.
      const phone = width === 414;
      if (phone) stubMatchMedia({ [COARSE]: true, [NARROW]: true });
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
            focusSignal={0}
            today={TODAY}
            archive={false}
          />
        </QueryClientProvider>,
      );
      await expect.poll(() => host.querySelector("[data-row]")).not.toBeNull();
      const pane = host.querySelector("section[aria-label='Todos']");
      pane?.dispatchEvent(new KeyboardEvent("keydown", { key: "c", bubbles: true }));
      await expect.poll(() => host.querySelector("[data-testid='todo-card']")).not.toBeNull();

      // Lanes by project: `lanes` by finger on a phone, `g` on a desktop.
      if (phone) {
        [...host.querySelectorAll<HTMLElement>("button")]
          .find((one) => one.textContent === "lanes")
          ?.click();
      } else {
        pane?.dispatchEvent(new KeyboardEvent("keydown", { key: "g", bubbles: true }));
      }
      await expect.poll(() => laneOf(host, "book the flights")).toBe("No project");

      expect(laneOf(host, "send the deck")).toBe("FDE");
      expect(laneOf(host, "wire up the pane")).toBe("Kasten");
      expect(await shot(host, `board-project-${width}`)).toBe(width);
      root.unmount();
      host.remove();
      vi.unstubAllGlobals();
    }
  } finally {
    vi.unstubAllGlobals();
    await page.viewport(414, 896);
  }
});
