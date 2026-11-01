/**
 * A `page` event on the stream (#1277): it reaches the html panes through
 * `onPageWritten` and asks no cache again, since no note, todo or file list is
 * held under an html page's path. The `listing` the same change sends is what
 * asks for the file lists.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { useRef } from "react";
import { onPageWritten } from "@/lib/html/page-written";
import { LOG_NOTE, MODEL_USE_FOLDER } from "@/lib/layout";
import { periodicNote } from "@/lib/periodic";
import { useVaultEvents } from "@/lib/use-vault-events";
import type { VaultEvent } from "@/lib/vault-events";

// Every call the hook makes lands in one log, so a case reads as the order it happened in.
const { log, echo } = vi.hoisted(() => ({ log: [] as string[], echo: { value: false } }));
vi.mock("@/lib/log/log-card", () => ({ reloadLogConfig: () => log.push("reloadLogConfig") }));
vi.mock("@/lib/todo/todo-press-echo", () => ({
  pressEcho: async () => {
    log.push("pressEcho");
    return echo.value;
  },
}));

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
async function heard(event: () => VaultEvent, focus: Focus = {}, echoed = false) {
  const client = new QueryClient();
  client.setQueryData(["files"], ["a.md", DAILY]);
  render(
    <QueryClientProvider client={client}>
      <Focused {...focus} />
    </QueryClientProvider>,
  );
  echo.value = echoed;
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
      false,
      ["note:a.md", "pressEcho", "graph", "tags", "written-notes", "todos"],
    ],
    [
      "a write to a note the listing lacks",
      () => written("new.md"),
      {},
      false,
      ["note:new.md", "pressEcho", "graph", "tags", "written-notes", "files", "todos"],
    ],
    [
      "a write the focused pane takes",
      () => written("a.md"),
      { path: "a.md" },
      false,
      [
        "isConflicted",
        "reconcile",
        "note:a.md",
        "pressEcho",
        "graph",
        "tags",
        "written-notes",
        "todos",
      ],
    ],
    [
      "a write the focused pane refuses",
      () => written("a.md"),
      { path: "a.md", reconciles: false },
      false,
      [
        "isConflicted",
        "reconcile",
        "declined",
        "pressEcho",
        "graph",
        "tags",
        "written-notes",
        "todos",
      ],
    ],
    [
      "a write to the focused pane's conflicted note",
      () => written("a.md"),
      { path: "a.md", conflicted: true },
      false,
      [
        "isConflicted",
        "reconcile",
        "note:a.md",
        "declined",
        "pressEcho",
        "graph",
        "tags",
        "written-notes",
        "todos",
      ],
    ],
    [
      "a write whose todos are the pane's own press",
      () => written("a.md"),
      {},
      true,
      ["note:a.md", "pressEcho", "graph", "tags", "written-notes"],
    ],
    [
      "a write to a daily note",
      () => written(DAILY),
      {},
      false,
      [`note:${DAILY}`, "pressEcho", "graph", "tags", "log", "written-notes", "todos"],
    ],
    [
      "a write to log.md",
      () => written(LOG_NOTE),
      {},
      false,
      [
        `note:${LOG_NOTE}`,
        "pressEcho",
        "graph",
        "tags",
        "log",
        "written-notes",
        "reloadLogConfig",
        "files",
        "todos",
      ],
    ],
    [
      "a write to a model-use note",
      () => written(MODEL()),
      {},
      false,
      [
        `note:${MODEL()}`,
        "pressEcho",
        "graph",
        "tags",
        "written-notes",
        "model-use",
        "files",
        "todos",
      ],
    ],
    [
      "a write to a weekly note",
      () => written(WEEKLY),
      {},
      false,
      [`note:${WEEKLY}`, "pressEcho", "graph", "tags", "files", "todos"],
    ],
    [
      "a write to a yearly note",
      () => written(YEARLY),
      {},
      false,
      [`note:${YEARLY}`, "pressEcho", "graph", "tags", "files", "todos"],
    ],
    [
      "a removed note",
      () => removed("a.md"),
      {},
      false,
      ["todos", "tags", "written-notes", "files"],
    ],
    [
      "a removed daily note",
      () => removed(DAILY),
      {},
      false,
      ["todos", "tags", "log", "written-notes", "files"],
    ],
    [
      "a removed log.md",
      () => removed(LOG_NOTE),
      {},
      false,
      ["todos", "tags", "log", "written-notes", `note:${LOG_NOTE}`, "reloadLogConfig", "files"],
    ],
    [
      "a listing",
      () => ({ path: "", change: "listing", digest: null }) as VaultEvent,
      {},
      false,
      ["todos", "images", "html", "assets", "tags", "files"],
    ],
  ] as const)("%s", async (_name, event, focus, echoed, calls) => {
    expect(await heard(event, focus, echoed)).toEqual(calls);
  });
});
