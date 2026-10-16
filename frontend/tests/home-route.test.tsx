import { CompletionContext } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, act as rtlAct, screen } from "@testing-library/react";
import { ASSET_LIMIT_BYTES, ChangedOnDisk } from "@/lib/api";
import { readClock } from "@/lib/clock";
import { heldText, holdText, resetHeld, unstamped } from "@/lib/held-text";
import { noteBase } from "@/lib/note-base";
import { ONTOLOGY_NOTE, relationCompletions } from "@/lib/ontology";
import { digestOf, type VaultEvent } from "@/lib/vault-events";
import { routeTree } from "@/routeTree.gen";
import { hashed } from "./digests";
import {
  defineFoliateFake,
  FakeView,
  lastView,
  resetFoliateFake,
  sectionsOf,
  selectIn,
} from "./foliate-fake";
import { COARSE, NARROW, stubMatchMedia } from "./match-media";

defineFoliateFake();

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
 */

const {
  fetchFiles,
  fetchNote,
  saveNote,
  updateNote,
  searchNotes,
  createNote,
  renameNote,
  moveFolder,
  deleteNote,
  fetchTrash,
  restoreEntry,
  fetchTerminals,
  fetchTodos,
  fetchBook,
  uploadAsset,
  fetchImages,
  fetchHtml,
  fetchAssets,
  deleteImage,
  fetchVersion,
  fetchTags,
  captureDump,
  beside,
} = vi.hoisted(() => {
  /**
   * What the vault answers for a note with a file beside it.
   *
   * The path is worked out here because it is the backend that works it out
   * now: it looks for each suffix in turn beside the note and answers with the
   * one it found. Nothing in the app guesses it any more, so a fake handing
   * back a fixed path would let a pane read one note and download another
   * note's book with every case still green.
   */
  const beside = (note: string, suffix = ".epub") => ({
    path: note.replace(/\.md$/, suffix),
    blob: new Blob(["a book"]),
  });

  const fetchNote = vi.fn();
  const saveNote = vi.fn();

  return {
    beside,
    fetchFiles: vi.fn(),
    fetchNote,
    saveNote,
    // One try over the two fakes above, so a writer's read and write show up
    // on them. The retries on a 409 are `update-note.test.ts`'s.
    updateNote: vi.fn(async (path: string, change: (text: string) => string | null) => {
      const text: string = await fetchNote(path);
      const next = change(text);
      return next === null ? null : saveNote(path, next, false, noteBase(text));
    }),
    searchNotes: vi.fn(),
    createNote: vi.fn(),
    renameNote: vi.fn(),
    moveFolder: vi.fn(),
    deleteNote: vi.fn(),
    fetchTrash: vi.fn(),
    restoreEntry: vi.fn(),
    // The terminal prompt asks for these when it opens. No route test opens
    // it, so an empty list is the whole of what this has to answer.
    fetchTerminals: vi.fn().mockResolvedValue([]),
    // The todo pane asks for these the moment it opens. Nothing here is about
    // what the vault holds to do, so an empty list is the whole of the answer.
    fetchTodos: vi.fn().mockResolvedValue([]),
    // A reader mounted by these tests reads this off the factory. Left out, it
    // is undefined, the query throws and every case sees the error panel.
    fetchBook: vi.fn(async (note: string) => beside(note)),
    uploadAsset: vi.fn().mockResolvedValue(undefined),
    // Every note the editor opens asks for these, for the completion inside a
    // `![](`. Nothing here is about images, so an empty list is the whole answer.
    fetchImages: vi.fn().mockResolvedValue([]),
    fetchHtml: vi.fn().mockResolvedValue([]),
    fetchAssets: vi.fn().mockResolvedValue([]),
    // Asked once per mount, for the completion an open `#` offers. Nothing here
    // is about tags, so an empty vocabulary is the whole answer.
    fetchTags: vi.fn().mockResolvedValue([]),
    deleteImage: vi.fn(),
    // The status bar asks for this on every mount. A release, because the bundle
    // these run against carries no commit either.
    fetchVersion: vi.fn().mockResolvedValue("0.8.0"),
    captureDump: vi.fn(),
  };
});
vi.mock("@/lib/api", () => ({
  fetchFiles,
  fetchNote,
  saveNote,
  updateNote,
  searchNotes,
  createNote,
  renameNote,
  moveFolder,
  deleteNote,
  fetchTrash,
  restoreEntry,
  fetchTerminals,
  fetchTodos,
  fetchBook,
  uploadAsset,
  fetchImages,
  fetchHtml,
  fetchAssets,
  deleteImage,
  fetchVersion,
  fetchTags,
  captureDump,
  // A daily note draws the weather card, which asks for the day's forecast.
  fetchWeather: async () => [],
  // Left off the factory this constant arrives in the route as undefined,
  // `file.size > undefined` is false for every file, and the size check never
  // fires while its boundary guard passes vacuously over the break.
  ASSET_LIMIT_BYTES: 100 * 1024 * 1024,
  // The autosave tells a save refused over its base from any other failure
  // by this class, which a factory leaving it out would hand it as undefined.
  ChangedOnDisk: class ChangedOnDisk extends Error {},
}));

// The route imports `BookPane`, which imports foliate for its side effect. With
// the real library these tests build a real `View` over a few bytes of Blob,
// `makeBook` matches none of the formats it knows and throws, and every case
// expecting a reader sees the error panel. The empty factory is deliberate: see
// `book-pane.test.tsx`.
vi.mock("foliate-js/view.js", () => ({}));

const VAULT: Record<string, string> = {
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
class FakeEventSource {
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
function stream(): FakeEventSource {
  const open = FakeEventSource.last;
  if (!open) throw new Error("The route opened no EventSource");
  return open;
}

/**
 * What somebody else left on disk, by path, which the fake `saveNote` checks a
 * save's base against the way the backend does. Only paths an outside write
 * touched: a save to any other lands as it always has.
 */
const outside = new Map<string, string>();

/** The running test's signal, which vitest aborts when the test times out. */
let signal: AbortSignal;

beforeEach((context) => {
  signal = context.signal;
});

// Outermost, so it runs after each block's own cleanup, whose unmount flushes
// can hold text of their own. Held text outlives a mount by design.
afterEach(() => {
  localStorage.removeItem("kasten.held");
  localStorage.removeItem("kasten.held.2");
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
  await Promise.all(Object.values(router.routesById).map((route) => router.loadRouteChunk(route)));
});

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
function act(callback: () => void): void;
function act(callback: () => Promise<void>): Promise<void>;
function act(callback: () => void | Promise<void>): void | Promise<void> {
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
async function renderApp() {
  const queryClient = new QueryClient({
    // The app's own settings, because what is being tested is what the app
    // does: a note counted fresh for ten seconds is what makes the event
    // stream's invalidation the only way it is read again.
    defaultOptions: { queries: { retry: false, staleTime: 10_000, refetchOnWindowFocus: false } },
  });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: ["/"] }),
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
      press(" ");
      for (const key of keys) press(key);
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
    navigate: (to: "/" | "/capture") =>
      act(async () => {
        await router.navigate({ to });
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
async function settle() {
  for (let round = 0; round < 3; round += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

/** Every anchor a download clicked, caught before jsdom tries to follow one. */
function clicked(): HTMLAnchorElement[] {
  const caught: HTMLAnchorElement[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    caught.push(this);
  });
  return caught;
}

/** The base a save names for `text` on disk: its sha256, `modified` set aside. */
function baseOf(text: string): Promise<string> {
  return digestOf(unstamped(text));
}

describe("the route", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    // jsdom lays nothing out and so implements no scrolling, and the router
    // asks for some on every navigation. Nothing here is about where the page
    // sits, so the stub is only to keep the run readable.
    vi.stubGlobal("scrollTo", () => {});
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue(Object.keys(VAULT));
    fetchNote.mockImplementation(async (path: string) => VAULT[path]);
    saveNote.mockImplementation(
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
    fetchTodos.mockResolvedValue([]);
    fetchBook.mockImplementation(async (note: string) => beside(note));
    // Reset with the rest, for the reason `fetchTodos` is: a query function
    // answering undefined is an error rather than an empty list.
    fetchImages.mockResolvedValue([]);
    fetchHtml.mockResolvedValue([]);
    fetchAssets.mockResolvedValue([]);
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

  /** Open a note and type into it, which is where every test below starts. */
  async function editing() {
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
  function somebodyElseWrote() {
    outside.set("index.md", "somebody else's note");
    act(() => {
      stream().send({ path: "index.md", change: "written", digest: "a".repeat(64) });
      vi.advanceTimersByTime(800);
    });
    saveNote.mockClear();
  }

  it("opens the note the tree was clicked on", async () => {
    // The harness's own sanity check. Everything below reads as a mystery if
    // this one is broken, so it is here to fail first and say so.
    const app = await renderApp();
    await settle();

    app.click("index.md");
    await settle();

    expect(app.text()).toBe("the index note");
  });

  it("does not read the note again when the vault writes under text nobody saved", async () => {
    const app = await editing();

    somebodyElseWrote();
    await settle();

    // The note's query is not read again: that is what puts the vault's text in
    // front of the editor, and the buffer is holding words that are nowhere
    // else. The one read since is the bar's, for the diff, outside the cache.
    expect(fetchNote).toHaveBeenCalledTimes(2);
    expect(app.cached("index.md")).toBe("the index note");
    expect(app.text()).toBe("he index note");
    expect(app.status()).toBe("Changed on disk");
  });

  it("marks nothing on an outside write's event, and says changed on disk once the save is refused", async () => {
    const app = await editing();

    act(() => stream().send({ path: "index.md", change: "written", digest: "a".repeat(64) }));
    await settle();
    expect(app.status()).toBe("Unsaved changes");

    saveNote.mockRejectedValueOnce(new ChangedOnDisk());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    await settle();

    expect(saveNote).toHaveBeenCalledWith(
      "index.md",
      "he index note",
      false,
      noteBase("the index note"),
    );
    expect(app.status()).toBe("Changed on disk");
    expect(app.text()).toBe("he index note");
  });

  it("refuses to close a note that changed on disk", async () => {
    const app = await editing();
    somebodyElseWrote();
    await settle();

    app.leader("q");
    await settle();

    expect(saveNote).not.toHaveBeenCalled();
    expect(app.text()).toBe("he index note");
    expect(app.status()).toBe("Changed on disk");
  });

  it("refuses to close a conflicted note's pane and writes nothing", async () => {
    // Two panes, so the key would close a pane and not empty the only one.
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    app.leader("%");
    await settle();
    app.leader("o");
    await settle();
    app.press("x");
    somebodyElseWrote();
    await settle();

    app.leader("q");
    await settle();

    expect(app.panes()).toBe(2);
    expect(saveNote).not.toHaveBeenCalled();
    expect(app.status()).toBe("Changed on disk");
    expect(app.heldConflict()).toBeNull();
  });

  it("refuses to open another note over one that changed on disk", async () => {
    const app = await editing();
    somebodyElseWrote();
    await settle();

    app.click("other.md");
    await settle();

    expect(saveNote).not.toHaveBeenCalled();
    expect(app.text()).toBe("he index note");
  });

  it("keeps text typed while the vault's answer was on its way", async () => {
    const app = await editing();
    // Written and then saved, so the buffer is clean when the event arrives and
    // the read of it goes out. This is the gap the whole mechanism is about.
    app.press("s", { ctrlKey: true });
    await hashed();
    await settle();
    expect(saveNote).toHaveBeenCalledTimes(1);

    let answer: (() => void) | undefined;
    fetchNote.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = () => resolve("somebody else's note");
        }),
    );

    somebodyElseWrote();
    await settle();
    expect(fetchNote).toHaveBeenCalledTimes(2);

    // Typed while that read was in flight, which is the only way a buffer that
    // was clean when the decision was made is dirty when it lands.
    app.press("x");
    answer?.();
    await settle();
    expect(app.text()).toBe("e index note");

    // The quiet save names the reader's own last write as its base, which the
    // vault has moved past.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    await settle();

    expect(app.text()).toBe("e index note");
    expect(app.status()).toBe("Changed on disk");
  });

  it("takes the vault's version on :e!", async () => {
    const app = await editing();
    somebodyElseWrote();
    await settle();
    expect(app.status()).toBe("Changed on disk");

    // The read this answers is the one `:e!` sends. The cache holds neither
    // version by now: the conflict is what stopped the refetch, so what is in
    // there is the text from before the write that caused it.
    fetchNote.mockResolvedValueOnce("somebody else's note");
    app.ex("e!");
    await settle();

    expect(app.text()).toBe("somebody else's note");
    expect(app.status()).toBe("Saved");
    // The other writer's text is what won, so nothing went out.
    expect(saveNote).not.toHaveBeenCalled();
  });

  it("settles a conflict from the status bar, either way, with no key pressed", async () => {
    // What a phone has: no ex prompt, and an editor the tap on the sign blurred.
    const app = await editing();
    somebodyElseWrote();
    await settle();

    // No tap on the sign first: a conflict opens the detail by itself.
    fetchNote.mockResolvedValueOnce("somebody else's text");
    fireEvent.click(screen.getByText("Take the vault's"));
    await settle();

    expect(saveNote).not.toHaveBeenCalled();
    expect(app.text()).toBe("somebody else's text");
    expect(app.status()).toBe("Saved");

    app.press("x");
    somebodyElseWrote();
    await settle();
    fireEvent.click(screen.getByText("Write my text"));
    await settle();

    expect(saveNote).toHaveBeenCalledTimes(1);
    expect(app.status()).toBe("Saved");
  });

  it("does not let a write in flight put back what :e! threw away", async () => {
    const app = await editing();

    // The `PUT` goes out and hangs, which is the window `:e!` has to come
    // through: the read it sends opens a file while this one is writing one and
    // committing it, so the read is the likely one to answer first.
    let written: (() => void) | undefined;
    saveNote.mockImplementationOnce(
      (path: string, content: string) =>
        new Promise((resolve) => {
          written = () => resolve({ path, content });
        }),
    );
    app.ex("w");
    await hashed();
    await settle();
    expect(saveNote).toHaveBeenCalledTimes(1);

    fetchNote.mockResolvedValueOnce("the vault's own text");
    app.ex("e!");
    await settle();
    expect(app.text()).toBe("the vault's own text");

    // The write answers, carrying the text the reader has just discarded. What
    // it must not do is put that text anywhere the editor reads from.
    written?.();
    await settle();

    expect(app.text()).toBe("the vault's own text");
    expect(app.status()).toBe("Saved");
  });

  it("does not keep a failed write's text once :e! has thrown it away", async () => {
    // The same window read the other way. A write that fails holds on to its
    // text so the next keystroke can try again, and after a `:e!` there is no
    // edit left to retry: putting it back would send it to the vault on the
    // next `:w`, which is the loss this command was written to stop.
    const app = await editing();

    let refused: (() => void) | undefined;
    saveNote.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          refused = () => reject(new Error("the vault would not take it"));
        }),
    );
    app.ex("w");
    await hashed();
    await settle();

    fetchNote.mockResolvedValueOnce("the vault's own text");
    app.ex("e!");
    await settle();
    expect(app.text()).toBe("the vault's own text");

    refused?.();
    await settle();

    expect(app.status()).toBe("Saved");
    app.ex("w");
    await settle();
    // The second write is the vault's own text, which `:e!` queues behind the
    // one in the air (#311); `:w` sends nothing more.
    expect(saveNote).toHaveBeenCalledTimes(2);
    expect(saveNote).toHaveBeenLastCalledWith(
      "index.md",
      "the vault's own text",
      false,
      expect.any(String),
    );
  });

  it("reads the bang past a space, and answers no other argument", async () => {
    const app = await editing();

    // A filename is vim's way of opening another note, and this command holds
    // the note its pane holds. So the vault is not read at all: rereading the
    // open note would be the wrong note answering to the right command.
    app.ex("e other.md");
    await settle();
    expect(fetchNote).toHaveBeenCalledTimes(1);
    expect(app.text()).toBe("he index note");

    // The bang survives a trailing space. Losing it there turns the command
    // into the one that declines, and declines without a word.
    app.ex("e! ");
    await settle();
    expect(app.text()).toBe("the index note");
  });

  it("puts the vault's text back on :e! with nobody else writing", async () => {
    // The reader throwing away their own edits, which is what `:e!` is for most
    // of the time. Nothing about the note has changed anywhere, so the query
    // behind it answers with the text it already held and hands the editor
    // nothing new to take: the buffer is put back by the command itself or by
    // nothing at all.
    const app = await editing();

    app.ex("e!");
    await settle();

    expect(app.text()).toBe("the index note");
    expect(app.status()).toBe("Saved");

    // Well past the quiet period, because what was waiting has to be gone
    // rather than merely off the screen.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(saveNote).not.toHaveBeenCalled();
  });

  it("keeps the text and the warning when the vault cannot be read", async () => {
    // The read leads the discard, and this is the whole of why. The other order
    // throws the buffer away on the strength of a request that never lands, and
    // by then the buffer is the only copy of it there is. A note somebody
    // deleted arrives here as the same failure.
    const app = await editing();
    somebodyElseWrote();
    await settle();

    fetchNote.mockRejectedValueOnce(new Error("the vault did not answer"));
    app.ex("e!");
    await settle();

    expect(app.text()).toBe("he index note");
    expect(app.status()).toBe("Changed on disk");
  });

  it("leaves nothing waiting and nothing conflicted behind :e!", async () => {
    const app = await editing();
    somebodyElseWrote();
    await settle();

    fetchNote.mockResolvedValueOnce("somebody else's note");
    app.ex("e!");
    await settle();

    // Nothing waiting: `:w` finds the vault already up to date and sends
    // nothing, rather than sending back the text that was just discarded.
    app.ex("w");
    await settle();
    expect(saveNote).not.toHaveBeenCalled();

    // Nothing conflicted: the keys that were refusing move again. Left set, the
    // note would read `Saved` while every one of them refused for the rest of
    // the session.
    app.leader("c", "t");
    await settle();
    expect(app.tabs()).toBe(2);
  });

  it("refuses :e on a buffer holding unsaved text", async () => {
    // Vim's own rule: `:e` on a modified buffer declines, and only the bang
    // throws the edits away. The vault holds what it always held here, so the
    // only thing a reload could do is take the keystroke off the screen.
    const app = await editing();

    app.ex("e");
    await settle();

    expect(app.text()).toBe("he index note");
    expect(app.status()).toBe("Unsaved changes");
  });

  it("refuses :e while a save is on its way, leaving the screen and the cache alone", async () => {
    // The read `:e` makes fills the cache, and a clean buffer takes what the
    // cache holds: read before the refusal, the vault's older text would land
    // on screen under a write still carrying the newer (#291).
    const app = await editing();
    saveNote.mockImplementationOnce(() => new Promise(() => {}));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    fetchNote.mockClear();

    app.ex("e");
    await settle();

    expect(fetchNote).not.toHaveBeenCalled();
    expect(app.text()).toBe("he index note");
  });

  it("refuses to start a tab while the note stands conflicted", async () => {
    const app = await editing();
    somebodyElseWrote();
    await settle();

    app.leader("c", "t");
    await settle();

    // A new tab moves the focus to the empty pane in it, which moves the note
    // the autosave follows, and the flush that follows would write the buffer
    // over the vault with nobody asked. Every key that moves the focus is the
    // same key from here.
    expect(app.tabs()).toBe(0);
    expect(saveNote).not.toHaveBeenCalled();
    expect(app.status()).toBe("Changed on disk");
    // With a dozen keys declining, a key that does nothing and says nothing
    // reads as a key that is broken.
    expect(app.flashing()).toBe(true);
  });

  it("flashes nothing when nothing was refused", async () => {
    const app = await editing();
    somebodyElseWrote();
    await settle();

    app.leader("c", "t");
    await settle();
    expect(app.flashing()).toBe(true);

    // Once the flash has played it is over, and the class goes with it.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(app.flashing()).toBe(false);

    app.ex("w");
    await settle();

    // A tab and back, which takes the reading off the screen and puts it back:
    // the empty pane in a new tab has no note to say anything about. Nothing
    // was refused on the way, so nothing should flash on the way back.
    app.leader("c", "t");
    await settle();
    expect(app.status()).toBeUndefined();
    app.leader("t", "h");
    await settle();

    expect(app.status()).toBe("Saved");
    expect(app.flashing()).toBe(false);
  });

  it("says the note left for an empty pane was not saved", async () => {
    // The flush on the way out is the only write the note gets, and with no
    // note open the bar's held list is the one place its failure can be read.
    const app = await editing();
    saveNote.mockRejectedValueOnce(new Error("PUT failed with 500"));

    app.leader("c", "t");
    await hashed();
    await settle();

    expect(saveNote).toHaveBeenCalledWith(
      "index.md",
      "he index note",
      false,
      await baseOf("the index note"),
    );
    expect(app.status()).toBeUndefined();
    expect(app.held()?.label).toBe("Not saved: index");
    expect(app.held()?.title).toContain("index.md: PUT failed with 500");
  });

  it("reads a save the vault refused over its base as changed on disk, keeping the text", async () => {
    const app = await editing();
    saveNote.mockRejectedValueOnce(new ChangedOnDisk());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    await hashed();
    await settle();

    expect(app.status()).toBe("Changed on disk");
    expect(app.text()).toBe("he index note");
    expect(app.cached("index.md")).toBe("the index note");
    expect(heldText("index.md")).toMatchObject({ content: "he index note", conflicted: true });
  });

  it("puts the held text back in the buffer when its note is reopened", async () => {
    // A new tab and back: a click in the tree saves first and stays put when
    // that fails, so moving the focus is the way a note is left mid-failure.
    const app = await editing();
    saveNote.mockRejectedValueOnce(new Error("PUT failed with 500"));

    app.leader("c", "t");
    await hashed();
    await settle();
    expect(app.held()?.label).toBe("Not saved: index");
    app.leader("t", "h");
    await settle();

    expect(app.text()).toBe("he index note");
    expect(app.status()).toBe("Could not save");
    // Its own reading speaks for it now, so the list leaves it out.
    expect(app.held()).toBeNull();
    // Opening it wrote nothing: the one call is the failed flush.
    expect(saveNote).toHaveBeenCalledTimes(1);

    app.ex("w");
    await hashed();
    await settle();
    expect(saveNote).toHaveBeenLastCalledWith(
      "index.md",
      "he index note",
      false,
      await baseOf("the index note"),
    );
    expect(app.status()).toBe("Saved");
  });

  it("keeps the held note listed through a save in the other note", async () => {
    const app = await editing();
    saveNote.mockRejectedValueOnce(new Error("PUT failed with 500"));

    app.leader("c", "t");
    await hashed();
    await settle();
    app.click("other.md");
    await settle();
    app.press("x");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    await hashed();
    await settle();

    expect(saveNote).toHaveBeenLastCalledWith(
      "other.md",
      "he other note",
      false,
      await baseOf("the other note"),
    );
    expect(app.status()).toBe("Saved");
    expect(app.held()?.label).toBe("Not saved: index");
  });

  it("keeps the text when leaving the editor route fails to save it, and says so on return", async () => {
    const app = await editing();
    saveNote.mockRejectedValueOnce(new Error("PUT failed with 502"));

    await app.navigate("/capture");
    await hashed();
    await settle();
    expect(saveNote).toHaveBeenCalledWith(
      "index.md",
      "he index note",
      false,
      await baseOf("the index note"),
    );
    await app.navigate("/");
    await settle();

    expect(app.held()?.label).toBe("Not saved: index");
    app.click("index.md");
    await settle();
    expect(app.text()).toBe("he index note");
  });

  it("writes nothing when the editor route is left while the note stands conflicted", async () => {
    const app = await editing();
    somebodyElseWrote();
    await settle();

    await app.navigate("/capture");
    await settle();
    expect(saveNote).not.toHaveBeenCalled();
    await app.navigate("/");
    await settle();

    expect(app.heldConflict()).toBe("Changed on disk: index");
    expect(app.held()).toBeNull();
    expect(heldText("index.md")).toMatchObject({ content: "he index note", conflicted: true });
  });

  it("lists a flush that fails after the note was reopened, and keeps it through a save there", async () => {
    // Back on the route and in the note before the flush answers: the buffer
    // opens on the flush's text (#303), and its failure puts the vault's text
    // back, so the refused text is only held.
    const app = await editing();
    let fail: (() => void) | undefined;
    saveNote.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          fail = () => reject(new Error("PUT failed with 502"));
        }),
    );

    await app.navigate("/capture");
    await hashed();
    await settle();
    await app.navigate("/");
    await settle();
    app.click("index.md");
    await settle();
    expect(app.text()).toBe("he index note");
    await act(async () => fail?.());
    await settle();

    expect(app.text()).toBe("the index note");
    expect(app.held()?.label).toBe("Not saved: index");
    app.press("x");
    app.press("x");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    await hashed();
    await settle();

    expect(saveNote).toHaveBeenLastCalledWith(
      "index.md",
      "e index note",
      false,
      await baseOf("the index note"),
    );
    expect(app.held()?.label).toBe("Not saved: index");
    expect(heldText("index.md")?.content).toBe("he index note");
  });

  it("writes the waiting text with keepalive when the page goes away", async () => {
    await editing();

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    await settle();

    // Naming its base, so a page going away cannot write over somebody else.
    expect(saveNote).toHaveBeenCalledWith(
      "index.md",
      "he index note",
      true,
      noteBase("the index note"),
    );
  });

  /** Text a page before this one held for index.md, as a reload finds it. */
  function heldBeforeReload() {
    holdText("index.md", {
      content: "he index note",
      reason: "Not yet written when the page was hidden",
      conflicted: false,
    });
    resetHeld();
  }

  it("offers text held before a reload in the buffer, with vim off, and the bar's button writes it", async () => {
    localStorage.setItem("kasten.vim", "off");
    try {
      heldBeforeReload();
      const app = await renderApp();
      await settle();
      expect(app.held()?.label).toBe("Not saved: index");
      app.click("index.md");
      await settle();

      expect(document.querySelector(".cm-vimMode")).toBeNull();
      expect(app.text()).toBe("he index note");
      expect(app.status()).toBe("Could not save");
      expect(saveNote).not.toHaveBeenCalled();
      fireEvent.click(screen.getByTestId("save-status"));
      fireEvent.click(screen.getByRole("button", { name: "Write my text" }));
      await hashed();
      await settle();
    } finally {
      localStorage.removeItem("kasten.vim");
    }

    expect(saveNote).toHaveBeenLastCalledWith(
      "index.md",
      "he index note",
      false,
      await baseOf("the index note"),
    );
    expect(heldText("index.md")).toBeUndefined();
  });

  it("drops text held before a reload with the bar's button, with vim off", async () => {
    localStorage.setItem("kasten.vim", "off");
    try {
      heldBeforeReload();
      const app = await renderApp();
      await settle();
      app.click("index.md");
      await settle();
      expect(app.text()).toBe("he index note");

      fireEvent.click(screen.getByTestId("save-status"));
      fireEvent.click(screen.getByRole("button", { name: "Drop my text" }));
      await settle();

      expect(app.text()).toBe("the index note");
      expect(app.status()).toBe("Saved");
    } finally {
      localStorage.removeItem("kasten.vim");
    }

    expect(saveNote).not.toHaveBeenCalled();
    expect(heldText("index.md")).toBeUndefined();
  });

  it("lists a second held text of the open note, and leaves out only the one in the buffer", async () => {
    heldBeforeReload();
    holdText("index.md", {
      content: "the index note!",
      reason: "PUT failed with 502",
      conflicted: false,
    });
    resetHeld();
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();

    expect(app.text()).toBe("he index note");
    expect(app.status()).toBe("Could not save");
    expect(app.held()?.label).toBe("Not saved: index");
    expect(app.held()?.title).toContain("index.md: PUT failed with 502");
    expect(app.held()?.title).not.toContain("hidden");
  });

  it("drops held text the vault already holds when the note is opened", async () => {
    // A keepalive write that landed after the page was gone: the vault's copy
    // differs from what was sent by the stamp alone.
    fetchNote.mockImplementation(async (path: string) =>
      path === "index.md"
        ? "---\nmodified: 2026-10-14T10:00:03+00:00\n---\nhe index note"
        : VAULT[path],
    );
    holdText("index.md", {
      content: "---\nmodified: 2026-10-14T10:00:00+00:00\n---\nhe index note",
      reason: "Not yet written when the page was hidden",
      conflicted: false,
    });
    resetHeld();
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();

    expect(app.status()).toBe("Saved");
    expect(app.held()).toBeNull();
    expect(heldText("index.md")).toBeUndefined();
    expect(saveNote).not.toHaveBeenCalled();
  });

  it("leaves a conflicted note for a click into another pane, and writes nothing", async () => {
    // The one move `moveTo` cannot refuse: the layout hears about it after the
    // browser has moved the focus, so a refusal would be a fight with the
    // browser. Holding the text is what keeps both writers' words instead.
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();

    // Split while the buffer is still clean, there being no way to split once
    // it is not.
    app.leader("%");
    await settle();
    app.leader("o");
    await settle();

    app.press("x");
    expect(app.text()).toBe("he index note");
    somebodyElseWrote();
    await settle();
    expect(app.status()).toBe("Changed on disk");

    app.focusPane(1);
    await settle();

    // The focus moved and the vault keeps the other writer's text. The bar is
    // where the conflict left behind can still be read.
    expect(app.status()).toBeUndefined();
    expect(saveNote).not.toHaveBeenCalled();
    expect(app.heldConflict()).toBe("Changed on disk: index");
    expect(heldText("index.md")).toMatchObject({ content: "he index note", conflicted: true });
  });

  it("keeps the kept text on screen in the pane left behind through another outside write", async () => {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    app.leader("%");
    await settle();
    app.leader("o");
    await settle();
    app.press("x");
    somebodyElseWrote();
    await settle();
    app.focusPane(1);
    await settle();

    fetchNote.mockImplementation(async (path: string) =>
      path === "index.md" ? "a third writer's note" : VAULT[path],
    );
    act(() => stream().send({ path: "index.md", change: "written", digest: "b".repeat(64) }));
    await settle();
    app.focusPane(0);
    await settle();

    expect(app.text()).toBe("he index note");
    expect(app.status()).toBe("Changed on disk");
    expect(app.diff()).toContain("- a third writer's note");
    expect(app.diff()).toContain("+ he index note");
    expect(saveNote).not.toHaveBeenCalled();
  });

  /** Three panes: index.md in the first two, other.md in the third, focus on the first. */
  async function threePanes() {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    app.leader("%");
    await settle();
    app.click("index.md");
    await settle();
    app.leader("%");
    await settle();
    app.click("other.md");
    await settle();
    app.focusPane(0);
    await settle();
    return app;
  }

  /** The text of the editor in the pane at `index`, in the order they are drawn. */
  const paneText = (index: number) => document.querySelectorAll(".cm-content")[index]?.textContent;

  /**
   * The vault's copy of index.md becoming `text`, with the event that says so,
   * and the refusal of a quiet save from a dirty buffer on it (see
   * `somebodyElseWrote`).
   */
  function vaultNow(text: string, digest: string) {
    outside.set("index.md", text);
    fetchNote.mockImplementation(async (path: string) =>
      path === "index.md" ? text : VAULT[path],
    );
    act(() => {
      stream().send({ path: "index.md", change: "written", digest: digest.repeat(64) });
      vi.advanceTimersByTime(800);
    });
    saveNote.mockClear();
  }

  it("lets a pane that never showed the kept text take later outside writes", async () => {
    const app = await threePanes();
    app.press("x");
    vaultNow("version two", "a");
    await settle();
    // Not reloaded: the write is to the focused pane's note, which declines.
    expect(paneText(1)).toBe("the index note");
    app.focusPane(2);
    await settle();
    expect(app.heldConflict()).toBe("Changed on disk: index");

    vaultNow("version three", "b");
    await settle();

    // The first pane shows the kept text and refuses; the second never did.
    expect(paneText(0)).toBe("he index note");
    expect(paneText(1)).toBe("version three");
    app.focusPane(1);
    await settle();
    fireEvent.keyDown(document.querySelectorAll(".cm-content")[1] as HTMLElement, { key: "x" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    await hashed();
    await settle();
    expect(saveNote).toHaveBeenLastCalledWith(
      "index.md",
      "ersion three",
      false,
      await baseOf("version three"),
    );
  });

  it("puts the vault's text back in a pane left showing kept text once the conflict is settled elsewhere", async () => {
    const app = await threePanes();
    app.press("x");
    vaultNow("version two", "a");
    await settle();
    // Left for the third pane, then the note opened there over other.md.
    app.focusPane(2);
    await settle();
    expect(app.heldConflict()).toBe("Changed on disk: index");
    // Read while no pane holds the focus on it, so the cache takes it now and
    // the `:e!` below reads nothing new: no reload reaches the first pane then.
    vaultNow("version three", "b");
    await settle();
    expect(paneText(0)).toBe("he index note");
    app.click("index.md");
    await settle();
    expect(paneText(2)).toBe("he index note");
    expect(app.status()).toBe("Changed on disk");

    // `app.ex` types into the first editor, and this has to be the third.
    fireEvent.keyDown(document.querySelectorAll(".cm-content")[2] as HTMLElement, { key: ":" });
    const input = document.querySelector(".cm-vim-panel input") as HTMLInputElement;
    input.value = "e!";
    fireEvent.keyDown(input, { key: "Enter", keyCode: 13 });
    await settle();
    expect(heldText("index.md")).toBeUndefined();
    expect(paneText(2)).toBe("version three");

    app.focusPane(0);
    await settle();
    expect(paneText(0)).toBe("version three");
    app.press("x");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    await hashed();
    await settle();
    expect(saveNote).toHaveBeenLastCalledWith(
      "index.md",
      "ersion three",
      false,
      await baseOf("version three"),
    );
  });

  it("leaves a conflicted note for another note without writing, and lists it", async () => {
    // Into the other pane first: a click in the tree opens in the focused pane,
    // and over a conflicted note that is refused, as the test above pins.
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    app.leader("%");
    await settle();
    app.leader("o");
    await settle();
    app.press("x");
    somebodyElseWrote();
    await settle();

    app.focusPane(1);
    await settle();
    app.click("other.md");
    await settle();

    expect(app.status()).toBe("Saved");
    expect(saveNote).not.toHaveBeenCalled();
    expect(app.heldConflict()).toBe("Changed on disk: index");
    expect(app.held()).toBeNull();
  });

  /**
   * Leave index.md standing conflicted, the vault now holding `vault`, and come
   * back to it. Leaving the route is the way out with one pane: every key and
   * every click in the tree that would leave the note in place is refused.
   */
  async function reopenedConflicted(vault = "somebody else's note") {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    // Through the view and not `x`, which is no edit with vim off.
    const view = EditorView.findFromDOM(document.querySelector(".cm-editor") as HTMLElement);
    act(() => view?.dispatch({ changes: { from: 0, to: 1 } }));
    expect(app.text()).toBe("he index note");
    somebodyElseWrote();
    await settle();
    await app.navigate("/capture");
    await settle();
    await app.navigate("/");
    await settle();

    fetchNote.mockImplementation(async (path: string) =>
      path === "index.md" ? vault : VAULT[path],
    );
    app.click("index.md");
    await settle();
    return app;
  }

  it("reopens a conflicted note left behind with the diff open and both texts", async () => {
    const app = await reopenedConflicted();

    expect(app.text()).toBe("he index note");
    expect(app.status()).toBe("Changed on disk");
    expect(app.diff()).toContain("- somebody else's note");
    expect(app.diff()).toContain("+ he index note");
    expect(saveNote).not.toHaveBeenCalled();
  });

  it("carries a conflicted note's kept text through a move of the note", async () => {
    // Held text is keyed by path, so a move that left it under the old one
    // would list a note the vault no longer has and never offer the text again.
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    const view = EditorView.findFromDOM(document.querySelector(".cm-editor") as HTMLElement);
    act(() => view?.dispatch({ changes: { from: 0, to: 1 } }));
    somebodyElseWrote();
    await settle();
    await app.navigate("/capture");
    await settle();
    await app.navigate("/");
    await settle();
    expect(heldText("index.md")).toMatchObject({ content: "he index note", conflicted: true });

    renameNote.mockResolvedValue({ path: "moved.md", content: "somebody else's note" });
    fetchFiles.mockResolvedValue(["moved.md", "other.md"]);
    fetchNote.mockImplementation(async (path: string) =>
      path === "moved.md" ? "somebody else's note" : VAULT[path],
    );
    // The tree's cursor opens on its first row, which is index.md.
    app.leader("e");
    await settle();
    fireEvent.keyDown(app.tree(), { key: "r" });
    await settle();
    app.fill("moved.md");
    await settle();

    expect(heldText("index.md")).toBeUndefined();
    expect(app.heldConflict()).toBe("Changed on disk: moved");

    app.click("moved.md");
    await settle();
    expect(app.text()).toBe("he index note");
    expect(app.status()).toBe("Changed on disk");
    expect(saveNote).not.toHaveBeenCalled();
  });

  it("keeps held text through a delete or an agent's move, and offers it when the path is written again", async () => {
    // An agent's move reaches the stream as a remove and a write, the same
    // remove a delete makes, and nothing on it says where the note went.
    holdText("index.md", {
      content: "he index note",
      reason: "PUT failed with 500",
      conflicted: false,
    });
    const app = await renderApp();
    await settle();

    fetchFiles.mockResolvedValue(["moved.md", "other.md"]);
    act(() => stream().send({ path: "index.md", change: "removed", digest: null }));
    act(() => stream().send({ path: "moved.md", change: "written", digest: "a".repeat(64) }));
    await settle();
    expect(app.held()?.label).toBe("Not saved: index");

    fetchFiles.mockResolvedValue(["index.md", "moved.md", "other.md"]);
    fetchNote.mockImplementation(async (path: string) =>
      path === "index.md" ? "a new index note" : VAULT[path],
    );
    act(() => stream().send({ path: "index.md", change: "written", digest: "b".repeat(64) }));
    await settle();
    app.click("index.md");
    await settle();

    expect(app.text()).toBe("he index note");
    expect(saveNote).not.toHaveBeenCalled();
  });

  it("shows the other writer's text in the diff of a conflict raised while the note is open", async () => {
    const app = await editing();
    fetchNote.mockImplementation(async (path: string) =>
      path === "index.md" ? "somebody else's note" : VAULT[path],
    );
    somebodyElseWrote();
    await settle();

    expect(app.status()).toBe("Changed on disk");
    expect(app.text()).toBe("he index note");
    expect(app.diff()).toContain("- somebody else's note");
    expect(app.diff()).toContain("+ he index note");
    expect(saveNote).not.toHaveBeenCalled();
  });

  it("shows the diff against the newest vault text when it changes again during a live conflict", async () => {
    const app = await editing();
    fetchNote.mockImplementation(async (path: string) =>
      path === "index.md" ? "somebody else's note" : VAULT[path],
    );
    somebodyElseWrote();
    await settle();
    expect(app.diff()).toContain("- somebody else's note");

    fetchNote.mockImplementation(async (path: string) =>
      path === "index.md" ? "a third writer's note" : VAULT[path],
    );
    act(() => stream().send({ path: "index.md", change: "written", digest: "b".repeat(64) }));
    await settle();

    expect(app.diff()).toContain("- a third writer's note");
    expect(app.text()).toBe("he index note");
    expect(saveNote).not.toHaveBeenCalled();
  });

  it("clears a live conflict by itself once the vault comes to hold the buffer's text", async () => {
    const app = await editing();
    somebodyElseWrote();
    await settle();
    expect(app.status()).toBe("Changed on disk");

    fetchNote.mockImplementation(async (path: string) =>
      path === "index.md" ? "he index note" : VAULT[path],
    );
    act(() => stream().send({ path: "index.md", change: "written", digest: "b".repeat(64) }));
    await settle();

    expect(app.status()).toBe("Saved");
    expect(app.text()).toBe("he index note");
    expect(app.heldConflict()).toBeNull();
    expect(saveNote).not.toHaveBeenCalled();
  });

  it("keeps mine with :w after reopening a conflicted note", async () => {
    const app = await reopenedConflicted();

    app.ex("w");
    await settle();

    expect(saveNote).toHaveBeenCalledTimes(1);
    expect(saveNote).toHaveBeenLastCalledWith("index.md", "he index note");
    expect(app.status()).toBe("Saved");
    expect(app.diff()).toBeNull();
    expect(app.heldConflict()).toBeNull();
    expect(heldText("index.md")).toBeUndefined();
  });

  it("takes the vault's with :e! after reopening a conflicted note", async () => {
    const app = await reopenedConflicted();

    app.ex("e!");
    await settle();

    expect(saveNote).not.toHaveBeenCalled();
    expect(app.text()).toBe("somebody else's note");
    expect(app.status()).toBe("Saved");
    expect(app.heldConflict()).toBeNull();
    expect(heldText("index.md")).toBeUndefined();
  });

  it("writes an edited merge with :w after reopening a conflicted note", async () => {
    const app = await reopenedConflicted();

    // A merge by hand: the buffer is the reader's, edited toward the vault's.
    app.press("x");
    expect(app.text()).toBe("e index note");
    // The diff follows the buffer, which is what the reader is merging with.
    expect(app.diff()).toContain("+ e index note");
    app.ex("w");
    await settle();

    expect(saveNote).toHaveBeenCalledTimes(1);
    expect(saveNote).toHaveBeenLastCalledWith("index.md", "e index note");
    expect(app.status()).toBe("Saved");
    expect(heldText("index.md")).toBeUndefined();
  });

  it("shows the conflict against the newest vault text when it changed again before the reopen", async () => {
    const app = await editing();
    somebodyElseWrote();
    await settle();
    await app.navigate("/capture");
    await settle();
    await app.navigate("/");
    await settle();

    // Written again, to a note no pane holds now: the stream marks it stale.
    fetchNote.mockImplementation(async (path: string) =>
      path === "index.md" ? "the newest note" : VAULT[path],
    );
    act(() => stream().send({ path: "index.md", change: "written", digest: "b".repeat(64) }));
    await settle();
    app.click("index.md");
    await settle();

    expect(app.text()).toBe("he index note");
    expect(app.status()).toBe("Changed on disk");
    expect(app.diff()).toContain("- the newest note");
    expect(app.diff()).toContain("+ he index note");
    expect(saveNote).not.toHaveBeenCalled();
  });

  it("clears the conflict on reopen when the vault came to hold the kept text", async () => {
    const app = await reopenedConflicted("he index note");

    expect(app.text()).toBe("he index note");
    expect(app.status()).toBe("Saved");
    expect(app.diff()).toBeNull();
    expect(app.heldConflict()).toBeNull();
    expect(heldText("index.md")).toBeUndefined();
    expect(saveNote).not.toHaveBeenCalled();
  });

  it("settles a reopened conflict with the bar's buttons, with vim off", async () => {
    // No ex prompt with vim off: the two buttons under the diff are the way out.
    localStorage.setItem("kasten.vim", "off");
    try {
      const app = await reopenedConflicted();
      expect(document.querySelector(".cm-vimMode")).toBeNull();
      expect(app.diff()).toContain("- somebody else's note");

      fireEvent.click(screen.getByRole("button", { name: "Write my text" }));
      await settle();

      expect(saveNote).toHaveBeenLastCalledWith("index.md", "he index note");
      expect(app.status()).toBe("Saved");
      expect(heldText("index.md")).toBeUndefined();
    } finally {
      localStorage.removeItem("kasten.vim");
    }
  });

  it("takes the vault's text for a reopened conflict with the bar's button, with vim off", async () => {
    localStorage.setItem("kasten.vim", "off");
    try {
      const app = await reopenedConflicted();

      fireEvent.click(screen.getByRole("button", { name: "Take the vault's" }));
      await settle();

      expect(app.text()).toBe("somebody else's note");
      expect(app.status()).toBe("Saved");
      expect(heldText("index.md")).toBeUndefined();
    } finally {
      localStorage.removeItem("kasten.vim");
    }
    expect(saveNote).not.toHaveBeenCalled();
  });

  it("writes what is waiting before it swaps two panes", async () => {
    // A swap between two splits builds the editor again from the vault's copy,
    // and nothing else flushes it: the autosave follows the focused pane's
    // note and this leaves that note exactly where it was. Without the write,
    // the character deleted a moment ago comes back on screen.
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();

    app.leader("%");
    await settle();
    // Back to the pane holding the note, which the split left behind. `o`
    // wraps and needs no boxes, unlike the four directions.
    app.leader("o");
    await settle();

    app.press("x");
    expect(app.text()).toBe("he index note");

    // jsdom measures nothing, so the boxes a direction is answered off have to
    // be stood in for: the two panes side by side, in the order they are drawn.
    const boxes = [...document.querySelectorAll("[data-pane]")];
    boxes.forEach((box, index) => {
      box.getBoundingClientRect = () =>
        ({ left: index * 100, top: 0, right: index * 100 + 99, bottom: 100 }) as DOMRect;
    });

    app.leader("L");
    await hashed();
    await settle();

    expect(saveNote).toHaveBeenCalledWith(
      "index.md",
      "he index note",
      false,
      await baseOf("the index note"),
    );
    // And the panes did trade places: the focus is where it was, on the note,
    // which is now the second pane on screen.
    expect(app.focusedPane()).toBe(1);
  });

  it("starts the tab once :w has settled the conflict", async () => {
    const app = await editing();
    somebodyElseWrote();
    await settle();

    app.ex("w");
    await settle();
    expect(saveNote).toHaveBeenCalledTimes(1);

    app.leader("c", "t");
    await settle();

    expect(app.tabs()).toBe(2);
  });

  it("puts the cursor in the editor when a note is opened from the file tree", async () => {
    // The tree holds the focus while its own keys are being pressed, and the
    // editor takes the focus on mount only when nothing else holds it. Without
    // the focus being raised with the note, the note arrives on screen and
    // every key after it goes on reaching the tree.
    const app = await renderApp();
    await settle();

    const row = document.querySelector("[title='other.md']") as HTMLElement;
    row.focus();
    expect(document.activeElement).toBe(row);

    app.click("other.md");
    await settle();

    expect(document.activeElement?.className).toContain("cm-content");
    expect(app.text()).toBe("the other note");
  });

  it("makes today's daily note with its links and opens it", async () => {
    // The body goes into the `POST` that makes the note, so a periodic note
    // costs one write. `periodic.test.ts` pins what that body says for every
    // other grain.
    vi.setSystemTime(new Date(2026, 7, 6, 9, 30));
    const path = "01 Periodic/00 Daily/2026-08-06.md";
    const body =
      "---\ntype: Periodic Note\n---\n\n# 2026-08-06 Thursday\n\n" +
      "[[01 Periodic/00 Daily/2026-08-05]] | [[01 Periodic/01 Weekly/2026-W32]] |" +
      " [[01 Periodic/00 Daily/2026-08-07]]\n" +
      // The one section a fresh note is made with. The add prompt writes here,
      // and `## Done` and `## Time` appear when there is something to put in them.
      "\n## TODOs\n";
    createNote.mockResolvedValue({ path, content: `---\nid: one\n---\n${body}` });

    const app = await renderApp();
    await settle();

    app.leader("g", "d");
    await settle();

    expect(createNote).toHaveBeenCalledWith(path, body);
    // The second write is what the reader's own editor used to read as another
    // writer: it lands on `/api/events` a moment after the note is opened, and
    // anything typed by then is unsaved text over a note that changed on disk.
    expect(saveNote).not.toHaveBeenCalled();
    expect(app.text()).toContain("2026-08-06 Thursday");
  });

  // Through the key rather than over `periodicNote`, because the fence has to
  // be the file's first line: the backend reads a block only where the fence
  // opens the text, so a caller prepending a newline would leave `type` sitting
  // in the body as prose with the template's own test still green.
  it.each([
    ["daily", ["g", "d"], "01 Periodic/00 Daily/2026-08-06.md"],
    ["weekly", ["g", "w"], "01 Periodic/01 Weekly/2026-W32.md"],
    ["monthly", ["g", "m"], "01 Periodic/02 Monthly/2026-08.md"],
    ["quarterly", ["g", "q"], "01 Periodic/03 Quarterly/2026-Q3.md"],
    ["yearly", ["g", "y"], "01 Periodic/04 Yearly/2026.md"],
  ] as [string, string[], string][])(
    "opens the %s note with a block saying it is periodic",
    async (_period, keys, path) => {
      vi.setSystemTime(new Date(2026, 7, 6, 9, 30));
      createNote.mockResolvedValue({ path, content: "" });

      const app = await renderApp();
      await settle();

      app.leader(...keys);
      await settle();

      const [written, body] = createNote.mock.calls[0] as [string, string];
      expect(written).toBe(path);
      expect(body.split("\n").slice(0, 3)).toEqual(["---", "type: Periodic Note", "---"]);
    },
  );

  it("moves the open note into the trash and empties the pane", async () => {
    deleteNote.mockResolvedValue({
      entry: "index.md@2026-08-11T14-03-02.481337",
      path: "index.md",
      deleted: "2026-08-11T14:03:02Z",
    });
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();

    app.leader("d", "f");
    await settle();

    expect(deleteNote).toHaveBeenCalledWith("index.md");
    // The pane is empty, so nothing on screen is holding a note that is gone,
    // and the listing is asked for again.
    expect(app.text()).toBe("");
    expect(fetchFiles.mock.calls.length).toBeGreaterThan(1);
  });

  it("writes what is waiting before it deletes the note", async () => {
    // The trash holds what was on disk, so the text typed a moment ago has to
    // be on disk before the note moves into it.
    deleteNote.mockResolvedValue({
      entry: "index.md@2026-08-11T14-03-02.481337",
      path: "index.md",
      deleted: "2026-08-11T14:03:02Z",
    });
    const app = await editing();

    app.leader("d", "f");
    await hashed();
    await settle();

    expect(saveNote).toHaveBeenCalledWith(
      "index.md",
      "he index note",
      false,
      await baseOf("the index note"),
    );
    // A call that never happened has no order, and `0` is below every real one,
    // so a delete that skipped the save fails here rather than passing empty.
    expect(saveNote.mock.invocationCallOrder[0]).toBeLessThan(
      deleteNote.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("refuses to delete a note that changed on disk", async () => {
    const app = await editing();
    somebodyElseWrote();
    await settle();

    app.leader("d", "f");
    await settle();

    expect(deleteNote).not.toHaveBeenCalled();
    expect(app.status()).toBe("Changed on disk");
  });

  it("puts the last deleted note back and opens it", async () => {
    fetchTrash.mockResolvedValue([
      {
        entry: "other.md@2026-08-11T14-03-02.481337",
        path: "other.md",
        deleted: "2026-08-11T14:03:02Z",
      },
    ]);
    restoreEntry.mockResolvedValue("other.md");
    const app = await renderApp();
    await settle();

    app.leader("d", "u");
    await settle();

    expect(restoreEntry).toHaveBeenCalledWith("other.md@2026-08-11T14-03-02.481337");
    expect(app.text()).toBe("the other note");
  });

  it("flashes the bar when the trash has nothing to put back", async () => {
    fetchTrash.mockResolvedValue([]);
    const app = await renderApp();
    await settle();
    // With a note open, because the bar is what a refusal is seen in and an
    // empty pane draws no reading at all.
    app.click("index.md");
    await settle();

    app.leader("d", "u");
    await settle();

    expect(restoreEntry).not.toHaveBeenCalled();
    expect(app.flashing()).toBe(true);
  });

  it("puts the todo list in the focused pane and takes it back out", async () => {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();

    app.leader("g", "t");
    await settle();
    expect(app.todoPane()).not.toBeNull();

    // Emptying rather than removing: the pane stays on screen, so a window
    // holding only the list still has a way back to an editor.
    fireEvent.keyDown(app.todoPane() as HTMLElement, { key: " " });
    fireEvent.keyDown(app.todoPane() as HTMLElement, { key: "q" });
    await settle();

    expect(app.todoPane()).toBeNull();
    expect(app.panes()).toBe(1);
  });

  it("edits a todo from the pane, and leaves the keys where the cursor is", async () => {
    const note = ["# Kasten", "", "- [ ] call the dentist 🆔 kt-3f9a2c"].join("\n");
    fetchFiles.mockResolvedValue([...Object.keys(VAULT), "projects/kasten.md"]);
    fetchNote.mockImplementation(async (path: string) => VAULT[path] ?? note);
    const row = {
      path: "projects/kasten.md",
      line: 3,
      text: "- [ ] call the dentist 🆔 kt-3f9a2c",
    };
    const edited = "- [ ] call the dentist ⏳ 2026-08-11 🆔 kt-3f9a2c";
    // What the vault answers once the write has landed, which is what moves the
    // row out of No date and into This week, and so out of the DOM node the
    // prompt took the focus from.
    fetchTodos.mockImplementation(async () =>
      saveNote.mock.calls.length > 0 ? [{ ...row, text: edited }] : [row],
    );

    const app = await renderApp();
    await settle();
    app.leader("g", "t");
    await settle();

    // Focused first, the way a pane you are pressing keys into is: the pane
    // hands the keys back only where they were already its.
    (app.todoPane() as HTMLElement).focus();
    fireEvent.keyDown(app.todoPane() as HTMLElement, { key: "i" });
    const field = app.editedLine() as HTMLInputElement;
    // The line as the vault holds it, which is what makes `⏳` reachable: no
    // shorthand spells a scheduled date.
    expect(field.value).toBe("- [ ] call the dentist 🆔 kt-3f9a2c");

    fireEvent.change(field, { target: { value: edited } });
    fireEvent.keyDown(field, { key: "Enter" });
    await settle();

    expect(saveNote).toHaveBeenCalledWith(
      "projects/kasten.md",
      ["# Kasten", "", edited].join("\n"),
      false,
      expect.any(String),
    );
    // The row the input replaced is gone, redrawn under another heading by the
    // write, so the focus handed back to it landed on the body and the pane was
    // deaf to every key after it.
    expect(app.todoPane()?.contains(document.activeElement)).toBe(true);
  });

  it("opens the daily note the vault already holds without writing to it", async () => {
    vi.setSystemTime(new Date(2026, 7, 6, 9, 30));
    const path = "01 Periodic/00 Daily/2026-08-06.md";
    fetchFiles.mockResolvedValue([...Object.keys(VAULT), path]);
    fetchNote.mockImplementation(async () => "# 2026-08-06 Thursday");

    const app = await renderApp();
    await settle();

    app.leader("g", "d");
    await settle();

    expect(createNote).not.toHaveBeenCalled();
    expect(saveNote).not.toHaveBeenCalled();
    expect(app.text()).toContain("2026-08-06 Thursday");
  });

  it("opens the note's book in a pane beside it", async () => {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();

    app.leader("g", "r");
    await settle();

    expect(app.panes()).toBe(2);
    expect(app.reader()).not.toBeNull();
    // The note is still on screen. A key called "read this book beside this
    // note" must not eat the note.
    expect(app.text()).toContain("the index note");
  });

  it("does nothing with no note in the focused pane", async () => {
    // Passes before the binding exists, an unbound key doing nothing, so this
    // is a guard against a later regression rather than a red step.
    const app = await renderApp();
    await settle();

    app.leader("g", "r");
    await settle();

    expect(app.panes()).toBe(1);
    expect(app.reader()).toBeNull();
  });

  it("hands the file in the focused pane to the browser under the name the vault gave it", async () => {
    // A pdf beside the note, so a swapped suffix and the vault's own answer
    // are two different strings. The pane holds the note's path and nothing
    // else, and the file's name is the answer's to give.
    fetchBook.mockImplementation(async (note: string) => beside(note, ".pdf"));
    const caught = clicked();
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    app.leader("g", "r");
    await settle();

    // The reader's own bare key, this pane having no leader. Dispatched on the
    // view so it bubbles to the wrapper's native listener.
    fireEvent.keyDown(app.reader() as Element, { key: "w" });
    await settle();

    expect(caught[0]?.download).toBe("index.pdf");
    // The address that already serves the file, and no blob: the bytes are on
    // disk, not in the page.
    expect(caught[0]?.getAttribute("href")).toBe("/api/assets/index.pdf");
  });

  it("hands nothing over where the reader has not been told what is beside the note", async () => {
    // The reader showing "nothing to read beside", which is the same case as a
    // fetch that has not landed: there is no file to name, and a guess would
    // hand the browser a 404 under a name nobody chose.
    const caught = clicked();
    fetchBook.mockRejectedValue(new Error("GET /api/books/index.md failed with 404"));
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    app.leader("g", "r");
    await settle();

    // On the wrapper rather than on the view, there being no view: the effect
    // opens nothing while the query has answered with an error.
    fireEvent.keyDown(app.readerPane(), { key: "w" });
    await settle();

    expect(caught).toEqual([]);
  });

  it("takes the reader out of its pane and leaves the note pane alone", async () => {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    app.leader("g", "r");
    await settle();
    // Emptying rather than removing, the way a terminal and the todo list are
    // taken out. Without `pane.book` on that branch the key removes the pane.
    app.leader("q");
    await settle();

    expect(app.reader()).toBeNull();
    expect(app.panes()).toBe(2);
    expect(app.text()).toContain("the index note");
  });

  it("closes the pane the focus is in rather than the reader it came from", async () => {
    // Closing acts on the pane the focus is in, not on the reader it came from.
    //
    // The plan filed this as the case pinning `pane.book` in the commands memo.
    // It is not: `movePane` carries `pane.id`, so the memo already recomputes on
    // every move of the focus, and the suite stays green with `pane.book` taken
    // out of the list. What keeps it there is biome's `useExhaustiveDependencies`,
    // which the memo body's read of `pane.book` makes an error to omit.
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    app.leader("g", "r");
    await settle();
    app.leader("%");
    await settle();
    expect(app.panes()).toBe(3);

    app.leader("q");
    await settle();

    expect(app.panes()).toBe(2);
    expect(app.reader()).not.toBeNull();
  });

  it("moves the focus to the reader when a click lands inside the book", async () => {
    // The pane emits the call and the frame test proves it does, but that test
    // mounts no route. Without this a route passing a no-op, or the wrong pane
    // id, keeps every other test green.
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    app.leader("g", "r");
    await settle();
    act(() => lastView().emitLoad());
    app.leader("o");
    await settle();
    expect(app.focusedPane()).toBe(0);

    await act(async () => {
      lastView().section.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });

    expect(app.focusedPane()).toBe(1);
  });

  describe("in a narrow window", () => {
    /** The panes the tab is drawing, as opposed to the ones it only holds. */
    const drawn = () =>
      [...document.querySelectorAll("[data-pane]")].filter(
        (pane) => !pane.classList.contains("hidden"),
      );

    it("starts with the tree shut, and shuts it again on the note a tap opens", async () => {
      stubMatchMedia({ [NARROW]: true, [COARSE]: true });
      const app = await renderApp();
      await settle();

      expect(app.tree()).toBeNull();
      // No rail on a phone, the toolbar being the way to the drawer.
      expect(screen.queryByRole("button", { name: "Show file tree" })).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "File tree" }));
      app.click("index.md");
      await settle();

      expect(app.text()).toBe("the index note");
      expect(app.tree()).toBeNull();
    });

    it("shows the diff and the buttons on a phone", async () => {
      stubMatchMedia({ [NARROW]: true, [COARSE]: true });
      const app = await renderApp();
      await settle();
      fireEvent.click(screen.getByRole("button", { name: "File tree" }));
      app.click("index.md");
      await settle();
      const view = EditorView.findFromDOM(document.querySelector(".cm-editor") as HTMLElement);
      act(() => view?.dispatch({ changes: { from: 0, to: 1 } }));
      somebodyElseWrote();
      await settle();
      await app.navigate("/capture");
      await settle();
      await app.navigate("/");
      await settle();

      fetchNote.mockImplementation(async (path: string) =>
        path === "index.md" ? "somebody else's note" : VAULT[path],
      );
      fireEvent.click(screen.getByRole("button", { name: "File tree" }));
      app.click("index.md");
      await settle();

      expect(app.diff()).toContain("- somebody else's note");
      expect(app.diff()).toContain("+ he index note");
      // Under the part that scrolls, not in it: a long diff on a small screen
      // would otherwise carry the only way out off the top of the panel.
      const scroller = screen.getByTestId("conflict-diff").closest(".overflow-y-auto");
      expect(scroller).not.toBeNull();
      for (const name of ["Write my text", "Take the vault's"]) {
        expect(scroller?.contains(screen.getByRole("button", { name }))).toBe(false);
      }
      expect(saveNote).not.toHaveBeenCalled();
    });

    /** The column holding the panes, which an open drawer puts out of reach. */
    const page = () =>
      document.querySelector("[role='tablist'], [data-pane]")?.closest("[inert]") ?? null;
    // The toolbar's button on a phone, and the rail's where a mouse keeps one.
    const openDrawer = () => fireEvent.click(screen.getByRole("button", { name: /File tree$/i }));

    it("closes the drawer on Escape and puts the focus in the pane on screen", async () => {
      // Narrow and no more, the split below being asked for with a leader key.
      stubMatchMedia({ [NARROW]: true });
      const app = await renderApp();
      await settle();
      // Two panes with the second focused, so the first editor in the document
      // is one that is not drawn.
      app.leader("%");
      await settle();

      openDrawer();
      expect(page()).not.toBeNull();
      app.treeCursor()?.focus();
      fireEvent.keyDown(app.tree(), { key: "Escape" });
      await settle();

      expect(app.tree()).toBeNull();
      expect(page()).toBeNull();
      expect(drawn()[0]?.contains(document.activeElement)).toBe(true);
    });

    it("closes the drawer on the note its New note button makes", async () => {
      stubMatchMedia({ [NARROW]: true, [COARSE]: true });
      createNote.mockResolvedValue({ path: "fresh.md", content: "" });
      const app = await renderApp();
      await settle();

      openDrawer();
      fireEvent.click(screen.getByRole("button", { name: "New note" }));
      await settle();
      app.fill("fresh");
      await settle();

      expect(createNote).toHaveBeenCalled();
      expect(app.tree()).toBeNull();
    });

    it("closes the drawer on the note the finder opens from the tree", async () => {
      stubMatchMedia({ [NARROW]: true, [COARSE]: true });
      const app = await renderApp();
      await settle();

      openDrawer();
      fireEvent.keyDown(app.tree(), { key: "f" });
      await settle();
      // Still open under the finder, so Escape there lands back in the tree.
      expect(app.tree()).not.toBeNull();
      fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
      await settle();

      expect(screen.queryByRole("dialog", { name: "Find note" })).toBeNull();
      expect(app.tree()).toBeNull();
    });

    it("closes the tree when the window turns narrow under it", async () => {
      const media = stubMatchMedia();
      const app = await renderApp();
      await settle();
      expect(app.tree()).not.toBeNull();

      media.set(NARROW, true);

      expect(app.tree()).toBeNull();
      expect(screen.queryByRole("button", { name: "Close file tree" })).toBeNull();
    });

    it("draws the focused pane alone, and gives the split back when the window widens", async () => {
      // Narrow and no more: the split is asked for with a leader key, which a
      // touch screen may not have, and one pane to a tab is about the width.
      const media = stubMatchMedia({ [NARROW]: true });
      const app = await renderApp();
      await settle();

      app.leader("%");
      await settle();

      expect(app.panes()).toBe(2);
      expect(drawn()).toHaveLength(1);
      const first = drawn()[0];

      app.leader("o");
      await settle();

      expect(drawn()).toHaveLength(1);
      expect(drawn()[0]).not.toBe(first);

      media.set(NARROW, false);

      expect(drawn()).toHaveLength(2);
    });

    it("draws the toolbar on a phone and nowhere else", async () => {
      const toolbar = () => screen.queryByRole("toolbar", { name: "Commands" });
      const media = stubMatchMedia();
      await renderApp();
      await settle();
      expect(toolbar()).toBeNull();

      // A narrow window under a mouse keeps its keys, and its rail.
      media.set(NARROW, true);
      expect(toolbar()).toBeNull();
      expect(screen.getByRole("button", { name: "Show file tree" })).toBeInTheDocument();

      media.set(COARSE, true);
      expect(toolbar()).not.toBeNull();
      // One pane, so nowhere to move to.
      expect(screen.queryByRole("button", { name: "Move to the next pane" })).toBeNull();

      // A tablet: a finger, and room for the panel beside the note.
      media.set(NARROW, false);
      expect(toolbar()).toBeNull();
    });

    /** A press and release on the sheet around a panel, which is its way out. */
    const tapSheet = (sheet: HTMLElement) => {
      fireEvent.mouseDown(sheet);
      fireEvent.mouseUp(sheet);
      fireEvent.click(sheet);
    };

    it("opens the palette, the finder and the search from the toolbar", async () => {
      stubMatchMedia({ [NARROW]: true, [COARSE]: true });
      await renderApp();
      await settle();

      fireEvent.click(screen.getByRole("button", { name: "Run a command by name" }));
      const palette = screen.getByRole("dialog", { name: "Run a command" });
      // The way to vim's keys on a phone, which no key reaches with vim off.
      expect(screen.getByRole("option", { name: "Toggle vim keys" })).toBeInTheDocument();
      tapSheet(palette);
      expect(screen.queryByRole("dialog")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Find a note" }));
      tapSheet(screen.getByRole("dialog", { name: "Find note" }));
      expect(screen.queryByRole("dialog")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Search note content" }));
      tapSheet(screen.getByRole("dialog"));
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("makes room in the frame for a keyboard that covers the page", async () => {
      const listeners = new Map<string, () => void>();
      const viewport = {
        scale: 1,
        offsetTop: 0,
        height: 800,
        addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
        removeEventListener: (type: string) => listeners.delete(type),
      };
      vi.stubGlobal("visualViewport", viewport);
      const box = vi
        .spyOn(HTMLElement.prototype, "getBoundingClientRect")
        .mockReturnValue({ bottom: 800 } as DOMRect);
      const layout = vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(800);
      stubMatchMedia({ [NARROW]: true, [COARSE]: true });
      await renderApp();
      await settle();
      const frame = screen.getByRole("main");

      viewport.height = 500;
      listeners.get("resize")?.();

      // The bar and the toolbar sit inside the frame, so both rise with it.
      expect(frame.style.paddingBottom).toBe("300px");
      expect(frame).toContainElement(screen.getByRole("contentinfo"));
      expect(frame).toContainElement(screen.getByRole("toolbar", { name: "Commands" }));
      box.mockRestore();
      layout.mockRestore();
    });

    it("counts the panes in the bar, which is the only sign of a split", async () => {
      // Narrow and no more: the split is asked for with a leader key, which a
      // touch screen may not have, and one pane to a tab is about the width.
      const media = stubMatchMedia({ [NARROW]: true });
      const app = await renderApp();
      await settle();
      expect(screen.queryByTestId("pane-shown")).toBeNull();

      app.leader("%");
      await settle();
      expect(screen.getByTestId("pane-shown")).toHaveTextContent("pane 2/2");

      app.leader("o");
      await settle();
      expect(screen.getByTestId("pane-shown")).toHaveTextContent("pane 1/2");

      // Both are on screen in a wide window, and count themselves.
      media.set(NARROW, false);
      expect(screen.queryByTestId("pane-shown")).toBeNull();
    });

    it("takes the status bar out of reach under the drawer", async () => {
      stubMatchMedia({ [NARROW]: true, [COARSE]: true });
      await renderApp();
      await settle();
      expect(screen.getByRole("contentinfo")).not.toHaveAttribute("inert");

      openDrawer();

      expect(screen.getByRole("contentinfo")).toHaveAttribute("inert");
    });
  });
});

describe("a reader when the vault moves under it", () => {
  const LIT = "20 Literature/DDIA.md";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue([LIT, "index.md"]);
    fetchNote.mockResolvedValue("# DDIA");
    saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    fetchTodos.mockResolvedValue([]);
    fetchBook.mockImplementation(async (note: string) => beside(note));
    resetFoliateFake();
  });

  afterEach(async () => {
    cleanup();
    // A flush naming a base goes out once its hash lands, which must be
    // inside this test and not the next one.
    await hashed();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  /** Open the literature note and its book beside it. */
  async function reading() {
    const app = await renderApp();
    await settle();
    // The tree opens folded, so the note's row is not drawn until its folder is.
    app.expand("20 Literature");
    await settle();
    app.click(LIT);
    await settle();
    app.leader("g", "r");
    await settle();
    expect(app.reader()).not.toBeNull();
    return app;
  }

  /** Rename the folder the tree's cursor starts on, which is the literature one. */
  async function renameFolder(app: Awaited<ReturnType<typeof reading>>, to: string) {
    app.leader("e");
    await settle();
    fireEvent.keyDown(app.tree(), { key: "r" });
    await settle();
    app.fill(to);
    await settle();
  }

  it("reveals the note the reader is reading", async () => {
    // `openPath` is what the tree is told the focused pane holds, and a reader
    // holds `pane.book` rather than `pane.path`. Without that arm `<leader>E`
    // does nothing in the one pane where you least know where you are.
    const app = await reading();
    // Clicking a row does not move the tree cursor, so it is still on the
    // folder the tree opened on.
    expect(app.treeCursor()?.textContent).toBe("20 Literature");

    app.leader("E");
    await settle();

    expect(app.treeCursor()).toHaveAttribute("title", LIT);
  });

  it("follows the note when its folder moves", async () => {
    const app = await reading();
    expect(fetchBook).toHaveBeenCalledWith("20 Literature/DDIA.md");
    moveFolder.mockResolvedValue({ path: "Literature" });
    fetchFiles.mockResolvedValue(["Literature/DDIA.md", "index.md"]);

    await renameFolder(app, "Literature");

    expect(fetchBook).toHaveBeenCalledWith("Literature/DDIA.md");
    // The moved note and its book are both fresh queries, and the clock has to
    // run for their answers rather than only the microtasks `settle` flushes.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(app.reader()).not.toBeNull();
    expect(app.alert()).toBeNull();
  });

  it("leaves every other reader where it was", async () => {
    // `noteAfterPrompt` answers undefined for a pane the move did not touch, so
    // assigning its result straight to `book` would empty every reader in the
    // window whenever any folder moved.
    fetchFiles.mockResolvedValue([LIT, "elsewhere/note.md", "index.md"]);
    const app = await reading();
    // Folded again, so the row under the cursor's first step is the other
    // folder rather than the note inside this one.
    app.expand("20 Literature");
    await settle();
    moveFolder.mockResolvedValue({ path: "somewhere" });

    app.leader("e");
    await settle();
    fireEvent.keyDown(app.tree(), { key: "j" });
    fireEvent.keyDown(app.tree(), { key: "r" });
    await settle();
    app.fill("somewhere");
    await settle();

    expect(app.reader()).not.toBeNull();
    expect(fetchBook).toHaveBeenCalledTimes(1);
  });

  it("follows the note when the note alone is renamed", async () => {
    // The book travels with its note now, the vault carrying the sidecar with
    // the `.md`, so a reader that stayed on the old path would be reading a
    // file that is no longer there.
    const app = await reading();
    expect(fetchBook).toHaveBeenCalledWith("20 Literature/DDIA.md");
    // Back to the note's own pane: a rename acts on the focused pane's note.
    app.leader("o");
    await settle();
    renameNote.mockResolvedValue({ path: "20 Literature/Designing.md", content: "# DDIA" });
    fetchFiles.mockResolvedValue(["20 Literature/Designing.md", "index.md"]);

    app.leader("r", "f");
    await settle();
    app.fill("20 Literature/Designing.md");
    await settle();

    expect(fetchBook).toHaveBeenCalledWith("20 Literature/Designing.md");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(app.reader()).not.toBeNull();
    expect(app.alert()).toBeNull();
  });

  it("leaves a reader on another note alone when a note is renamed", async () => {
    // The pairing is by path, so only the reader holding the renamed note's
    // own book follows. Without the check every reader in the window would.
    fetchFiles.mockResolvedValue([LIT, "elsewhere/note.md", "index.md"]);
    const app = await reading();
    app.leader("o");
    await settle();
    renameNote.mockResolvedValue({ path: "20 Literature/Designing.md", content: "# DDIA" });

    app.leader("r", "f");
    await settle();
    app.fill("20 Literature/Designing.md");
    await settle();

    expect(fetchBook).not.toHaveBeenCalledWith("elsewhere/note.md");
  });

  /** What the pane reports, and what the note ends up carrying. */
  const PLACE = "epubcfi(/6/4!/4/4/1:0)";

  /** A second place, for the cases needing two accepted moves in one reading. */
  const ELSEWHERE = "epubcfi(/6/8!/4/2/1:0)";

  /** How long the bookmark waits for quiet. */
  const WAIT = 60_000;

  /**
   * A page turn, as the renderer reports one.
   *
   * Two are needed before anything is reported, the first being the
   * navigation `init` performs, and the two must carry two positions or the
   * pane's own dedupe swallows the second.
   */
  function turn() {
    act(() => lastView().emitRelocate({ reason: "page" }));
  }

  /** Turn the page twice, which is one reported move. */
  function turnedTo(cfi: string) {
    FakeView.cfis = ["the page it opened on", cfi];
    turn();
    turn();
  }

  /** Let the whole bookmark wait pass, and whatever it started settle. */
  async function waited() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WAIT);
    });
    await settle();
  }

  describe("keeping your place", () => {
    // Unmounted here rather than by the hook outside, so the flush the reader's
    // own teardown runs is finished with before the mocks are reset. A write
    // left in the air lands inside the next test carrying this one's position.
    afterEach(async () => {
      cleanup();
      await hashed();
      await settle();
    });

    it("writes where the reader got to once the reading stops", async () => {
      await reading();

      turnedTo(PLACE);
      await settle();
      expect(saveNote).not.toHaveBeenCalled();

      await waited();

      expect(saveNote).toHaveBeenCalledWith(
        LIT,
        expect.stringContaining(`reading: ${PLACE}`),
        false,
        expect.any(String),
      );
    });

    it("names the note it read as the bookmark write's base", async () => {
      await reading();

      turnedTo(PLACE);
      await waited();

      expect(saveNote).toHaveBeenCalledWith(
        LIT,
        expect.stringContaining(`reading: ${PLACE}`),
        false,
        noteBase("# DDIA"),
      );
    });

    it("puts the note the vault answered with in the cache", async () => {
      // What the editor reloads off, so a clean buffer holds the bookmark
      // within a render and its next save carries it.
      const app = await reading();

      turnedTo(PLACE);
      await waited();

      expect(app.cached(LIT)).toBe(saveNote.mock.calls[0]?.[1]);
    });

    it("reads nothing at all while the note is in the focused pane", async () => {
      // The read and not the write, because asserting only that `saveNote` was
      // not called stays green with this guard removed and the second reading
      // of it left in.
      const app = await reading();
      // The baseline is the point: the editor read the note when it opened and
      // the pane read it again to restore, so a bare "never called" cannot pass.
      fetchNote.mockClear();

      app.leader("o");
      await settle();
      turnedTo(PLACE);
      await waited();

      expect(fetchNote).not.toHaveBeenCalled();
    });

    it("reads nothing while a write of the note's own text is still out", async () => {
      // The tail the focused-pane guard cannot see: moving to the reader
      // flushes the note being left, and that write is still in the air with
      // the focus already gone. Without this case the route can drop its
      // `isWriting` call and every other test stays green.
      const app = await reading();
      app.leader("o");
      await settle();
      app.press("x");
      await settle();

      let written: (() => void) | undefined;
      saveNote.mockImplementationOnce(
        (path: string, content: string) =>
          new Promise((resolve) => {
            written = () => resolve({ path, content });
          }),
      );
      app.leader("o");
      await settle();
      expect(saveNote).toHaveBeenCalledTimes(1);
      fetchNote.mockClear();

      turnedTo(PLACE);
      await waited();

      expect(fetchNote).not.toHaveBeenCalled();
      written?.();
    });

    it("writes nothing into a note that has left the listing", async () => {
      // With the read answering normally, so this fails for the right reason.
      // Letting it fail instead would pass with the guard removed, the write
      // stopping at the read either way.
      await reading();
      turnedTo(PLACE);
      await settle();

      fetchFiles.mockResolvedValue(["index.md"]);
      act(() => stream().send({ path: LIT, change: "removed", digest: null }));
      await settle();
      fetchNote.mockClear();

      await waited();

      expect(fetchNote).not.toHaveBeenCalled();
      expect(saveNote).not.toHaveBeenCalled();
    });

    it("writes nothing when the note takes the focus during the read", async () => {
      // The save that starts in the same tick as the write. The read took a
      // round trip, and the note can take the focus inside it.
      const app = await reading();
      turnedTo(PLACE);
      await settle();

      let answer: (() => void) | undefined;
      fetchNote.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answer = () => resolve("# DDIA");
          }),
      );
      await waited();
      expect(fetchNote).toHaveBeenCalledWith(LIT);

      app.leader("o");
      await settle();
      answer?.();
      await settle();

      expect(saveNote).not.toHaveBeenCalled();
    });

    it("drops the wait when the note takes the focus", async () => {
      // The focus moving away again before the timer would have fired is what
      // keeps this honest: the guard alone would otherwise pass it.
      const app = await reading();
      turnedTo(PLACE);
      await settle();

      app.leader("o");
      await settle();
      app.leader("o");
      await settle();
      await waited();

      expect(saveNote).not.toHaveBeenCalled();
    });

    it("never lets its own write reach the editor as somebody else's", async () => {
      // The one case here that drives a real CodeMirror mid-write, because
      // nothing else can pin that the route calls `adopt` at all. The order is
      // exact: the write has to start with the reader focused and land with the
      // note focused, or `adopt` refuses a note the hook is not following.
      const app = await reading();
      turnedTo(PLACE);
      await settle();

      let sent = "";
      let land: (() => void) | undefined;
      saveNote.mockImplementationOnce(
        (path: string, content: string) =>
          new Promise((resolve) => {
            sent = content;
            land = () => resolve({ path, content });
          }),
      );
      await waited();
      expect(saveNote).toHaveBeenCalledOnce();

      app.leader("o");
      await settle();
      app.press("x");
      await settle();
      const typed = app.text();

      land?.();
      await hashed();
      // The cache reaching the editor, which is the half the event never
      // exercises: `setQueryData` notifies on a zero-delay timer, the reload
      // effect asks `allowReload`, and the adopted text is what makes it refuse
      // without a word.
      await settle();

      // And then the same write off the stream, which is what `reconcile`
      // answers. In this order because a matched digest takes the entry out of
      // the map and `allowReload` does not, which is the app's own order too: a
      // zero-delay timer beats a `PUT` plus a watcher debounce every time.
      const digest = await digestOf(sent);
      act(() => stream().send({ path: LIT, change: "written", digest }));
      await settle();

      expect(app.status()).not.toBe("Changed on disk");
      expect(app.text()).toBe(typed);
    });

    it("writes at once when the reader is closed", async () => {
      const app = await reading();

      turnedTo(PLACE);
      await settle();

      app.leader("q");
      await settle();

      expect(saveNote).toHaveBeenCalledWith(
        LIT,
        expect.stringContaining(`reading: ${PLACE}`),
        false,
        expect.any(String),
      );
    });

    /** The note as the vault holds it, with the block the case is about. */
    function held(...block: string[]): string {
      return [...(block.length === 0 ? [] : ["---", ...block, "---"]), "# DDIA"].join("\n");
    }

    /** The text of the first write, or nothing where nothing was written. */
    function written(): string {
      return (saveNote.mock.calls[0]?.[1] as string | undefined) ?? "";
    }

    /** Every `type` line the write carried, which is how a second one is caught. */
    function types(): string[] {
      return written()
        .split("\n")
        .filter((line) => line.startsWith("type:"));
    }

    it("types a note Book on the first page you turn to", async () => {
      fetchNote.mockResolvedValue(held("id: one", "type: Note"));
      await reading();

      turnedTo(PLACE);
      await waited();

      expect(types()).toEqual(["type: Book"]);
      expect(written()).toContain(`reading: ${PLACE}`);
    });

    it("types a note Source where what is beside it is a pdf", async () => {
      // Which type it is comes off the file rather than off the note: a pdf is
      // as often a paper, a report or a deck as it is a book, and `Source` is
      // the ontology's own name for something written elsewhere. Read out of
      // the same cache the reader filled, so nothing asks the vault twice.
      fetchBook.mockImplementation(async (note: string) => beside(note, ".pdf"));
      fetchNote.mockResolvedValue(held("id: one", "type: Note"));
      await reading();

      turnedTo(PLACE);
      await waited();

      expect(types()).toEqual(["type: Source"]);
      expect(written()).toContain(`reading: ${PLACE}`);
    });

    it("types a note that carries no block at all", async () => {
      // The block is minted by the write, the way `reading:` is minted into
      // one: a book dropped in from the shell pane has a note like this.
      fetchNote.mockResolvedValue("# DDIA");
      await reading();

      turnedTo(PLACE);
      await waited();

      expect(types()).toEqual(["type: Book"]);
    });

    it("writes nothing at all where the only move was the restore", async () => {
      // The type rides an accepted position write, and the move that opens the
      // book is not one. A book opened and never paged through is not typed.
      await reading();

      FakeView.cfis = ["the page it opened on"];
      turn();
      await waited();

      expect(saveNote).not.toHaveBeenCalled();
    });

    it("leaves a note already saying Book with the one line it had", async () => {
      fetchNote.mockResolvedValue(held("id: one", "type: Book"));
      await reading();

      turnedTo(PLACE);
      await waited();

      expect(types()).toEqual(["type: Book"]);
    });

    it("keeps a type the reader typed, and bookmarks the page all the same", async () => {
      // `Book` goes over `Note` or over nothing and over nothing else. A note
      // typed by hand keeps what was typed, and reading it does not argue.
      fetchNote.mockResolvedValue(held("id: one", "type: Source"));
      await reading();

      turnedTo(PLACE);
      await waited();

      expect(types()).toEqual(["type: Source"]);
      expect(written()).toContain(`reading: ${PLACE}`);
    });

    it("types the note on the write after the focus has left it", async () => {
      // The whole reason the type rides the position write and not the upload:
      // a refused write comes round again, and a one-shot write at upload would
      // be dropped for good.
      const app = await reading();
      app.leader("o");
      await settle();

      FakeView.cfis = ["the page it opened on", PLACE, ELSEWHERE];
      turn();
      turn();
      await waited();
      expect(saveNote).not.toHaveBeenCalled();

      app.leader("o");
      await settle();
      turn();
      await waited();

      expect(types()).toEqual(["type: Book"]);
      expect(written()).toContain(`reading: ${ELSEWHERE}`);
    });
  });

  describe("taking a passage into the note", () => {
    /** What the reader selected, which the note ends up quoting. */
    const PASSAGE = "Systems that tolerate faults are called fault-tolerant.";

    // The reader's teardown flushes, the way the bookmark's own block does it.
    afterEach(async () => {
      cleanup();
      await hashed();
      await settle();
    });

    /** Select a passage in the book and press `y`, the way a reader does. */
    async function takes(text = PASSAGE) {
      // The seam every key and selection reaches the pane through: an event
      // does not cross a document boundary.
      act(() => lastView().emitLoad());
      act(() => selectIn(lastView().section, text));
      act(() =>
        lastView().section.dispatchEvent(new KeyboardEvent("keydown", { key: "y", bubbles: true })),
      );
      await settle();
    }

    it("writes the passage into the note beside the book", async () => {
      const app = await reading();
      fetchNote.mockClear();

      await takes();

      expect(saveNote).toHaveBeenCalledWith(
        LIT,
        expect.stringContaining(`> ${PASSAGE}`),
        false,
        expect.any(String),
      );
      expect(saveNote).toHaveBeenCalledWith(
        LIT,
        expect.stringContaining("## Highlights"),
        false,
        expect.any(String),
      );
      expect(saveNote).toHaveBeenCalledWith(
        LIT,
        expect.stringMatching(/Section 1 \^hl-[0-9a-f]{6}/),
        false,
        expect.any(String),
      );
      // The invalidation, read as the reload it causes: what comes back is
      // read again, so a clean editor picks the highlight up and a dirty one
      // raises the conflict it should.
      expect(fetchNote).toHaveBeenCalledWith(LIT);
      expect(app.notice()).toBeNull();
    });

    it("writes it while the note is the focused pane's and dirty", async () => {
      // The case that fails if somebody copies the bookmark's focus guard onto
      // this write. A highlight is a press: you asked for it, so the conflict
      // it may cause is information rather than rudeness.
      const app = await reading();
      app.leader("o");
      await settle();
      app.press("x");
      await settle();
      expect(app.status()).toBe("Unsaved changes");

      await takes();

      expect(saveNote).toHaveBeenCalledWith(
        LIT,
        expect.stringContaining(`> ${PASSAGE}`),
        false,
        expect.any(String),
      );
    });

    it("writes nothing into a note that has left the listing", async () => {
      const app = await reading();
      fetchFiles.mockResolvedValue(["index.md"]);
      act(() => stream().send({ path: LIT, change: "removed", digest: null }));
      await settle();
      fetchNote.mockClear();

      await takes();

      expect(fetchNote).not.toHaveBeenCalled();
      expect(saveNote).not.toHaveBeenCalled();
      expect(app.notice()).toBe("That note has left the vault");
    });

    it("names the note it read as the highlight write's base", async () => {
      await reading();

      await takes();

      expect(saveNote).toHaveBeenCalledWith(
        LIT,
        expect.stringContaining(`> ${PASSAGE}`),
        false,
        noteBase("# DDIA"),
      );
    });

    it("says the highlight was not written when the note changed on disk every time", async () => {
      const app = await reading();
      // What `updateNote` throws once its tries are spent.
      saveNote.mockRejectedValueOnce(new ChangedOnDisk());

      await takes();

      expect(app.notice()).toBe("The highlight was not written");
    });

    it("says so in the bar when the vault refuses the write", async () => {
      const app = await reading();
      saveNote.mockRejectedValueOnce(new Error("PUT failed with 500"));

      await takes();

      expect(app.notice()).toBe("The highlight was not written");
    });

    it("keeps a bookmark write from overtaking a highlight write", async () => {
      // Both writers read the whole note and write the whole of it back, so
      // interleaved they lose one of the two. Nothing on screen says the gate
      // worked, which is why this case is the only thing that can fail.
      const app = await reading();
      turnedTo(PLACE);
      await settle();

      let answer: (() => void) | undefined;
      fetchNote.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answer = () => resolve("# DDIA");
          }),
      );
      await takes();
      expect(fetchNote).toHaveBeenCalledWith(LIT);
      fetchNote.mockClear();

      await waited();

      expect(fetchNote).not.toHaveBeenCalled();
      answer?.();
      await settle();
      expect(app.notice()).toBeNull();
    });
  });

  describe("the archive", () => {
    /** A vault holding one live note and one filed away. */
    const FILED = ["index.md", "98 Archive/old cert.md"];

    it("keeps the archive out of the tree until the key asks for it", async () => {
      fetchFiles.mockResolvedValue(FILED);
      const app = await renderApp();
      await settle();

      // The folder, not the note in it: the tree draws a folder folded, so its
      // name appearing is the whole of what the toggle changes up here.
      expect(app.tree().textContent).not.toContain("98 Archive");

      app.leader("a");
      await settle();

      expect(app.tree().textContent).toContain("98 Archive");
    });

    it("asks the vault for the archive once the key is on, and not before", async () => {
      // Through the todo overlay, which is the one lookup that asks the vault
      // the moment it opens. What is pinned is that the flag reaches the
      // request at all: without it the backend goes on skipping the archive
      // whatever the key says, and the toggle would half work.
      fetchFiles.mockResolvedValue(FILED);
      const app = await renderApp();
      await settle();

      app.leader("f", "t");
      await settle();
      expect(fetchTodos).toHaveBeenCalledWith(false);

      fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
      await settle();
      app.leader("a");
      await settle();
      app.leader("f", "t");
      await settle();

      expect(fetchTodos).toHaveBeenCalledWith(true);
    });

    it("says on the status bar when the archive is showing", async () => {
      fetchFiles.mockResolvedValue(FILED);
      const app = await renderApp();
      await settle();

      expect(document.querySelector("[data-testid='archive-shown']")).toBeNull();

      app.leader("a");
      await settle();

      expect(document.querySelector("[data-testid='archive-shown']")).not.toBeNull();
    });
  });
});

describe("importing markdown and taking it out again", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue(Object.keys(VAULT));
    fetchNote.mockImplementation(async (path: string) => VAULT[path]);
    saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    fetchTodos.mockResolvedValue([]);
    createNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    // jsdom implements neither, an object URL having no meaning without a
    // network stack behind it, so the download names them itself.
    URL.createObjectURL = vi.fn(() => BLOB_URL);
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(async () => {
    cleanup();
    // A flush naming a base goes out once its hash lands, which must be
    // inside this test and not the next one.
    await hashed();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  const BLOB_URL = "blob:the-note";

  it("blanks the markdown picker and then opens it", async () => {
    const app = await renderApp();
    await settle();
    // The same order the book's picker is opened in, and for the same reason:
    // an input keeps the last file chosen, and picking it again may fire no
    // `change` at all, which is a second attempt doing nothing.
    const order: string[] = [];
    Object.defineProperty(app.notePicker(), "value", { set: () => order.push("blank") });
    vi.spyOn(app.notePicker(), "click").mockImplementation(() => {
      order.push("click");
    });

    app.leader("c", "m");

    expect(order).toEqual(["blank", "click"]);
  });

  it("keeps each file's own name and puts them all in the inbox", async () => {
    const app = await renderApp();
    await settle();

    app.chooseNotes([
      new File(["what Borges said"], "Borges.md"),
      new File(["and what he wrote"], "Ficciones.md"),
    ]);
    await settle();

    expect(createNote).toHaveBeenCalledWith("00 Inbox/Borges.md", "what Borges said");
    expect(createNote).toHaveBeenCalledWith("00 Inbox/Ficciones.md", "and what he wrote");
  });

  it("opens the first of them, which is the only sign the import worked", async () => {
    const app = await renderApp();
    await settle();

    app.chooseNotes([new File(["what Borges said"], "Borges.md")]);
    await settle();

    expect(app.text()).toContain("what Borges said");
  });

  it("carries on past a file the vault refused, and says one went", async () => {
    // The case the whole loop exists for. A batch that stopped on the first
    // collision would leave the reader picking the rest of the folder by hand.
    createNote.mockImplementation(async (path: string, content: string) => {
      if (path === "00 Inbox/Borges.md") throw new Error("A note is already there");
      return { path, content };
    });
    const app = await renderApp();
    await settle();

    app.chooseNotes([
      new File(["what Borges said"], "Borges.md"),
      new File(["and what he wrote"], "Ficciones.md"),
    ]);
    await settle();

    expect(createNote).toHaveBeenCalledWith("00 Inbox/Ficciones.md", "and what he wrote");
    expect(app.notice()).toBe("A note is already there");
    // The one that landed, not the one that was picked first.
    expect(app.text()).toContain("and what he wrote");
  });

  it("hands the open note to the browser as a file under its own name", async () => {
    const caught = clicked();
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();

    app.leader("w");
    await settle();

    expect(caught[0]?.download).toBe("index.md");
    expect(caught[0]?.href).toBe(BLOB_URL);
  });

  it("downloads the text as the buffer holds it, not as the vault last read it", async () => {
    // The save the key runs first. Without it the file carries the note from
    // before the last keystroke, which is the one thing a download must not do.
    clicked();
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    // `x` deletes the character under the cursor, which opens at the top.
    app.press("x");
    await settle();

    app.leader("w");
    await hashed();
    await settle();

    const blob = vi.mocked(URL.createObjectURL).mock.calls[0]?.[0] as Blob;
    expect(await blob.text()).toBe("he index note");
  });

  it("gives the object URL back rather than holding the note until the tab closes", async () => {
    clicked();
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();

    app.leader("w");
    await settle();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(BLOB_URL);
  });

  it("does nothing at all with no note in the focused pane", async () => {
    const caught = clicked();
    const app = await renderApp();
    await settle();

    app.leader("w");
    await settle();

    expect(caught).toEqual([]);
  });
});

describe("putting a book in the vault", () => {
  const BOOK = "00 Inbox/02 Books/Talk Like TED.epub";
  const NOTE = "00 Inbox/02 Books/Talk Like TED.md";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue(Object.keys(VAULT));
    fetchNote.mockImplementation(async (path: string) => VAULT[path]);
    saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    fetchTodos.mockResolvedValue([]);
    fetchBook.mockImplementation(async (note: string) => beside(note));
    fetchImages.mockResolvedValue([]);
    fetchHtml.mockResolvedValue([]);
    fetchAssets.mockResolvedValue([]);
    // Re-armed with the rest: `resetAllMocks` takes the answer off them, and a
    // call that hands back undefined instead of a promise throws on `await`.
    uploadAsset.mockResolvedValue(undefined);
    createNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    resetFoliateFake();
  });

  afterEach(async () => {
    cleanup();
    // A flush naming a base goes out once its hash lands, which must be
    // inside this test and not the next one.
    await hashed();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  /** The picker, with a file chosen in it. */
  function pick(app: Awaited<ReturnType<typeof renderApp>>, name: string, size?: number) {
    const file = new File(["a book"], name);
    if (size !== undefined) Object.defineProperty(file, "size", { value: size });
    app.leader("c", "b");
    app.choose(file);
    return file;
  }

  it("blanks the picker and then opens it", async () => {
    const app = await renderApp();
    await settle();
    const picker = app.picker();
    // The order, recorded through a setter spy. Asserting the value is empty
    // afterwards would pass with the blanking deleted, a file input starting
    // empty, and seeding a non-empty one is refused by the DOM. Blanking
    // matters because an input keeps the last file chosen and picking the same
    // one again may fire no `change` at all, which is a retry doing nothing.
    const order: string[] = [];
    Object.defineProperty(picker, "value", { set: () => order.push("blank") });
    vi.spyOn(picker, "click").mockImplementation(() => {
      order.push("click");
    });

    app.leader("c", "b");

    expect(order).toEqual(["blank", "click"]);
  });

  it("opens the picker with no note in the focused pane", async () => {
    // The book brings its own note, so there is nothing here to be beside.
    // This is the case the first cut of the key refused outright.
    const app = await renderApp();
    await settle();
    const click = vi.spyOn(app.picker(), "click");

    app.leader("c", "b");

    expect(click).toHaveBeenCalledTimes(1);
  });

  it("keeps the file's own name and puts the pair in the inbox", async () => {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();

    const file = pick(app, "Talk Like TED.epub");
    await settle();

    // Not `index.epub`. The book is not named after whatever note was open.
    expect(uploadAsset).toHaveBeenCalledWith(BOOK, file);
    expect(createNote).toHaveBeenCalledWith(NOTE, "# Talk Like TED\n");
  });

  it("files a pdf apart from the books, under its own suffix", async () => {
    const app = await renderApp();
    await settle();

    const file = pick(app, "Attention Is All You Need.pdf");
    await settle();

    // `02 Documents` and not `02 Books`, the folder being a claim about what
    // the file is. The note goes in beside it, the pair travelling together.
    expect(uploadAsset).toHaveBeenCalledWith(
      "00 Inbox/02 Documents/Attention Is All You Need.pdf",
      file,
    );
    expect(createNote).toHaveBeenCalledWith(
      "00 Inbox/02 Documents/Attention Is All You Need.md",
      "# Attention Is All You Need\n",
    );
  });

  it("refuses a file of a kind the reader cannot open", async () => {
    // The picker's `accept` filters its default view and stops nothing, the
    // reader being free to switch it to all files. An older cut put `.epub` on
    // the name whatever arrived, so this went up as `Ulysses.mobi.epub` and
    // the vault refused it for bytes that did not match a name nobody chose.
    const app = await renderApp();
    await settle();

    pick(app, "Ulysses.mobi");
    await settle();

    expect(uploadAsset).not.toHaveBeenCalled();
    expect(createNote).not.toHaveBeenCalled();
    expect(app.notice()).toBe("The vault will not take that name");
  });

  it("opens the note it made, which is the only sign the upload worked", async () => {
    const app = await renderApp();
    await settle();

    pick(app, "Talk Like TED.epub");
    await settle();

    // The heading as the editor draws it: live preview renders the markdown.
    expect(app.text()).toContain("Talk Like TED");
  });

  it("leaves a note that is already there alone", async () => {
    fetchFiles.mockResolvedValue([...Object.keys(VAULT), NOTE]);
    VAULT[NOTE] = "notes I already took";
    const app = await renderApp();
    await settle();

    pick(app, "Talk Like TED.epub");
    await settle();

    expect(createNote).not.toHaveBeenCalled();
    expect(app.text()).toContain("notes I already took");
    delete VAULT[NOTE];
  });

  it("makes no note when the upload was refused", async () => {
    // The book goes up first, so a refusal leaves no orphan note behind.
    const app = await renderApp();
    await settle();
    uploadAsset.mockRejectedValue(new Error("A book is already there"));

    pick(app, "Talk Like TED.epub");
    await settle();

    expect(createNote).not.toHaveBeenCalled();
    expect(app.notice()).toBe("A book is already there");
  });

  it("says something when the failure carries no sentence at all", async () => {
    // A `fetch` rejects on a dropped connection or a suspended tab, and there
    // is no status to name.
    const app = await renderApp();
    await settle();
    uploadAsset.mockRejectedValue("no response");

    pick(app, "Talk Like TED.epub");
    await settle();

    expect(app.notice()).toBe("The upload failed");
  });

  it("refuses a file whose name leaves nothing the vault would take", async () => {
    const app = await renderApp();
    await settle();

    pick(app, "///.epub");
    await settle();

    expect(uploadAsset).not.toHaveBeenCalled();
    expect(app.notice()).toBe("The vault will not take that name");
  });

  it("refuses a book over the cap without sending a byte", async () => {
    const app = await renderApp();
    await settle();

    pick(app, "Talk Like TED.epub", ASSET_LIMIT_BYTES + 1);
    await settle();

    expect(uploadAsset).not.toHaveBeenCalled();
    expect(app.notice()).toBe("That file is too big");
  });

  it("sends a book exactly at the cap", async () => {
    // A guard, not a red step: the check is strictly greater, so the boundary
    // passes either way. It pins the client's own boundary and says nothing
    // about production, where Cloudflare answers first.
    const app = await renderApp();
    await settle();

    const file = pick(app, "Talk Like TED.epub", ASSET_LIMIT_BYTES);
    await settle();

    expect(uploadAsset).toHaveBeenCalledWith(BOOK, file);
  });

  it("tells a reader already open on that path about the book that arrived", async () => {
    const app = await renderApp();
    await settle();
    pick(app, "Talk Like TED.epub");
    await settle();
    app.leader("g", "r");
    await settle();
    // The reader opens beside the note and takes the focus with it, so the
    // focus goes back to the note before the key that needs one is pressed.
    app.focusPane(0);
    await settle();
    expect(fetchBook).toHaveBeenCalledTimes(1);

    pick(app, "Talk Like TED.epub");
    await settle();

    // The `listing` event the write fires invalidates `["files"]` alone, so
    // without the invalidation a reader sitting on "no sidecar" would never
    // notice the book that just arrived.
    expect(fetchBook).toHaveBeenCalledTimes(2);
  });

  it("clears the bar on the next press, picker cancelled or not", async () => {
    // A guard: the command already clears it. It earns its place anyway,
    // without it `setNotice(undefined)` can be deleted with every other test
    // still green. Pressing the key and then cancelling the picker wipes the
    // old sentence, because you asked for a fresh go at it.
    const app = await renderApp();
    await settle();
    uploadAsset.mockRejectedValue(new Error("A book is already there"));
    pick(app, "Talk Like TED.epub");
    await settle();
    expect(app.notice()).toBe("A book is already there");

    app.leader("c", "b");
    await settle();

    expect(app.notice()).toBeNull();
  });
});

describe("looking at an image", () => {
  const SHOT = "99 Misc/shot.png";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue(Object.keys(VAULT));
    fetchNote.mockImplementation(async (path: string) => VAULT[path]);
    saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    fetchTodos.mockResolvedValue([]);
    fetchImages.mockResolvedValue([SHOT]);
    deleteImage.mockResolvedValue({ entry: `${SHOT}@20260812T180000Z`, path: SHOT, deleted: "" });
  });

  afterEach(async () => {
    cleanup();
    // A flush naming a base goes out once its hash lands, which must be
    // inside this test and not the next one.
    await hashed();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it("shows the image in the pane the note was in", async () => {
    const app = await renderApp();
    // Settled first: the listing arrives after the first render, and the row is
    // not in the tree until it does. The folder is drawn from the image's own
    // path, no note living in `99 Misc`.
    await settle();
    app.expand("99 Misc");

    app.click(SHOT);
    await settle();

    expect(app.imagePane()).not.toBeNull();
    expect(app.imagePane()?.querySelector("img")?.getAttribute("src")).toBe(
      `/api/assets/${encodeURI(SHOT)}`,
    );
  });

  it("hands the picture to the browser under its own name", async () => {
    const caught = clicked();
    const app = await renderApp();
    await settle();
    app.expand("99 Misc");
    app.click(SHOT);
    await settle();

    // Into the pane itself, an image pane holding no editor to press into.
    const pane = app.imagePane() as HTMLElement;
    fireEvent.keyDown(pane, { key: " " });
    fireEvent.keyDown(pane, { key: "w" });
    await settle();

    expect(caught[0]?.download).toBe("shot.png");
    expect(caught[0]?.getAttribute("href")).toBe(`/api/assets/${encodeURI(SHOT)}`);
  });

  it("shows and hands over a picture whose name holds # or ?", async () => {
    // Raw, either would end the path: `#` starts a fragment and `?` a query.
    const odd = "99 Misc/plan #2?.png";
    fetchImages.mockResolvedValue([odd]);
    const caught = clicked();
    const app = await renderApp();
    await settle();
    app.expand("99 Misc");
    app.click(odd);
    await settle();

    const encoded = "/api/assets/99%20Misc/plan%20%232%3F.png";
    expect(app.imagePane()?.querySelector("img")?.getAttribute("src")).toBe(encoded);
    const pane = app.imagePane() as HTMLElement;
    fireEvent.keyDown(pane, { key: " " });
    fireEvent.keyDown(pane, { key: "w" });
    await settle();
    expect(caught[0]?.getAttribute("href")).toBe(encoded);
  });

  it("hands the pane back to an editor on the leader then q", async () => {
    const app = await renderApp();
    await settle();
    app.expand("99 Misc");
    app.click(SHOT);
    await settle();

    // Pressed into the pane itself, the image pane holding the focus and there
    // being no `.cm-content` on screen to press into.
    const pane = app.imagePane() as HTMLElement;
    fireEvent.keyDown(pane, { key: " " });
    fireEvent.keyDown(pane, { key: "q" });
    await settle();

    expect(app.imagePane()).toBeNull();
    // Emptied rather than removed: the pane is still there, holding an editor.
    expect(app.text()).toBe("");
  });

  it("takes the image out of the vault on d in the tree, and off the screen", async () => {
    const app = await renderApp();
    await settle();
    app.expand("99 Misc");
    // Walked to with the keys rather than clicked: a click opens a row without
    // moving the tree's own cursor, and `d` acts on the cursor.
    fireEvent.keyDown(app.tree(), { key: "j" });
    fireEvent.keyDown(app.tree(), { key: "Enter" });
    await settle();

    fireEvent.keyDown(app.tree(), { key: "d" });
    fetchImages.mockResolvedValue([]);
    fetchHtml.mockResolvedValue([]);
    fetchAssets.mockResolvedValue([]);
    await settle();

    expect(deleteImage).toHaveBeenCalledWith(SHOT);
    // Emptied rather than left showing a picture the vault no longer has.
    expect(app.imagePane()).toBeNull();
    expect(app.tree().textContent).not.toContain("shot.png");
  });

  it("refetches the listing when the vault says a file that is not a note changed", async () => {
    const app = await renderApp();
    await settle();
    fetchImages.mockResolvedValue([SHOT, "99 Misc/another.png"]);

    // What an image pasted anywhere, or dropped in over a terminal, arrives as.
    stream().send({ path: "", change: "listing", digest: null });
    await settle();

    app.expand("99 Misc");
    expect(app.tree().textContent).toContain("another.png");
  });
});

describe("following a link to a page of HTML", () => {
  const NOTE = "index.md";
  const PAGE = "01 Periodic/05 Newspaper/2026-10-07.html";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue([NOTE]);
    saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    fetchTodos.mockResolvedValue([]);
    fetchImages.mockResolvedValue([]);
    fetchHtml.mockResolvedValue([PAGE]);
    fetchAssets.mockResolvedValue([]);
  });

  afterEach(async () => {
    cleanup();
    // A flush naming a base goes out once its hash lands, which must be
    // inside this test and not the next one.
    await hashed();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  /** Open the note holding `link`, the cursor on it, and press `gf`. */
  async function follow(link: string) {
    fetchNote.mockResolvedValue(`[[${link}]]\n`);
    const app = await renderApp();
    await settle();
    app.click(NOTE);
    await settle();
    app.press("g");
    app.press("f");
    await settle();
    return app;
  }

  it("opens the page by its bare file name in the HTML pane", async () => {
    await follow("2026-10-07.html");

    expect(document.querySelector("[data-html-pane] iframe")?.getAttribute("title")).toBe(PAGE);
  });

  it("makes no note for a page nobody wrote", async () => {
    await follow("missing.html");

    expect(createNote).not.toHaveBeenCalled();
    expect(document.querySelector("[data-html-pane]")).toBeNull();
  });

  it("opens the page behind an alias", async () => {
    await follow("2026-10-07.html|the paper");

    expect(document.querySelector("[data-html-pane] iframe")?.getAttribute("title")).toBe(PAGE);
  });

  it("opens a page named in capitals", async () => {
    await follow("2026-10-07.HTML");

    expect(document.querySelector("[data-html-pane] iframe")?.getAttribute("title")).toBe(PAGE);
  });

  it("loads a page whose name holds # from the tree", async () => {
    // From the tree and not a link, `[[plan #2.html]]` naming the heading `2.html`.
    const odd = "plan #2.html";
    fetchHtml.mockResolvedValue([odd]);
    fetchNote.mockResolvedValue("");
    const app = await renderApp();
    await settle();
    app.click(odd);
    await settle();

    expect(document.querySelector("[data-html-pane] iframe")?.getAttribute("src")).toBe(
      "/api/html/plan%20%232.html",
    );
  });
});

describe("following a link to an asset", () => {
  const NOTE = "index.md";
  const PLAN = "rehearse/my plan.pdf";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    vi.stubGlobal("open", vi.fn());
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue([NOTE]);
    saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    fetchTodos.mockResolvedValue([]);
    fetchImages.mockResolvedValue([]);
    fetchHtml.mockResolvedValue([]);
    fetchAssets.mockResolvedValue([PLAN]);
  });

  afterEach(async () => {
    cleanup();
    // A flush naming a base goes out once its hash lands, which must be
    // inside this test and not the next one.
    await hashed();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  /** Open the note holding `link`, the cursor on it, and press `gf`. */
  async function follow(link: string) {
    fetchNote.mockResolvedValue(`[[${link}]]\n`);
    const app = await renderApp();
    await settle();
    app.click(NOTE);
    await settle();
    app.press("g");
    app.press("f");
    await settle();
    return app;
  }

  it("draws a link to an asset the vault holds as live", async () => {
    await follow("my plan.pdf");

    expect(document.querySelector(".cm-wikilink")).not.toBeNull();
    expect(document.querySelector(".cm-wikilink-dead")).toBeNull();
  });

  it("opens an asset the vault holds in a new tab, in any case", async () => {
    await follow("My Plan.PDF|the plan");

    expect(window.open).toHaveBeenCalledWith(`/api/assets/${encodeURI(PLAN)}`, "_blank");
    expect(createNote).not.toHaveBeenCalled();
  });

  it("I8 opens a pdf at its #page with gf", async () => {
    await follow("my plan.pdf#page=3");

    expect(window.open).toHaveBeenCalledWith(`/api/assets/${encodeURI(PLAN)}#page=3`, "_blank");
  });

  it("I8 opens an embedded pdf at its #page with gf on its source", async () => {
    fetchNote.mockResolvedValue("![[my plan.pdf#page=3]]\n");
    const app = await renderApp();
    await settle();
    app.click(NOTE);
    await settle();
    app.press("l");
    app.press("g");
    app.press("f");
    await settle();

    expect(window.open).toHaveBeenCalledWith(`/api/assets/${encodeURI(PLAN)}#page=3`, "_blank");
  });

  it("opens an asset whose name holds ? with gf", async () => {
    fetchAssets.mockResolvedValue(["plan?.pdf"]);
    await follow("plan?.pdf");

    expect(document.querySelector(".cm-vimMode")).not.toBeNull();
    expect(window.open).toHaveBeenCalledWith("/api/assets/plan%3F.pdf", "_blank");
  });

  it("opens an asset whose name holds ? on ctrl+click with vim off", async () => {
    fetchAssets.mockResolvedValue(["plan?.pdf"]);
    localStorage.setItem("kasten.vim", "off");
    try {
      fetchNote.mockResolvedValue("[[plan?.pdf]]\n");
      const app = await renderApp();
      await settle();
      app.click(NOTE);
      await settle();
      expect(document.querySelector(".cm-vimMode")).toBeNull();
      const link = document.querySelector(".cm-wikilink") as HTMLElement;
      fireEvent.mouseDown(link, { ctrlKey: true });
      await settle();
    } finally {
      localStorage.removeItem("kasten.vim");
    }

    expect(window.open).toHaveBeenCalledWith("/api/assets/plan%3F.pdf", "_blank");
  });

  it("draws and opens an asset whose suffix is in capitals", async () => {
    fetchAssets.mockResolvedValue(["docs/Plan.PDF"]);
    await follow("Plan.PDF");

    expect(document.querySelector(".cm-wikilink")?.textContent).toBe("Plan.PDF");
    expect(document.querySelector(".cm-wikilink-dead")).toBeNull();
    expect(window.open).toHaveBeenCalledWith("/api/assets/docs/Plan.PDF", "_blank");
    expect(createNote).not.toHaveBeenCalled();
  });

  it("makes no note and opens nothing for an asset the vault lacks", async () => {
    await follow("missing.pdf");

    expect(window.open).not.toHaveBeenCalled();
    expect(createNote).not.toHaveBeenCalled();
    expect(document.querySelector(".cm-wikilink-dead")).not.toBeNull();
  });
});

describe("following a link with an alias or a heading", () => {
  const NOTE = "index.md";
  const OTHER = "reading/borges.md";
  /** Frontmatter first, so the heading's line counts the block above the body. */
  /** Line 6 links back to its own heading by name, for following it twice. */
  const BORGES = "---\nid: 01\n---\n# Borges\n\n[[borges#Life]]\n\n## Life\n\nborn 1899\n";
  const LIFE = 8;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue([NOTE, OTHER]);
    saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    createNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    fetchTodos.mockResolvedValue([]);
    fetchImages.mockResolvedValue([]);
    fetchHtml.mockResolvedValue([]);
    fetchAssets.mockResolvedValue([]);
  });

  afterEach(async () => {
    cleanup();
    // A flush naming a base goes out once its hash lands, which must be
    // inside this test and not the next one.
    await hashed();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  /** Open the note holding `link` on its first line, the cursor on it, and press `gf`. */
  async function follow(link: string, below = "") {
    fetchNote.mockImplementation(async (path: string) =>
      path === NOTE ? `[[${link}]]\n${below}` : BORGES,
    );
    const app = await renderApp();
    await settle();
    app.click(NOTE);
    await settle();
    app.press("g");
    app.press("f");
    await settle();
    return app;
  }

  /** The text in the editor and the line its cursor sits on. */
  function opened() {
    const view = EditorView.findFromDOM(document.querySelector(".cm-editor") as HTMLElement);
    if (!view) throw new Error("No editor is mounted");
    const { state } = view;
    return { text: state.doc.toString(), line: state.doc.lineAt(state.selection.main.head).number };
  }

  it("opens the note an alias is written on", async () => {
    await follow("borges|Jorge");

    expect(createNote).not.toHaveBeenCalled();
    expect(opened().text).toBe(BORGES);
  });

  it("opens the note at the heading", async () => {
    await follow("borges#Life");

    expect(createNote).not.toHaveBeenCalled();
    expect(opened()).toEqual({ text: BORGES, line: LIFE });
  });

  it("opens the note at the heading behind an alias", async () => {
    await follow("borges#life|his life");

    expect(opened()).toEqual({ text: BORGES, line: LIFE });
  });

  it("opens the note as a plain link does for a heading it does not hold", async () => {
    await follow("borges#Death");

    // Where the body starts, under the frontmatter, which is where any note opens.
    expect(createNote).not.toHaveBeenCalled();
    expect(opened()).toEqual({ text: BORGES, line: 4 });
  });

  it("jumps to a heading of the note it is written in, making no note", async () => {
    await follow("#Below", "\ntext\n\n## Below\n");

    expect(createNote).not.toHaveBeenCalled();
    expect(opened()).toEqual({ text: "[[#Below]]\n\ntext\n\n## Below\n", line: 5 });
  });

  it("jumps again on a second gf to the heading of the note already open", async () => {
    const app = await follow("borges#Life");
    expect(opened().line).toBe(LIFE);

    // Back to the link, and the same jump once more: the pane already holds
    // this note at this line, so only a fresh open says to move.
    app.press("6");
    app.press("G");
    expect(opened().line).toBe(6);
    app.press("g");
    app.press("f");
    await settle();

    expect(opened().line).toBe(LIFE);
  });

  it("jumps again on a second gf to a heading of its own note", async () => {
    const app = await follow("#Below", "\ntext\n\n## Below\n");
    expect(opened().line).toBe(5);

    app.press("g");
    app.press("g");
    app.press("g");
    app.press("f");
    await settle();

    expect(opened().line).toBe(5);
  });

  it("jumps to a heading of its own note by the text on screen, saved or not", async () => {
    fetchNote.mockResolvedValue("[[#Below]]\n\ntext\n\n## Below\n");
    const app = await renderApp();
    await settle();
    app.click(NOTE);
    await settle();

    // A copy of the link pasted under it, which no save has reached yet: the
    // heading is a line further down than the vault has it.
    for (const key of ["y", "y", "p", "g", "f"]) app.press(key);
    await settle();

    expect(opened().line).toBe(6);
  });

  it("drops the jump when another note was opened while the heading was read", async () => {
    let answer: (text: string) => void = () => {};
    fetchFiles.mockResolvedValue([NOTE, OTHER, "kafka.md"]);
    fetchNote.mockImplementation(async (path: string) => {
      if (path === NOTE) return "[[borges#Life]]\n";
      if (path === "kafka.md") return "the trial\n";
      return new Promise<string>((resolve) => {
        answer = resolve;
      });
    });
    const app = await renderApp();
    await settle();
    app.click(NOTE);
    await settle();
    app.press("g");
    app.press("f");
    await settle();

    app.click("kafka.md");
    await settle();
    answer(BORGES);
    await settle();

    expect(opened().text).toBe("the trial\n");
  });

  it("makes a missing note under its name, not its alias", async () => {
    await follow("cortazar|Julio");

    expect(createNote.mock.calls).toEqual([["00 Inbox/cortazar.md", ""]]);
  });

  it("makes a missing note under its name, not its heading", async () => {
    await follow("rayuela#One");

    expect(createNote.mock.calls).toEqual([["00 Inbox/rayuela.md", ""]]);
  });
});

describe("opening a highlight's book with gf", () => {
  const LIT = "20 Literature/DDIA.md";
  const PASSAGE = "Systems that tolerate faults are called fault-tolerant.";
  /** A note beginning with a highlight block, so the cursor opens on the quote line. */
  const HELD = `> ${PASSAGE}\n\nSection 1 ^hl-a3f9c1\n`;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue([LIT, "index.md"]);
    fetchNote.mockResolvedValue(HELD);
    saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    fetchTodos.mockResolvedValue([]);
    fetchImages.mockResolvedValue([]);
    fetchHtml.mockResolvedValue([]);
    fetchAssets.mockResolvedValue([]);
    fetchBook.mockImplementation(async (note: string) => beside(note));
    resetFoliateFake();
    // Without a section holding the words the walk finds nothing and calls
    // `onNotice` instead of navigating, which every case below would pass over.
    FakeView.sections = sectionsOf([PASSAGE]);
  });

  afterEach(async () => {
    cleanup();
    // A flush naming a base goes out once its hash lands, which must be
    // inside this test and not the next one.
    await hashed();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  /** Open the literature note, with the cursor on its first line. */
  async function opened() {
    const app = await renderApp();
    await settle();
    // The tree opens folded, so the note's row is not drawn until its folder is.
    app.expand("20 Literature");
    await settle();
    app.click(LIT);
    await settle();
    return app;
  }

  /**
   * Press `gf` where the cursor opens, which is the block's quote line.
   *
   * No motion first. That the other three places in a block answer the same is
   * pinned in `editor.test.tsx`, where the same editor runs on a real clock:
   * `j` under this file's fake timers leaves the view taking no further keys.
   */
  async function follows(app: Awaited<ReturnType<typeof opened>>) {
    app.press("g");
    app.press("f");
    await settle();
  }

  /**
   * The vault reports a write nobody in this tab made, and refuses the quiet
   * save after it over its base, which is the conflict.
   */
  function somebodyElseWrote() {
    saveNote.mockRejectedValueOnce(new ChangedOnDisk());
    act(() => {
      stream().send({ path: LIT, change: "written", digest: "a".repeat(64) });
      vi.advanceTimersByTime(800);
    });
  }

  it("splits a reader beside the note and takes it to the passage", async () => {
    const app = await opened();

    await follows(app);
    expect(app.panes()).toBe(2);
    expect(app.reader()).not.toBeNull();
    expect(lastView().gone).toHaveLength(1);
  });

  it("writes no seek while the note stands conflicted", async () => {
    // `moveTo` refuses the key, and a seek set anyway would arm a jump in the
    // reader that is already open for a press that was refused.
    const app = await opened();
    app.leader("g", "r");
    await settle();
    app.leader("o");
    await settle();
    // Typed and undone, so the buffer is one the autosave is holding text for
    // while the block is exactly as the writer left it. That waiting text is
    // what makes the vault's write a conflict.
    app.press("x");
    app.press("u");
    somebodyElseWrote();
    await settle();

    await follows(app);

    expect(lastView().gone).toEqual([]);
  });

  it("hands the passage over once, and arms nothing for the next reader", async () => {
    // Without the clearing, a reader opened an hour later mounts holding a seek
    // nobody pressed a key for, over the bookmark PR 2 exists to keep.
    const app = await opened();
    await follows(app);
    expect(lastView().gone).toHaveLength(1);

    // Close the reader and open the book again the way `<leader>gr` does. The
    // focus is left on the emptied pane, which holds no note, so it goes back
    // to the note's pane first.
    app.leader("q");
    await settle();
    app.leader("o");
    await settle();
    app.leader("g", "r");
    await settle();
    expect(FakeView.made).toHaveLength(2);
    expect(lastView().gone).toEqual([]);
  });

  it("moves to the reader already open rather than making a second", async () => {
    // pin: `openBookBeside` focuses the pane already reading that note.
    const app = await opened();
    app.leader("g", "r");
    await settle();
    app.leader("o");
    await settle();

    await follows(app);

    expect(app.panes()).toBe(2);
    expect(FakeView.made).toHaveLength(1);
  });

  it("clears the notice the way every other key does", async () => {
    // pin: the press clears it, which is the rule PR 4 settled.
    const app = await opened();
    uploadAsset.mockRejectedValue(new Error("A book is already there"));
    app.leader("c", "b");
    app.choose(new File(["a book"], "Talk Like TED.epub"));
    await settle();
    expect(app.notice()).toBe("A book is already there");

    await follows(app);

    expect(app.notice()).toBeNull();
  });
});

describe("capturing into today's dump", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue(Object.keys(VAULT));
    fetchNote.mockImplementation(async (path: string) => VAULT[path]);
    saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    fetchTodos.mockResolvedValue([]);
    captureDump.mockImplementation(async () => ({ path: "x.md", content: "" }));
  });

  afterEach(async () => {
    cleanup();
    // A flush naming a base goes out once its hash lands, which must be
    // inside this test and not the next one.
    await hashed();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  /** The prompt's own input, which is not the only one the route mounts. */
  const field = () => screen.getByLabelText("dump");

  it("sends the thought for today on Enter, and says it landed", async () => {
    const app = await renderApp();
    await settle();

    app.leader("c", "d");
    fireEvent.change(field(), { target: { value: "ask Jonas about the flat" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    await settle();

    expect(captureDump).toHaveBeenCalledWith(
      "ask Jonas about the flat",
      readClock(new Date()).date,
    );
    expect(screen.queryByRole("dialog", { name: "Capture a thought" })).toBeNull();
    expect(app.notice()).toBe("Captured into today's dump");
  });

  it("puts the vault's refusal where the confirmation would have been", async () => {
    captureDump.mockRejectedValue(new Error("The vault will not take that path"));
    const app = await renderApp();
    await settle();

    app.leader("c", "d");
    fireEvent.change(field(), { target: { value: "a thought" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    await settle();

    expect(app.notice()).toBe("The vault will not take that path");
  });

  it("writes nothing when Escape closes it", async () => {
    const app = await renderApp();
    await settle();

    app.leader("c", "d");
    fireEvent.change(field(), { target: { value: "half a thought" } });
    fireEvent.keyDown(field(), { key: "Escape" });
    await settle();

    expect(captureDump).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Capture a thought" })).toBeNull();
  });
});

describe("the vault's own vocabulary", () => {
  const ONTOLOGY_TEXT = "# Ontology\n\n## Relations\n\n- invented-here: only this note says so\n";
  const EDITED = "# Ontology\n\n## Relations\n\n- rewritten-since: the note was edited\n";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue([...Object.keys(VAULT), ONTOLOGY_NOTE]);
    fetchNote.mockImplementation(async (path: string) =>
      path === ONTOLOGY_NOTE ? ONTOLOGY_TEXT : VAULT[path],
    );
    saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    fetchTodos.mockResolvedValue([]);
    fetchBook.mockImplementation(async (note: string) => beside(note));
    fetchImages.mockResolvedValue([]);
    fetchHtml.mockResolvedValue([]);
    fetchAssets.mockResolvedValue([]);
    resetFoliateFake();
  });

  afterEach(async () => {
    cleanup();
    // A flush naming a base goes out once its hash lands, which must be
    // inside this test and not the next one.
    await hashed();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  /**
   * What the mounted editor would offer after `dep` at the start of a line.
   *
   * Read off the live view's own state, so nothing but the route's fetch and the
   * prop behind it could have supplied a name. The state is derived rather than
   * typed into, which keeps the autosave out of a test about a completion.
   */
  function offered(): string[] | undefined {
    const view = EditorView.findFromDOM(document.querySelector(".cm-editor") as HTMLElement);
    if (!view) throw new Error("No editor is mounted");

    const typed = view.state.update({
      changes: { from: 0, to: view.state.doc.length, insert: "dep" },
    }).state;
    return relationCompletions(new CompletionContext(typed, 3, false))?.options.map(
      ({ label }) => label,
    );
  }

  it("offers a name that came from the note it fetched and from nowhere else", async () => {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();

    expect(fetchNote).toHaveBeenCalledWith(ONTOLOGY_NOTE);
    expect(offered()).toEqual(["invented-here"]);
  });

  it("follows an edit to that note without a remount", async () => {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    expect(offered()).toEqual(["invented-here"]);

    // What the vault says when the vocabulary is edited anywhere else: the
    // route invalidates that key and the query behind it reads the note again.
    fetchNote.mockImplementation(async (path: string) =>
      path === ONTOLOGY_NOTE ? EDITED : VAULT[path],
    );
    act(() => stream().send({ path: ONTOLOGY_NOTE, change: "written", digest: "b".repeat(64) }));
    await settle();

    expect(offered()).toEqual(["rewritten-since"]);
  });
});
