/**
 * A `page` event on the stream (#1277): it reaches the html panes through
 * `onPageWritten` and asks no cache again, since no note, todo or file list is
 * held under an html page's path. The `listing` the same change sends is what
 * asks for the file lists.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { useRef } from "react";
import { LOG_NOTE, MODEL_USE_FOLDER } from "@/lib/core/layout";
import { periodicNote } from "@/lib/notes/text/periodic";
import { onPageWritten } from "@/lib/panes/html/page-written";
import { useVaultEvents } from "@/lib/vault/events/use-vault-events";
import type { VaultEvent } from "@/lib/vault/events/vault-events";

// Every call the hook makes lands in one log, so a case reads as the order it happened in.
const { log, pressing } = vi.hoisted(() => ({
  log: [] as string[],
  pressing: { value: false },
}));
vi.mock("@/lib/log/log-card", () => ({ reloadLogConfig: () => log.push("reloadLogConfig") }));
vi.mock("@/lib/todo/todo-turns", () => ({ pressRunning: () => pressing.value }));

class FakeStream {
  static last: FakeStream | undefined;
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  close = vi.fn();

  constructor() {
    FakeStream.last = this;
  }

  send(event: VaultEvent) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}

function Route() {
  const focusedNote = useRef({
    path: undefined as string | undefined,
    isWriting: () => false,
    reconcile: () => true,
    isConflicted: () => false,
  });
  useVaultEvents(focusedNote, () => {});
  return null;
}

beforeEach(() => {
  vi.stubGlobal("EventSource", FakeStream);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("a page event tells the panes its path and asks no cache again", () => {
  const client = new QueryClient();
  client.setQueryData(["files"], ["a.md"]);
  render(
    <QueryClientProvider client={client}>
      <Route />
    </QueryClientProvider>,
  );
  const heard: string[] = [];
  const stop = onPageWritten((path) => heard.push(path));
  const invalidate = vi.spyOn(client, "invalidateQueries");

  FakeStream.last?.send({ path: "r/report.html", change: "page", digest: "abc" });
  stop();

  expect({ heard, asked: invalidate.mock.calls.length }).toEqual({
    heard: ["r/report.html"],
    asked: 0,
  });
});

type Focus = { path?: string; reconciles?: boolean; conflicted?: boolean };

function Focused({ path, reconciles = true, conflicted = false }: Focus) {
  const focusedNote = useRef({
    path,
    isWriting: () => false,
    reconcile: () => {
      log.push("reconcile");
      return reconciles;
    },
    isConflicted: () => {
      log.push("isConflicted");
      return conflicted;
    },
  });
  useVaultEvents(focusedNote, () => log.push("declined"));
  return null;
}

const DAY = new Date(2026, 9, 31);
const DAILY = periodicNote("daily", DAY).path;
const WEEKLY = periodicNote("weekly", DAY).path;
const YEARLY = periodicNote("yearly", DAY).path;
const MODEL = () => `${MODEL_USE_FOLDER}/2026-10.md`;

const written = (path: string): VaultEvent => ({ path, change: "written", digest: "d" });
const removed = (path: string): VaultEvent => ({ path, change: "removed", digest: null });

/** The calls one event makes, each invalidation by its key, in order. */
async function heard(event: () => VaultEvent, focus: Focus = {}, press = false) {
  const client = new QueryClient();
  client.setQueryData(["files"], ["a.md", DAILY]);
  render(
    <QueryClientProvider client={client}>
      <Focused {...focus} />
    </QueryClientProvider>,
  );
  pressing.value = press;
  log.length = 0;
  vi.spyOn(client, "invalidateQueries").mockImplementation(async (filters) => {
    log.push((filters?.queryKey ?? []).join(":"));
  });
  FakeStream.last?.send(event());
  await new Promise((resolve) => setTimeout(resolve, 0));
  return [...log];
}

describe("the calls each vault event makes, in order", () => {
  it.each([
    [
      "a write to a listed note no pane shows",
      () => written("a.md"),
      {},
      ["note:a.md", "todos", "graph", "tags", "library", "written-notes"],
    ],
    [
      "a write to a note the listing lacks",
      () => written("new.md"),
      {},
      ["note:new.md", "todos", "graph", "tags", "library", "written-notes", "files"],
    ],
    [
      "a write the focused pane takes",
      () => written("a.md"),
      { path: "a.md" },
      [
        "isConflicted",
        "reconcile",
        "note:a.md",
        "todos",
        "graph",
        "tags",
        "library",
        "written-notes",
      ],
    ],
    [
      "a write the focused pane refuses",
      () => written("a.md"),
      { path: "a.md", reconciles: false },
      [
        "isConflicted",
        "reconcile",
        "declined",
        "todos",
        "graph",
        "tags",
        "library",
        "written-notes",
      ],
    ],
    [
      "a write to the focused pane's conflicted note",
      () => written("a.md"),
      { path: "a.md", conflicted: true },
      [
        "isConflicted",
        "reconcile",
        "note:a.md",
        "declined",
        "todos",
        "graph",
        "tags",
        "library",
        "written-notes",
      ],
    ],
    [
      "a write to a daily note",
      () => written(DAILY),
      {},
      [`note:${DAILY}`, "todos", "graph", "tags", "library", "log", "written-notes"],
    ],
    [
      "a write to log.md",
      () => written(LOG_NOTE),
      {},
      [
        `note:${LOG_NOTE}`,
        "todos",
        "graph",
        "tags",
        "library",
        "log",
        "written-notes",
        "reloadLogConfig",
        "files",
      ],
    ],
    [
      "a write to a model-use note",
      () => written(MODEL()),
      {},
      [
        `note:${MODEL()}`,
        "todos",
        "graph",
        "tags",
        "library",
        "written-notes",
        "model-use",
        "files",
      ],
    ],
    [
      "a write to a weekly note",
      () => written(WEEKLY),
      {},
      [`note:${WEEKLY}`, "todos", "graph", "tags", "library", "files"],
    ],
    [
      "a write to a yearly note",
      () => written(YEARLY),
      {},
      [`note:${YEARLY}`, "todos", "graph", "tags", "library", "files"],
    ],
    [
      "a removed note",
      () => removed("a.md"),
      {},
      ["todos", "tags", "library", "written-notes", "files"],
    ],
    [
      "a removed daily note",
      () => removed(DAILY),
      {},
      ["todos", "tags", "library", "log", "written-notes", "files"],
    ],
    [
      "a removed log.md",
      () => removed(LOG_NOTE),
      {},
      [
        "todos",
        "tags",
        "library",
        "log",
        "written-notes",
        `note:${LOG_NOTE}`,
        "reloadLogConfig",
        "files",
      ],
    ],
    [
      "a listing",
      () => ({ path: "", change: "listing", digest: null }) as VaultEvent,
      {},
      ["todos", "images", "html", "assets", "tags", "library", "files"],
    ],
  ] as const)("%s", async (_name, event, focus, calls) => {
    expect(await heard(event, focus)).toEqual(calls);
  });
});

describe("while a press runs, no event asks for the todos: the press's end does (#1998)", () => {
  it.each([
    [
      "a folder index the press's new daily note made",
      () => written("01 Periodic/00 Daily/index.md"),
      ["note:01 Periodic/00 Daily/index.md", "graph", "tags", "library", "written-notes", "files"],
    ],
    [
      "another writer's note",
      () => written("a.md"),
      ["note:a.md", "graph", "tags", "library", "written-notes"],
    ],
    ["a removed note", () => removed("a.md"), ["tags", "library", "written-notes", "files"]],
    [
      "the listing of the folders it made",
      () => ({ path: "", change: "listing", digest: null }) as VaultEvent,
      ["images", "html", "assets", "tags", "library", "files"],
    ],
  ] as const)("%s", async (_name, event, calls) => {
    expect(await heard(event, {}, true)).toEqual(calls);
  });
});
