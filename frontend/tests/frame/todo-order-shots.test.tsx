/**
 * The todo pane after three check-offs, at 1440 and at a phone's 414 (#947).
 *
 * The write answers with the line done and the next read comes back in another
 * order, as a vault would after a save. The rows keep the order they were first
 * drawn in, and the three checked off stay where they were, struck.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { page } from "vitest/browser";
import { TodoPane } from "@/components/todo-pane";
import { DEFAULT_VIEWS } from "@/lib/todo/todo-view";
import { COARSE, NARROW, stubMatchMedia } from "../match-media";
import { stubCommands } from "../stub-commands";
import { shot } from "./shots";
import "@/styles/app.css";

const { fetchTodos } = vi.hoisted(() => ({ fetchTodos: vi.fn() }));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  fetchTodos,
  fetchNote: () => Promise.resolve(DEFAULT_VIEWS),
  fetchFiles: () => Promise.resolve([]),
  createNote: () => Promise.resolve(),
}));

const TODAY = "2026-10-24";
const DAILY = "01 Periodic/00 Daily/2026-10-24.md";
const PLAN = "02 Projects/Plan.md";

interface Line {
  path: string;
  line: number;
  text: string;
}

// Seven open todos of one priority, across two notes.
const START: Line[] = [
  { path: DAILY, line: 3, text: "- [ ] write the release notes ⏫" },
  { path: DAILY, line: 4, text: "- [ ] wire up the pane ⏫" },
  { path: DAILY, line: 5, text: "- [ ] ship the parser ⏫" },
  { path: PLAN, line: 2, text: "- [ ] hear back from legal ⏫" },
  { path: PLAN, line: 5, text: "- [ ] draft the outline ⏫" },
  { path: PLAN, line: 6, text: "- [ ] book the room ⏫" },
  { path: PLAN, line: 9, text: "- [ ] file the receipts ⏫" },
];

/** What the vault holds now, which a write changes and a read answers from. */
let lines: Line[] = [];

/** The write: the line done, then the next read answers in another order. */
function cycle(hit: { path: string; line: number }, client: QueryClient) {
  lines = lines
    .map((line) =>
      line.path === hit.path && line.line === hit.line
        ? { ...line, text: line.text.replace("- [ ]", "- [x]") }
        : line,
    )
    .reverse();
  void client.invalidateQueries({ queryKey: ["todos"] });
}

/** Two animation frames, so a read that landed is laid out and painted. */
const settled = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );

/** One picture: the pane drawn at the width, three rows checked off, the shot taken. */
async function picture(name: string, phone: boolean): Promise<number> {
  lines = START.map((line) => ({ ...line }));
  fetchTodos.mockImplementation(async () => lines.map((line) => ({ ...line })));
  const client = new QueryClient();
  // The number of reads when the last write was made, so the read after it can be waited for.
  let reads = 0;
  const host = document.body.appendChild(document.createElement("div"));
  host.style.cssText = `width: 100%; height: ${phone ? 896 : 900}px; background: #282c34;`;
  const root = createRoot(host);
  try {
    root.render(
      <QueryClientProvider client={client}>
        <TodoPane
          commands={stubCommands()}
          onOpen={() => {}}
          onCycle={(hit) => {
            reads = fetchTodos.mock.calls.length;
            cycle(hit, client);
          }}
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
    await expect.poll(() => host.querySelectorAll("[data-row]").length).toBe(7);
    const section = host.querySelector<HTMLElement>("section[aria-label='Todos']");
    if (section === null) throw new Error("the todo pane has no Todos section");

    const rows = () => [...host.querySelectorAll<HTMLElement>("[data-row]")];
    const keys = () => rows().map((row) => row.dataset.row);
    const struck = () =>
      rows()
        .filter((row) => row.querySelector(".line-through") !== null)
        .map((row) => row.dataset.row);
    const first = keys();

    if (phone) {
      // Tap the state button twice: the first tap arms it, the second writes.
      for (const at of [0, 2, 4]) {
        const row = rows()[at] as HTMLElement;
        const state = row.parentElement?.querySelector<HTMLElement>("button[aria-label^='cycle ']");
        if (!state) throw new Error(`no state button on row ${at}`);
        state.click();
        await expect.poll(() => state.getAttribute("aria-pressed")).toBe("true");
        state.click();
        await expect.poll(() => struck().length).toBe(at / 2 + 1);
      }
    } else {
      // The cursor starts on row 1: x checks it off, j moves down, and so on to row 5.
      const press = async (key: string) => {
        section.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
        await settled();
      };
      // Each key lands in its own frame, as a reader's does: the cursor a key
      // moves is drawn before the next key reads it.
      for (const key of ["x", "j", "j", "x", "j", "j", "x"]) await press(key);
      await expect.poll(() => struck().length, { timeout: 10_000 }).toBe(3);
    }

    // The read after the last write has landed, and laid out.
    await expect
      .poll(() => fetchTodos.mock.calls.length, { timeout: 10_000 })
      .toBeGreaterThan(reads);
    await settled();

    expect(keys()).toEqual(first);
    expect(struck()).toEqual([first[0], first[2], first[4]]);
    expect(await shot(section, name)).toBe(phone ? 414 : 1440);
    return phone ? 414 : 1440;
  } finally {
    root.unmount();
    host.remove();
    vi.unstubAllGlobals();
  }
}

it.runIf(import.meta.env.VITE_KASTEN_SHOTS)(
  "#947 the todo pane after three check-offs at 1440 and at 414",
  async () => {
    // In a `finally`, so a failed picture does not leave its viewport to the cases after it.
    try {
      await page.viewport(1440, 900);
      stubMatchMedia({ [COARSE]: false, [NARROW]: false });
      expect(await picture("todo-order-1440", false)).toBe(1440);

      await page.viewport(414, 896);
      stubMatchMedia({ [COARSE]: true, [NARROW]: true });
      expect(await picture("todo-order-414", true)).toBe(414);
    } finally {
      vi.unstubAllGlobals();
      await page.viewport(414, 896);
    }
  },
);
