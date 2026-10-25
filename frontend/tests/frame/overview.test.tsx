/**
 * The overview in a real browser (#806): four cards across on a desktop, one column on a
 * phone with nothing scrolling sideways, the tap targets, the keys with vim off, and the
 * entrance with reduced motion. jsdom lays nothing out, so these are measured here.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { commands, page, userEvent } from "vitest/browser";
import { routeTree } from "@/routeTree.gen";
import { COARSE, NARROW, stubMatchMedia } from "../match-media";
import "@/styles/app.css";

const REDUCED = "(prefers-reduced-motion: reduce)";

vi.mock("@/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...real,
    fetchFiles: async () => ["index.md"],
    fetchNote: async (path: string) => {
      throw new real.NoteMissing(path);
    },
    fetchImages: async () => [],
    fetchHtml: async () => [],
    fetchAssets: async () => [],
    fetchTags: async () => [],
    fetchTodos: async () => [],
    fetchCards: async () => [],
    fetchWritten: async () => [],
    fetchTerminals: async () => [],
    fetchVersion: async () => "0.8.0",
    fetchWeather: async () => [],
  };
});

vi.mock("@/lib/food-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/food-api")>()),
  fetchLog: async () => [],
}));

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

/** The route mounted on the home screen, which is where a reader starts. */
async function mount(width: number, height: number): Promise<void> {
  await page.viewport(width, height);
  vi.stubGlobal("EventSource", SilentEventSource);
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
  await expect.poll(() => document.querySelector("[data-today]")).not.toBeNull();
}

/** A finger's tap: the pointer and mouse events before the click, as a touch sends them. */
async function tap(element: HTMLElement | null): Promise<void> {
  expect(element, "a control to tap").not.toBeNull();
  await act(async () => {
    element?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    element?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    element?.click();
  });
}

/** The home screen's Overview button, which opens the overview with no keys at all. */
function overviewButton(): HTMLElement | null {
  return (
    [...document.querySelectorAll<HTMLElement>("button")].find(
      (button) => button.textContent === "Overview",
    ) ?? null
  );
}

const overviewPane = () => document.querySelector<HTMLElement>("section[aria-label='Overview']");
const cards = () => [...(overviewPane()?.querySelectorAll<HTMLElement>("article") ?? [])];
const buttons = () => [...(overviewPane()?.querySelectorAll<HTMLElement>(".overview-open") ?? [])];

/** The overview at a desktop's size, opened from the home screen's button. */
async function openDesktop(): Promise<void> {
  await mount(1440, 900);
  await tap(overviewButton());
  await expect.poll(overviewPane).not.toBeNull();
}

/** The overview at a phone's size, by touch, opened from the home screen's button. */
async function openPhone(): Promise<void> {
  stubMatchMedia({ [NARROW]: true, [COARSE]: true });
  await commands.emulateMedia({ touch: true });
  await mount(390, 844);
  await tap(overviewButton());
  await expect.poll(overviewPane).not.toBeNull();
}

afterEach(async () => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = undefined;
  host = undefined;
  localStorage.clear();
  vi.unstubAllGlobals();
  await commands.emulateMedia({});
  await page.viewport(414, 896);
});

beforeEach(() => {
  localStorage.clear();
});

it("#806 A9 at 1440x900 the cards stand four across", async () => {
  await openDesktop();

  // `offsetTop` reads the grid's placement and not the entrance's transform, so the
  // arrival still playing does not move the answer.
  const tops = cards().map((card) => card.offsetTop);
  expect(tops).toHaveLength(8);
  expect(new Set(tops.slice(0, 4)).size).toBe(1);
  expect(tops[4]).toBeGreaterThan(tops[0] as number);
});

it("#806 A9 at 390x844 by touch the cards stand in one column, nothing scrolls sideways, and a tap on Food opens the log pane", async () => {
  await openPhone();

  expect(new Set(cards().map((card) => card.offsetLeft)).size).toBe(1);
  const tops = cards().map((card) => card.offsetTop);
  expect(tops.every((top, index) => index === 0 || top > (tops[index - 1] as number))).toBe(true);
  const root = document.documentElement;
  expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
  const pane = overviewPane() as HTMLElement;
  expect(pane.scrollWidth).toBeLessThanOrEqual(pane.clientWidth);

  await tap(buttons()[0] as HTMLElement);

  await expect.poll(() => document.querySelector("section[aria-label='Log']")).not.toBeNull();
});

it("#806 I7 every card's button is at least 44 px tall on touch", async () => {
  await openPhone();

  const heights = buttons().map((button) => button.getBoundingClientRect().height);
  expect(heights).toHaveLength(8);
  for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
});

it("#806 A9 with vim off the keys move between cards and Enter opens one", async () => {
  localStorage.setItem("kasten.vim", "off");
  await openDesktop();

  buttons()[0]?.focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(document.activeElement).toBe(buttons()[1]);
  // Four cards stand across, so one press down goes from Today to the card under it.
  await userEvent.keyboard("{ArrowDown}");
  expect(document.activeElement).toBe(buttons()[5]);
  await userEvent.keyboard("{ArrowUp}");
  await userEvent.keyboard("{ArrowLeft}");
  expect(document.activeElement).toBe(buttons()[0]);

  await userEvent.keyboard("{Enter}");

  await expect.poll(() => document.querySelector("section[aria-label='Log']")).not.toBeNull();
});

it("#806 A9 with reduced motion the cards do not slide in", async () => {
  stubMatchMedia({ [REDUCED]: true });
  await commands.emulateMedia({ reducedMotion: "reduce" });
  await openDesktop();

  for (const card of cards()) {
    expect(getComputedStyle(card).animationName).toBe("none");
  }
});
