/**
 * The refusal `<leader>gc` draws at the foot of the window, and its pictures (#503).
 *
 * jsdom lays nothing out, so it cannot say whether the sentence is on screen or
 * squeezed off the bar's edge on a phone. This mounts the whole route in a real
 * browser over a vault without `reading-now.md`, and looks at where the notice
 * lands at phone and at desktop width.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
// For its types alone: the provider is what gives `cdp()` a typed `send`.
import type {} from "@vitest/browser-playwright";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { cdp, page } from "vitest/browser";
import { routeTree } from "@/routeTree.gen";
import { shot } from "./shots";
import "@/styles/app.css";

const READING = "99 Misc/01 Config/reading-now.md";

// The real module with every read the route makes on mount answered here,
// there being no backend behind the frame. The config note's read is the 404
// the refusal is about.
vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    fetchFiles: async () => ["index.md"],
    fetchNote: async (path: string) => {
      if (path === READING) throw new real.NoteMissing(path);
      return "the index note";
    },
    fetchImages: async () => [],
    fetchHtml: async () => [],
    fetchAssets: async () => [],
    fetchTags: async () => [],
    fetchTodos: async () => [],
    fetchTerminals: async () => [],
    fetchVersion: async () => "0.8.0",
    fetchWeather: async () => [],
  };
});

vi.mock("@/lib/trash-api", async (original) => ({
  ...(await original<typeof import("@/lib/trash-api")>()),
  fetchTrash: async () => [],
}));

/** A stream that never says anything, so the route opens no connection. */
class SilentEventSource {
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  close() {}
}

let root: Root | undefined;
let host: HTMLElement | undefined;

async function mount(): Promise<void> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await act(async () => {
    await router.load();
  });
  host = document.body.appendChild(document.createElement("div"));
  host.className = "h-dvh bg-k-bg";
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
  });
}

async function unmount(): Promise<void> {
  await act(async () => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
}

beforeEach(() => {
  vi.stubGlobal("EventSource", SilentEventSource);
});

afterEach(async () => {
  await unmount();
  vi.unstubAllGlobals();
  localStorage.removeItem("kasten.workspace.1");
  localStorage.removeItem("kasten.workspace.coarse.1");
  localStorage.removeItem("kasten.vim");
  await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await page.viewport(414, 896);
});

/** Space g c, typed into the editor the empty pane holds. */
function pressLeader(): void {
  const editor = document.querySelector<HTMLElement>(".cm-content");
  expect.soft(editor).not.toBeNull();
  for (const key of [" ", "g", "c"]) {
    editor?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  }
}

/** The palette's row, which is how a phone with no keyboard reaches the command. */
async function runFromPalette(): Promise<void> {
  const button = () => document.querySelector<HTMLElement>("[aria-label='Run a command by name']");
  const row = () =>
    [...document.querySelectorAll<HTMLElement>("[role='option']")].find((option) =>
      option.textContent?.startsWith("Read the current book"),
    );
  await expect.poll(button).not.toBeNull();
  await act(async () => button()?.click());
  await expect.poll(row).toBeDefined();
  await act(async () => row()?.click());
}

const notice = () => document.querySelector<HTMLElement>("[data-testid='notice']");

/**
 * The route at `width` by `height`, with a finger for a pointer when `touch`,
 * and the editor of its empty pane on screen. At a desk it also waits for vim
 * to be on, so the Space that follows is the leader and not typed text.
 */
async function opened(width: number, height: number, touch: boolean): Promise<void> {
  await page.viewport(width, height);
  await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: touch, maxTouchPoints: 5 });
  // Said outright at a desk, where the leader is typed: with no choice stored,
  // vim mode follows `(pointer: coarse)`, which another frame file's touch
  // emulation or a `kasten.vim` it left can answer, and with vim off the Space
  // is typed into the note instead (#909).
  if (!touch) localStorage.setItem("kasten.vim", "on");
  await mount();
  await expect.poll(() => document.querySelector(".cm-content")).not.toBeNull();
  // The Space is the leader only while vim runs in normal mode, which is what
  // `leaderPanel` checks. The stored setting can be wiped by another frame file
  // running beside this one, so the keys wait on the class vim sets, not on the
  // editor alone (#909).
  if (!touch) {
    await expect
      .poll(() => document.querySelector(".cm-scroller.cm-vimMode .cm-content"))
      .not.toBeNull();
  }
}

/** The refusal on screen and at the foot, then its picture as `name`. */
async function refusalAtFoot(name: string): Promise<void> {
  await expect.poll(() => notice()?.textContent).toBe(`${READING} is not there`);
  const box = notice()?.getBoundingClientRect();
  // Inside the window on every side, with some width to read, and in the lower
  // part of it rather than over the note.
  expect.soft(box?.width ?? 0).toBeGreaterThan(0);
  expect.soft(box?.left ?? -1).toBeGreaterThanOrEqual(0);
  expect.soft(box?.right ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(innerWidth);
  expect.soft(box?.bottom ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(innerHeight);
  expect.soft(box?.top ?? 0).toBeGreaterThan(innerHeight / 2);

  // The frame shrinks past the runner's window, 1280 wide, so the desktop
  // picture is not held to the width asked for.
  expect(await shot(host as Element, name)).toBeGreaterThan(0);
}

describe("the refusal of <leader>gc (#503)", () => {
  it("draws the refusal of <leader>gc at the foot, at phone width", async () => {
    await opened(414, 896, true);

    await runFromPalette();

    await refusalAtFoot("reading-book-refusal-phone");
  });

  it("draws the refusal of <leader>gc at the foot, at desktop width", async () => {
    await opened(1440, 900, false);

    await act(async () => pressLeader());

    await refusalAtFoot("reading-book-refusal-desktop");
  });
});
