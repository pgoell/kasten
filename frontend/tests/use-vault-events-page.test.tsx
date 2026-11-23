/**
 * A `page` event on the stream (#1277): it reaches the html panes through
 * `onPageWritten` and asks no cache again, since no note, todo or file list is
 * held under an html page's path. The `listing` the same change sends is what
 * asks for the file lists.
 */

import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { useRef } from "react";
import { LOG_NOTE, MODEL_USE_FOLDER } from "@/lib/core/layout";
import { periodicNote } from "@/lib/notes/text/periodic";
import { onPageWritten } from "@/lib/panes/html/page-written";
import { beginPress, endPress, forgetEchoes, pressEcho } from "@/lib/todo/todo-turns";
import { useVaultEvents } from "@/lib/vault/events/use-vault-events";
import type { VaultEvent } from "@/lib/vault/events/vault-events";

// Every call the hook makes lands in one log, so a case reads as the order it happened in.
const { log } = vi.hoisted(() => ({ log: [] as string[] }));
vi.mock("@/lib/log/log-card", () => ({ reloadLogConfig: () => log.push("reloadLogConfig") }));

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
  const began = press ? beginPress() : 0;
  log.length = 0;
  vi.spyOn(client, "invalidateQueries").mockImplementation(async (filters) => {
    log.push((filters?.queryKey ?? []).join(":"));
  });
  FakeStream.last?.send(event());
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (press) endPress(began, false);
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

/** The todo reads sent when `events` land (a step runs in between) while the first read is out, then every read lets go; `held` false lets the first go before. */
async function todoReads(
  events: (VaultEvent | ((settle: () => Promise<void>) => unknown))[],
  held = true,
) {
  forgetEchoes();
  const client = new QueryClient();
  const out: (() => void)[] = [];
  let reads = 0;
  const queryFn = () => {
    reads += 1;
    return new Promise<number>((resolve) => out.push(() => resolve(reads)));
  };
  const stop = new QueryObserver(client, { queryKey: ["todos", "pane"], queryFn }).subscribe(
    () => {},
  );
  render(
    <QueryClientProvider client={client}>
      <Route />
    </QueryClientProvider>,
  );
  const settle = async () => {
    for (let go = out.shift(); go; go = out.shift()) {
      go();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };
  if (!held) await settle();
  for (const event of events) {
    if (typeof event === "function") await event(settle);
    else FakeStream.last?.send(event);
  }
  await settle();
  stop();
  return reads;
}

describe("an event while a todo read is out asks once more when it lands, as that read may predate the write (#2273)", () => {
  const todos: VaultEvent = { path: "", change: "todos", digest: null };
  it.each([
    ["a todos event", [todos], 2],
    ["a note write", [written("a.md")], 2],
    ["three events, one read more", [todos, written("a.md"), todos], 2],
    ["no event", [], 1],
  ] as const)("%s", async (_name, events, reads) => {
    expect(await todoReads([...events])).toBe(reads);
  });

  it("with no read out, an event asks at once", async () => {
    expect(await todoReads([todos], false)).toBe(2);
  });
});

describe("a press's own todos event asks nothing, before or after its end read is asked (#2283)", () => {
  const todos: VaultEvent = { path: "", change: "todos", digest: null };
  const pressed = (wrote: boolean) => () => endPress(beginPress(), wrote);
  const running = { began: 0 };
  const begin = () => {
    running.began = beginPress();
  };
  const end = (wrote: boolean) => () => endPress(running.began, wrote);
  it.each([
    ["its echo after its end", [pressed(true), todos], 1],
    ["a todos event during it, then one after its end", [begin, todos, end(true), todos], 2],
    ["a refused press, then a write from elsewhere", [pressed(false), todos], 2],
    ["its echo and a write from elsewhere, both after its end", [pressed(true), todos, todos], 2],
  ] as const)("%s", async (_name, events, reads) => {
    expect(await todoReads([...events])).toBe(reads);
  });

  it("a stream opened afresh owes no echo, so a later event asks", async () => {
    const reopen = async (settle: () => Promise<void>) => {
      FakeStream.last?.onopen?.();
      await settle();
    };
    expect(await todoReads([pressed(true), reopen, todos], false)).toBe(3);
  });

  it("a press running when a stream opens afresh owes no echo once it ends, so a later event asks", async () => {
    const reopen = async (settle: () => Promise<void>) => {
      FakeStream.last?.onopen?.();
      await settle();
    };
    expect(await todoReads([begin, reopen, end(true), todos], false)).toBe(2);
  });

  it("a press begun after a reopen and ended first leaves the older press owing no echo", () => {
    forgetEchoes();
    const older = beginPress();
    forgetEchoes();
    endPress(beginPress(), false);
    endPress(older, true);
    expect(pressEcho()).toBe(false);
  });
});
