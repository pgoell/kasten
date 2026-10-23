import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { HtmlPane } from "@/components/html-pane";
import { takenQuote } from "@/lib/html-take";
import { waiting } from "@/lib/outbox";
import { periodicNote } from "@/lib/periodic";
import { stubCommands } from "./stub-commands";

// The html pane's take tests share these. Each test file mocks the api and the
// outbox itself, since `vi.mock` only reaches the files that call it.

export const PATH = "30 Research/report.html";
export const PASSAGE = { text: "A passage of the report.", heading: "Results", anchor: "results" };
export const RECT = { left: 100, top: 100, right: 160, bottom: 120 };
export const READING = "00 Notes/Reading.md";

/** The dump the take writes, and the daily note's text with it in its `## Dump`. */
export const QUOTE = takenQuote(PATH, PASSAGE);
export const DAILY = periodicNote("daily", new Date()).path;
export const NOTE = `## Dump\n\n${QUOTE}\n`;

/** Drop the outbox's database, which only goes once the outbox has let go of it. */
export function dropped(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase("kasten-outbox");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/** A message as the window hears it, from `source`, the way a page's script posts one. */
export function fromPage(source: Window | null, data: unknown) {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, source }));
  });
}

/** What the page sends for a selection, with the fields the test does not name. */
export function selection(over: Record<string, unknown> = {}) {
  return {
    kasten: "selection",
    text: PASSAGE.text,
    heading: PASSAGE.heading,
    anchor: PASSAGE.anchor,
    rect: RECT,
    ...over,
  };
}

/** A fetch that answers every call with a sent dump, and records what it was asked. */
export function answering() {
  const sent = vi.fn(async (_url: string, _init?: RequestInit) => {
    return new Response(JSON.stringify({}), { status: 200 });
  });
  vi.stubGlobal("fetch", sent);
  return sent;
}

/** The bodies of the dumps that were posted, in the order they were sent. */
export function dumpsSent(sent: ReturnType<typeof answering>) {
  return sent.mock.calls
    .filter(([url]) => url === "/api/dump")
    .map(([, init]) => JSON.parse(String(init?.body)) as { text: string; date: string });
}

/** A fetch whose dump send waits until the test lets it land, and records what it was asked. */
export function answeringLate() {
  let land = () => {};
  const landed = new Promise<void>((resolve) => {
    land = resolve;
  });
  const sent = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url === "/api/dump") await landed;
    return new Response(JSON.stringify({}), { status: 200 });
  });
  vi.stubGlobal("fetch", sent);
  return { sent, land };
}

/** Lets the outbox send what it holds, and the take that sent it, run to its end. */
export async function drained() {
  for (let turn = 0; turn < 200 && (await waiting()).length > 0; turn++) {
    await act(() => new Promise<void>((resolve) => setImmediate(resolve)));
  }
  await act(() => new Promise<void>((resolve) => setImmediate(resolve)));
}

/** The pane, wrapped for the queries the toast's note list makes. */
export function renderPane(path = PATH) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <HtmlPane path={path} commands={stubCommands()} onFocus={() => {}} />
    </QueryClientProvider>,
  );
  const frame = view.container.querySelector("iframe") as HTMLIFrameElement;
  const section = view.container.querySelector("[data-html-pane]") as HTMLElement;
  return { frame, section };
}

/** The take button, as a reader finds it. */
export function takeButton() {
  return screen.queryByRole("button", { name: "Take the passage" });
}

/** Presses `y` from the page, the frame having the focus. */
export function yFromPage(frame: HTMLIFrameElement) {
  fromPage(frame.contentWindow, { kasten: "key", key: "y" });
}

/**
 * Lets the take finish, which runs through IndexedDB: the answer comes on the
 * next macrotask, so the test waits for a macrotask at a time, a bounded number.
 */
export async function settled(done: () => boolean) {
  for (let turn = 0; turn < 200 && !done(); turn++) {
    await act(() => new Promise<void>((resolve) => setImmediate(resolve)));
  }
}
