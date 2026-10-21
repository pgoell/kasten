import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, act as rtlAct } from "@testing-library/react";
import {
  ChangedOnDisk,
  fetchAssets,
  fetchBook,
  fetchFiles,
  fetchHtml,
  fetchImages,
  fetchNote,
  fetchTodos,
  NoteMissing,
  saveNote,
} from "@/lib/api";
import { resetHeld, unstamped } from "@/lib/held-text";
import { noteBase } from "@/lib/note-base";
import { forgetQueues } from "@/lib/use-autosave";
import { digestOf, type VaultEvent } from "@/lib/vault-events";
import { routeTree } from "@/routeTree.gen";
import { hashed } from "./digests";
import { resetFoliateFake } from "./foliate-fake";

/**
 * The route itself, mounted, because its own lines are what nothing else pins.
 *
 * Every other file here renders one component or one hook, and this project
 * kept falling into the seam that leaves: the pieces each well pinned and the
 * wiring between them not pinned at all. A handful of lines across
 * `routes/index.tsx`, `use-autosave.ts` and `editor.tsx` decide whether a write
 * from outside can take a reader's unsaved text, and whether the two commands
 * that settle a conflict settle it. Every one of them could be reverted with
 * the whole suite green. Each test below kills at least one. Extracting the
 * decisions into pure functions would not have done it, because what survives
 * the mutation is the call and not the callee.
 *
 * So this mounts `Home` over a memory-history router and drives the vault's
 * stream by hand. The two things jsdom does not provide are stood up here
 * rather than in `tests/setup.ts`, this being the only file that wants them:
 * an `EventSource` that delivers exactly when a test says so, and the api
 * module, mocked because there is no backend behind any of it.
 *
 * Timers are faked throughout. The autosave's quiet period would otherwise
 * write in the middle of a test that is about a buffer nobody has written, and
 * a test on this path that fails once a fortnight is a test somebody deletes.
 *
 * Each test file carries the doubles block, because `vi.mock` hoists only in its own file.
 *
 * The doubles, each standing in for what it names:
 *
 * - `beside`: the path the vault answers with, not a fixed one.
 * - `updateNote`: one try over the fakes beside it, so the writes show up.
 * - `fetchTerminals`, `fetchTodos`, `fetchTags`, `fetchImages`, `fetchHtml`, `fetchAssets`: empty answers.
 * - `fetchBook`: a reader's answer, else every reader case sees the error panel.
 * - `fetchVersion`: a release, since the bundle has no commit.
 * - `fetchHistory`, `fetchHistoryText`: the history pane's reads.
 * - `foliate-js/view.js`: empty, so no real View is built over a few bytes.
 * - `pdfPaneRenderer`: the fake the pdf pane draws with, since it takes pdf.js directly.
 * - `paneProps`: the props the route last gave the todo pane.
 * - `outbox`: faked, since fake-indexeddb waits on the frozen timers.
 * - `@/lib/fuzzy`: counted, not replaced.
 * - `file-explorer`: a memo over a counted `buildTree`.
 * - `fetchWeather`: the weather card, with no forecast.
 * - `UPLOAD_LIMIT_BYTES`: left out it is undefined and the size check never fires.
 * - `ChangedOnDisk`: the class the autosave tells a refused save by.
 * - `NoteExists`, `NoteMissing`: the classes the `## Done` log tells a create and a read by.
 */

// A private copy: the test file's `beside` is hoisted with its doubles, out of reach here.
const beside = (note: string, suffix = ".epub") => ({
  path: note.replace(/\.md$/, suffix),
  blob: new Blob(["a book"]),
});

export const VAULT: Record<string, string> = {
  "index.md": "the index note",
  "other.md": "the other note",
};

/**
 * The vault's stream, opened by the route and driven by the test.
 *
 * Only the three members the route uses, which is what a double by hand costs:
 * move the route to `addEventListener` and this one delivers nothing at all,
 * with every test in the file still green over a stream that says nothing. If
 * that day comes, the tests here go on passing and only this class is wrong.
 */
export class FakeEventSource {
  static last: FakeEventSource | undefined;
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  close = vi.fn();

  constructor() {
    FakeEventSource.last = this;
  }

  /** One event, delivered the way the backend writes it, when the test says. */
  send(event: VaultEvent) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}

/** The stream the route opened, which every test drives through. */
export function stream(): FakeEventSource {
  const open = FakeEventSource.last;
  if (!open) throw new Error("The route opened no EventSource");
  return open;
}

/**
 * What somebody else left on disk, by path, which the fake `saveNote` checks a
 * save's base against the way the backend does. Only paths an outside write
 * touched: a save to any other lands as it always has.
 */
export const outside = new Map<string, string>();

/** The running test's signal, which vitest aborts when the test times out. */
let signal: AbortSignal;

/**
 * `act`, let go of when the test it was called in times out.
 *
 * vitest fails a test that runs out of time but cannot stop it, so the body
 * goes on awaiting while the next test starts. React counts how deep in `act`
 * it is in one place for the whole file, and while the orphan sits inside one,
 * every later `render` is queued for an outer `act` that never ends: one
 * timeout became 119 failures over an empty container. Rejecting on the abort
 * takes the orphan out of its `act` before the next test starts. A signal
 * already aborted is a hook after the timeout, which has to run as it is.
 */
export function act(callback: () => void): void;
export function act(callback: () => Promise<void>): Promise<void>;
export function act(callback: () => void | Promise<void>): void | Promise<void> {
  const own = signal;
  return rtlAct(() => {
    const result = callback();
    // A synchronous callback cannot outlive its test, and stays synchronous
    // here so React flushes it before `act` returns, as the call sites expect.
    if (!(result instanceof Promise) || own.aborted) return result;
    const aborted = new Promise<never>((_, reject) => {
      own.addEventListener("abort", () => reject(own.reason), { once: true });
    });
    return Promise.race([result, aborted]);
  });
}

/**
 * Mount the app over a history that is not a browser.
 *
 * The same providers `main.tsx` puts up, but not its `StrictMode`: nothing here
 * exercises an effect run twice, so a mount that double-fires would be a second
 * `EventSource` and a second reload to reason about in every test below.
 */
export async function renderApp(entry = "/") {
  const queryClient = new QueryClient({
    // The app's own settings, because what is being tested is what the app
    // does: a note counted fresh for ten seconds is what makes the event
    // stream's invalidation the only way it is read again.
    defaultOptions: { queries: { retry: false, staleTime: 10_000, refetchOnWindowFocus: false } },
  });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [entry] }),
  });

  // Loaded before it is rendered, because a `RouterProvider` handed a router
  // that has not resolved its route renders nothing at all and every assertion
  // below would be about an empty page.
  await act(async () => {
    await router.load();
  });

  const { container } = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  const editor = () => container.querySelector(".cm-content") as HTMLElement;
  const press = (key: string, init?: KeyboardEventInit) =>
    fireEvent.keyDown(editor(), { key, ...init });

  return {
    press,
    /** A leader key, which is space and then the keys after it, in order. */
    leader: (...keys: string[]) => {
      for (const key of [" ", ...keys]) {
        press(key);
        fireEvent.keyUp(editor(), { key });
      }
    },
    /**
     * Run an ex command, the way a reader types one.
     *
     * `:` opens a panel with an input of its own and moves the focus there, so
     * the rest of the command never reaches `.cm-content`.
     */
    ex: (command: string) => {
      press(":");
      const input = container.querySelector(".cm-vim-panel input") as HTMLInputElement;
      input.value = command;
      fireEvent.keyDown(input, { key: "Enter", keyCode: 13 });
    },
    /** Unfold a folder the way a reader does, by clicking its row. */
    expand: (name: string) =>
      fireEvent.click(
        [...container.querySelectorAll<HTMLElement>("[data-row]")].find(
          (row) => row.textContent === name,
        ) as HTMLElement,
      ),
    /** Open a note the way a reader does, by clicking its row in the tree. */
    click: (path: string) =>
      fireEvent.click(container.querySelector(`[title='${path}']`) as HTMLElement),
    text: () => editor().textContent,
    status: () =>
      container.querySelector("[data-testid='save-status']")?.getAttribute("aria-label"),
    /** How many tabs the strip draws, which is none until there are two. */
    tabs: () => container.querySelectorAll("[role='tab']").length,
    /** Click into another pane, which is a focus and not a click event. */
    focusPane: (index: number) =>
      (container.querySelectorAll<HTMLElement>(".cm-content")[index] as HTMLElement).focus(),
    /** The todo pane, while a pane is holding one. */
    todoPane: () => container.querySelector("[aria-label='Todos']"),
    /** The image pane, while a pane is holding one. */
    imagePane: () => container.querySelector("[data-image-pane]"),
    /** The reader, while a pane is holding one. */
    reader: () => container.querySelector("foliate-view"),
    /** The panel a reader draws instead of a book. */
    alert: () => container.querySelector("[role='alert']"),
    /** The reader's own wrapper, which answers its keys with no book in it too. */
    readerPane: () => container.querySelector("[data-book-pane]") as HTMLElement,
    /** The tree's own panel, which is where its bare keys are pressed. */
    tree: () => container.querySelector("[aria-label='Vault']") as HTMLElement,
    /** The row the tree's cursor is on: the panel's only tab stop. */
    treeCursor: () => container.querySelector<HTMLElement>("[aria-label='Vault'] [tabindex='0']"),
    /** Choose a file in the picker, which is what `userEvent.upload` does. */
    choose: (file: File) => {
      const input = container.querySelector("input[type='file']") as HTMLInputElement;
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      fireEvent.change(input);
    },
    /** The sentence the bar is holding about a failure, or none. */
    notice: () => container.querySelector("[data-testid='notice']")?.textContent ?? null,
    /** The hidden file input `<leader>cb` opens, always mounted. */
    picker: () => container.querySelector("input[type='file']") as HTMLInputElement,
    /** The other one, which `<leader>cm` opens. It is the one taking several. */
    notePicker: () => container.querySelector("input[type='file'][multiple]") as HTMLInputElement,
    /** Choose markdown in it, the way a reader picks one file or a folder full. */
    chooseNotes: (files: File[]) => {
      const input = container.querySelector("input[type='file'][multiple]") as HTMLInputElement;
      Object.defineProperty(input, "files", { value: files, configurable: true });
      fireEvent.change(input);
    },
    /** The prompt's input, while one is open. */
    prompt: () => container.querySelector("input") as HTMLInputElement,
    /** Type a path into the open prompt and take it. */
    fill: (value: string) => {
      const input = container.querySelector("input") as HTMLInputElement;
      fireEvent.change(input, { target: { value } });
      fireEvent.keyDown(input, { key: "Enter" });
    },
    /** Which pane the route is drawing as the focused one, by position. */
    focusedPane: () =>
      [...container.querySelectorAll("[data-pane]")].findIndex((pane) =>
        pane.className.includes("border-one-accent"),
      ),
    /** The row being edited in the pane, as the input it turns into. */
    editedLine: () => container.querySelector("[aria-label='edit line']"),
    /** How many panes the active tab draws. */
    panes: () => container.querySelectorAll("[data-pane]").length,
    /** What the cache holds for a note, which is what the editor reloads off. */
    cached: (of: string) => queryClient.getQueryData<string>(["note", of]),
    /** The bar's list of notes holding text the vault refused, or null. */
    held: () => {
      const item = container.querySelector("[data-testid='held']");
      return item && { label: item.textContent, title: item.getAttribute("title") ?? "" };
    },
    /** The bar's list of notes left while they stood conflicted, or null. */
    heldConflict: () =>
      container.querySelector("[data-testid='held-conflict']")?.textContent ?? null,
    /** The line diff the save detail opens on while the note stands conflicted. */
    diff: () => container.querySelector("[data-testid='conflict-diff']")?.textContent ?? null,
    /** Leave for another route or come back, the way a link does. */
    navigate: (to: "/" | "/capture", note?: string) =>
      act(async () => {
        await (to === "/" && note !== undefined
          ? router.navigate({ to, search: { note } })
          : router.navigate({ to }));
      }),
    /** Whether the bar's reading is wearing the flash a refusal raises. */
    flashing: () =>
      container.querySelector("[data-testid='save-status']")?.className.includes("animate-flash") ??
      false,
  };
}

/**
 * Let every answer in hand reach the tree, without letting the clock move on.
 *
 * TanStack Query notifies its observers on a zero-delay timeout, so a render
 * carrying a query's answer waits on the clock even though the answer does not.
 * Advancing by nothing runs exactly those and leaves the autosave's quiet
 * period where it was, which is what keeps a dirty buffer dirty here.
 *
 * Three rounds, because one starts what the next has to finish: opening a note
 * renders a pane, the pane asks for the note, and that answer needs a trip of
 * its own to arrive.
 */
export async function settle() {
  for (let round = 0; round < 3; round += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

/** Every anchor a download clicked, caught before jsdom tries to follow one. */
export function clicked(): HTMLAnchorElement[] {
  const caught: HTMLAnchorElement[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    caught.push(this);
  });
  return caught;
}

/** The base a save names for `text` on disk: its sha256, `modified` set aside. */
export function baseOf(text: string): Promise<string> {
  return digestOf(unstamped(text));
}

/** The hooks every home-route file registers at top level, before any describe. */
export function pageHooks() {
  beforeEach((context) => {
    signal = context.signal;
    // The write queue is the page's, and each test is a page of its own.
    forgetQueues();
  });

  // Outermost, so it runs after each block's own cleanup, whose unmount flushes
  // can hold text of their own. Held text outlives a mount by design.
  afterEach(() => {
    localStorage.removeItem("kasten.held");
    localStorage.removeItem("kasten.held.2");
    // Each test is a device of its own, or the layout one test left would be
    // the layout the next one starts on.
    localStorage.removeItem("kasten.workspace.1");
    localStorage.removeItem("kasten.workspace.coarse.1");
    // And the cursor each note was left at: a test that opens a note and presses
    // a key at its first line would otherwise press it where another test left.
    localStorage.removeItem("kasten.positions.1");
    resetHeld();
    outside.clear();
  });

  // The route's component is split into a chunk of its own, so the first
  // `router.load()` is where vite transforms `Home` and everything under it. That
  // took 1.4s alone and over 5s under the pre-push hook's load, all of it charged
  // to whichever test mounted first. Loaded here, it is charged to no test.
  beforeAll(async () => {
    const router = createRouter({
      routeTree,
      context: { queryClient: new QueryClient() },
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    await Promise.all(
      Object.values(router.routesById).map((route) => router.loadRouteChunk(route)),
    );
  });
}

/** The hooks of the `the route` block: the fakes, the stream and the page's cleanup. */
export function theRoute() {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    // jsdom lays nothing out and so implements no scrolling, and the router
    // asks for some on every navigation. Nothing here is about where the page
    // sits, so the stub is only to keep the run readable.
    vi.stubGlobal("scrollTo", () => {});
    FakeEventSource.last = undefined;
    vi.mocked(fetchFiles).mockResolvedValue(Object.keys(VAULT));
    vi.mocked(fetchNote).mockImplementation(async (path) => {
      if (path.endsWith("/log.md")) throw new NoteMissing(path);
      return VAULT[path] as string;
    });
    vi.mocked(saveNote).mockImplementation(
      async (path: string, content: string, _keepalive?: boolean, base?: string) => {
        const disk = outside.get(path);
        if (disk !== undefined && base !== undefined && base !== noteBase(disk)) {
          throw new ChangedOnDisk();
        }
        if (disk !== undefined) outside.set(path, content);
        return { path, content };
      },
    );
    // Reset with the rest, because `resetAllMocks` takes the answer above off
    // it and a query function answering undefined is an error rather than an
    // empty list.
    vi.mocked(fetchTodos).mockResolvedValue([]);
    vi.mocked(fetchBook).mockImplementation(async (note: string) => beside(note));
    // Reset with the rest, for the reason `fetchTodos` is: a query function
    // answering undefined is an error rather than an empty list.
    vi.mocked(fetchImages).mockResolvedValue([]);
    vi.mocked(fetchHtml).mockResolvedValue([]);
    vi.mocked(fetchAssets).mockResolvedValue([]);
    resetFoliateFake();
  });

  afterEach(async () => {
    // By hand and first: unmounting flushes what the editor was holding, so
    // the automatic cleanup would reach mocks that have already been reset.
    cleanup();
    // A flush naming a base goes out once its hash lands, a real tick away.
    await hashed();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });
}

/** Open a note and type into it, which is where every test below starts. */
export async function editing() {
  const app = await renderApp();
  await settle();
  app.click("index.md");
  await settle();
  expect(app.text()).toBe("the index note");

  // `x` deletes the character under the cursor, which opens at the top.
  app.press("x");
  expect(app.text()).toBe("he index note");
  return app;
}

/**
 * Somebody else writing the note that is open, the event that says so, and
 * the quiet save after it, which the vault refuses over its base: that
 * refusal is what shows the conflict. The refused call is cleared, so a
 * test's count of writes starts after it.
 */
export function somebodyElseWrote() {
  outside.set("index.md", "somebody else's note");
  act(() => {
    stream().send({ path: "index.md", change: "written", digest: "a".repeat(64) });
    vi.advanceTimersByTime(800);
  });
  vi.mocked(saveNote).mockClear();
}
