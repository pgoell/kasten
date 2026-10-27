import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { TodoPane } from "@/components/todo-pane";
import { fetchFiles } from "@/lib/api";
import type { EditorCommands } from "@/lib/key-bindings";
import { periodicNote } from "@/lib/periodic";
import { useTodoActions } from "@/lib/todo/use-todo-actions";
import { useVaultEvents } from "@/lib/use-vault-events";
import { digestOf, type VaultEvent } from "@/lib/vault-events";
import { COARSE, NARROW, stubMatchMedia } from "./match-media";

/** The notes the fake backend holds. Only the HTTP client is faked, so `api.ts` runs. */
const vault = vi.hoisted(() => ({
  notes: {} as Record<string, string>,
  /** How many answers `/api/todos` has given, which is what shuffles them. */
  answers: 0,
  /** Whether a write is refused, as the vault refuses one it cannot place. */
  refuse: false,
  /** Held back for the next list answer only, which then waits on this before it lands. */
  held: undefined as Promise<void> | undefined,
  /** How many more writes land before the next is refused, when counted. */
  allow: undefined as number | undefined,
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api-client")>();
  const ok = (data: unknown) => ({ data, response: { status: 200 } });
  const missing = { data: undefined, response: { status: 404 } };
  return {
    ...real,
    client: {
      GET: async (url: string, init?: { params?: { path?: { path: string } } }) => {
        if (url === "/api/files") return ok(Object.keys(vault.notes));
        // Nothing else in the vault names a todo's id, which is all a search answers.
        if (url === "/api/search") return ok([]);
        if (url === "/api/todos") {
          // Every answer comes back in another order, the way the vault's search
          // does not promise one, so a list that is redrawn from it reorders.
          const hits = Object.entries(vault.notes).flatMap(([path, text]) =>
            lf(text)
              .split("\n")
              .map((line, index) => ({ path, line: index + 1, text: line }))
              .filter((hit) => hit.text.startsWith("- [")),
          );
          vault.answers += 1;
          const turn = vault.answers % hits.length;
          const answer = ok([...hits.slice(turn), ...hits.slice(0, turn)]);
          // The lines as they stood when this was asked, whatever lands after.
          const wait = vault.held;
          vault.held = undefined;
          return wait === undefined ? answer : wait.then(() => answer);
        }
        const path = init?.params?.path?.path;
        const text = path === undefined ? undefined : vault.notes[path];
        if (path === undefined || text === undefined) return missing;
        return ok({ path, content: lf(text) });
      },
      PUT: async (
        _url: string,
        init: { params: { path: { path: string } }; body: { content: string } },
      ) => {
        if (vault.refuse || vault.allow === 0)
          return { data: undefined, response: { status: 500 } };
        if (vault.allow !== undefined) vault.allow -= 1;
        const path = init.params.path.path;
        // A note with CRLF lines keeps them: the backend lands every lone LF as
        // CRLF, and answers with the text it was sent, as LF.
        const crlf = (vault.notes[path] ?? "").includes("\r\n");
        vault.notes[path] = crlf
          ? init.body.content.replace(/(?<!\r)\n/g, "\r\n")
          : init.body.content;
        return ok({ path, content: init.body.content });
      },
      POST: async (
        _url: string,
        init: { params: { path: { path: string } }; body: { content: string } },
      ) => {
        const path = init.params.path.path;
        if (vault.notes[path] !== undefined) return { data: undefined, response: { status: 409 } };
        vault.notes[path] = init.body.content;
        return { data: { path, content: init.body.content }, response: { status: 201 } };
      },
    },
  };
});

/** A note's text as the backend reads it out: every CRLF as an LF. */
function lf(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

/** Let the clock run on by `ms`, with whatever is due then. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** The day the pane is drawn for. Nothing here is dated, so it decides no order. */
const TODAY = "2026-08-10";
/** Today's daily note as the app names it, which a press's done log writes into. */
const DAILY = periodicNote("daily", new Date()).path;
const NAMES = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "kilo"];

/** The stream the route opens, driven by the test. */
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

function stream(): FakeStream {
  if (!FakeStream.last) throw new Error("The hook opened no EventSource");
  return FakeStream.last;
}

const commands = new Proxy({} as EditorCommands, { get: () => () => {} });

/** The pane with the real write hooks and the stream under it, as the route wires them. */
function Pane() {
  // The hook reads the listing of the vault's notes, which is what it checks a
  // write's note against, not the todos.
  const { data } = useQuery({ queryKey: ["files"], queryFn: fetchFiles });
  const [notice, setNotice] = useState<string>();
  const focusedNote = useRef({
    path: undefined as string | undefined,
    isWriting: () => false,
    reconcile: () => false,
    isConflicted: () => false,
  });
  const actions = useTodoActions({
    data,
    archive: false,
    write: async <T,>(_note: string, work: () => Promise<T>) => work(),
    focusedNote,
    setNotice,
  });
  useVaultEvents(focusedNote, () => {});
  return (
    <>
      <TodoPane
        commands={commands}
        onOpen={() => {}}
        onCycle={actions.cycleTodo}
        onAdd={() => {}}
        onSubtask={() => {}}
        onEdit={actions.editTodo}
        onBlock={actions.blockTodo}
        onTimer={actions.toggleTimer}
        onAgent={actions.agentTodo}
        onRefile={actions.refileTodo}
        onNotice={setNotice}
        focusSignal={0}
        today={TODAY}
      />
      <p data-testid="notice">{notice}</p>
    </>
  );
}

/** Let every answer in hand reach the pane, without the clock moving on. */
async function settle() {
  for (let round = 0; round < 3; round += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

const panel = () => screen.getByRole("region", { name: "Todos" });

/** A key pressed in the pane, which is where the list's keys are read. */
function press(key: string) {
  fireEvent.keyDown(panel(), { key });
}

/** The rows as drawn, by the word each one names, in the order they are drawn. */
function order(): string[] {
  return [...document.querySelectorAll<HTMLElement>("[data-row]")].map(
    (row) => NAMES.find((name) => row.textContent?.includes(name)) ?? "",
  );
}

/** The row drawn for a word, or undefined where it is not drawn. */
function rowOf(name: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>("[data-row]")].find((row) =>
    row.textContent?.includes(name),
  );
}

/** The note a row was read from, which its key starts with. */
function noteOf(row: HTMLElement | undefined): string {
  return (row?.getAttribute("data-row") ?? "").replace(/:\d+$/, "");
}

/** The fetches of the todo query, counted in the cache: a press's own read is not one. */
function countFetches(client: QueryClient): () => number {
  let fetches = 0;
  client.getQueryCache().subscribe((event) => {
    if (
      event.type === "updated" &&
      event.action.type === "fetch" &&
      event.query.queryKey[0] === "todos" &&
      event.query.queryKey[1] === false
    ) {
      fetches += 1;
    }
  });
  return () => fetches;
}

async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Pane />
    </QueryClientProvider>,
  );
  await settle();
  return client;
}

describe("the todo pane holds the order it is drawn in while a press is made", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeStream);
    vault.answers = 0;
    vault.refuse = false;
    vault.held = undefined;
    vault.allow = undefined;
    // Doing, not open: the state cycle goes open, doing, done, so one `x` on a
    // row in progress checks it off.
    vault.notes = {
      "a.md": ["## TODOs", "- [/] alpha", "- [/] bravo", "- [/] charlie", "- [/] delta"].join("\n"),
      "b.md": ["## TODOs", "- [/] echo", "- [/] foxtrot"].join("\n"),
      [DAILY]: ["## TODOs", "- [/] golf"].join("\n"),
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("#947 A1 three check-offs in a row keep every other row where it was", async () => {
    await mount();
    const first = order();

    press("x");
    expect(order()).toEqual(first);
    await settle();
    expect(order()).toEqual(first);

    press("j");
    press("x");
    expect(order()).toEqual(first);
    await settle();
    expect(order()).toEqual(first);

    press("j");
    press("x");
    expect(order()).toEqual(first);
    await settle();
    expect(order()).toEqual(first);
  });

  it("#947 A2 a row checked off stays in place, struck, until the pane is left", async () => {
    await mount();
    const first = order();
    const outside = document.createElement("button");
    document.body.append(outside);

    panel().focus();
    press("x");
    await settle();
    expect(order()).toEqual(first);
    expect(rowOf(first[0] ?? "")?.querySelector(".line-through")?.textContent).toBe(first[0]);

    outside.focus();
    await settle();
    expect(order()).toHaveLength(first.length - 1);
    expect(order()).not.toContain(first[0]);
    expect(document.querySelector(".line-through")).toBeNull();
    outside.remove();
  });

  it("#947 I1 pressing O on a struck row reopens it in place", async () => {
    await mount();
    const first = order();

    press("x");
    await settle();
    // `x` on a done row takes its checkbox off the line; `O` sets it open again.
    press("O");
    await settle();

    expect(order()).toEqual(first);
    expect(rowOf(first[0] ?? "")?.querySelector(".line-through")).toBeNull();
  });

  it("#947 A3 one press fetches the todo list once, and the echoes of its own writes do not fetch it again", async () => {
    const client = await mount();
    const fetches = countFetches(client);
    const pressed = rowOf(order()[0] ?? "");
    const note = noteOf(pressed);

    press("x");
    await settle();
    expect(fetches()).toBe(1);

    // The writes the press made, reported by the stream after its answer landed.
    // Each echo carries the digest of the text the press wrote, as the vault reports it.
    stream().send({
      path: note,
      change: "written",
      digest: await digestOf(vault.notes[note] ?? ""),
    });
    stream().send({
      path: DAILY,
      change: "written",
      digest: await digestOf(vault.notes[DAILY] ?? ""),
    });
    await settle();
    expect(fetches()).toBe(1);

    // A write nobody pressed for still asks, which is what keeps other writers on screen.
    vault.notes["zz.md"] = "- [ ] hotel";
    stream().send({ path: "zz.md", change: "written", digest: null });
    await settle();
    expect(fetches()).toBe(2);
  });

  it("#947 A4 on a phone, three check-offs keep every other row where it was, one fetch each", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const client = await mount();
    const fetches = countFetches(client);
    const first = order();

    // On a phone the state is a button of its own: the first tap arms it and
    // the second cycles the todo, as the pane's own test of it does.
    for (const [count, name] of [first[0], first[1], first[2]].entries()) {
      const button = screen.getByRole("button", { name: `cycle ${name}` });
      fireEvent.click(button);
      fireEvent.click(button);
      expect(order()).toEqual(first);
      await settle();
      expect(order()).toEqual(first);
      expect(fetches()).toBe(count + 1);
    }
  });

  it("#947 I2 a todo added while the order is held goes to the end of its group, and one removed goes", async () => {
    await mount();
    const first = order();

    press("x");
    await settle();
    vault.notes["b.md"] = `${vault.notes["b.md"] ?? ""}\n- [ ] hotel`;
    stream().send({ path: "b.md", change: "written", digest: null });
    await settle();
    expect(order()).toEqual([...first, "hotel"]);

    // Past the echo's window, so the write to the pressed note is somebody else's.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    vault.notes["a.md"] = (vault.notes["a.md"] ?? "").replace("- [/] charlie\n", "");
    stream().send({ path: "a.md", change: "written", digest: null });
    await settle();
    expect(order()).toEqual([...first.filter((name) => name !== "charlie"), "hotel"]);
  });

  it("#947 I3b a press that lands while a list fetch is in flight draws the list with the press in it", async () => {
    const client = await mount();
    const first = order();

    // An unrelated note's write starts a list fetch, and its answer is held back.
    let release = () => {};
    vault.held = new Promise<void>((resolve) => {
      release = resolve;
    });
    stream().send({ path: "b.md", change: "written", digest: null });
    await settle();
    const fetches = countFetches(client);

    press("x");
    await settle();
    expect(fetches()).toBeLessThanOrEqual(1);

    // The answer that was asked before the press lands last.
    release();
    await settle();
    expect(rowOf(first[0] ?? "")?.querySelector(".line-through")).not.toBeNull();
    expect(order()).toEqual(first);
  });

  it("#947 B1 a press whose later write fails still draws what its first writes changed", async () => {
    await mount();
    const first = order();

    // The todo's own note lands, and the done log in today's note is refused.
    vault.allow = 1;
    press("x");
    await settle();

    expect(screen.getByTestId("notice").textContent).toMatch(
      /^Nothing moved: PUT .+ failed with 500$/,
    );
    expect(rowOf(first[0] ?? "")?.querySelector(".line-through")).not.toBeNull();
  });

  it("#947 B4 an edit with i during a held order leaves the row where it was", async () => {
    await mount();

    press("x");
    await settle();
    press("j");
    press("i");
    const field = screen.getByLabelText("edit line") as HTMLInputElement;
    // Changed words and a priority: the row must land at the top of its group,
    // not at the end of the held order it was edited out of.
    fireEvent.change(field, { target: { value: "- [/] kilo ⏫" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await settle();

    expect(order()[0]).toBe("kilo");
  });

  it("#947 B3 after b during a held order no todo is struck that was not checked off", async () => {
    // A todo that cannot start yet: only the blocker picker lists it.
    vault.notes["b.md"] = `${vault.notes["b.md"] ?? ""}\n- [ ] zulu 🛫 2026-09-01`;
    await mount();

    press("x");
    await settle();
    // `b` picks for an open row, so the cursor moves off the struck one first.
    press("j");
    press("b");
    await settle();
    expect(rowOf("zulu")).toBeDefined();
    press("Escape");
    await settle();

    expect(rowOf("zulu")).toBeUndefined();
  });

  it("#947 B8 @ on a todo whose first word is #agent keeps it in place", async () => {
    vault.notes["a.md"] = [
      "## TODOs",
      "- [/] alpha",
      // Open, since `@` takes its tag back only from an open todo.
      "- [ ] #agent bravo",
      "- [/] charlie",
      "- [/] delta",
    ].join("\n");
    await mount();
    const first = order();

    for (let steps = first.indexOf("bravo"); steps > 0; steps -= 1) press("j");
    press("@");
    await settle();

    expect(order()).toEqual(first);
    expect(document.querySelector('[data-row][tabindex="0"]')?.textContent).toContain("bravo");
  });

  it("#947 B2 @ on a row keeps it in its place and the cursor on it", async () => {
    await mount();
    const first = order();

    press("j");
    press("@");
    await settle();

    expect(order()).toEqual(first);
    expect(document.querySelector('[data-row][tabindex="0"]')?.textContent).toContain(
      first[1] ?? "",
    );
  });

  it("#947 B5 a todo typed into today's note right after a press reaches the pane", async () => {
    await mount();

    press("x");
    await settle();

    // Somebody types into today's note inside the window the press's echo lasts.
    vault.notes[DAILY] = `${vault.notes[DAILY] ?? ""}\n- [ ] kilo`;
    stream().send({
      path: DAILY,
      change: "written",
      digest: await digestOf(vault.notes[DAILY] ?? ""),
    });
    await settle();

    expect(order()).toContain("kilo");
  });

  it("#947 B6 a second press within the echo window still mutes its own echo", async () => {
    const client = await mount();
    const fetches = countFetches(client);

    press("x");
    await settle();
    await advance(2900);

    // A held list answer keeps a third press running, so the echo check comes
    // after the first press's window and while the second press is still open.
    vault.held = new Promise<void>(() => {});
    press("j");
    press("x");
    await settle();
    press("j");
    press("x");
    await settle();
    await advance(200);
    const before = fetches();

    stream().send({
      path: DAILY,
      change: "written",
      digest: await digestOf(vault.notes[DAILY] ?? ""),
    });
    await settle();
    expect(fetches()).toBe(before);
  });

  it("#947 B7 a press on a note with CRLF line endings fetches the list once", async () => {
    // Every note keeps CRLF line endings, as a note written on Windows does.
    for (const path of Object.keys(vault.notes)) {
      vault.notes[path] = (vault.notes[path] ?? "").replace(/\n/g, "\r\n");
    }
    const client = await mount();
    const fetches = countFetches(client);
    const pressed = noteOf(rowOf(order()[0] ?? ""));

    press("x");
    await settle();
    expect(fetches()).toBe(1);

    stream().send({
      path: pressed,
      change: "written",
      digest: await digestOf(vault.notes[pressed] ?? ""),
    });
    stream().send({
      path: DAILY,
      change: "written",
      digest: await digestOf(vault.notes[DAILY] ?? ""),
    });
    await settle();
    expect(fetches()).toBe(1);
  });

  it("#947 I3 a refused press keeps the notice and the row where it was", async () => {
    await mount();
    const first = order();

    vault.refuse = true;
    press("x");
    await settle();
    expect(screen.getByTestId("notice").textContent).toMatch(
      /^Nothing moved: PUT .+ failed with 500$/,
    );
    expect(rowOf(first[0] ?? "")?.querySelector(".line-through")).toBeNull();

    // A later write from elsewhere still shuffles the answer; the refused row stays put.
    vault.refuse = false;
    stream().send({ path: "b.md", change: "written", digest: null });
    await settle();
    expect(order()).toEqual(first);
    expect(screen.getByTestId("notice").textContent).toMatch(/^Nothing moved:/);
  });
});
