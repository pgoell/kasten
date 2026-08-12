import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { ASSET_LIMIT_BYTES } from "@/lib/api";
import { digestOf, type VaultEvent } from "@/lib/vault-events";
import { routeTree } from "@/routeTree.gen";
import { defineFoliateFake, FakeView, lastView, resetFoliateFake } from "./foliate-fake";

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
  uploadBook,
} = vi.hoisted(() => ({
  fetchFiles: vi.fn(),
  fetchNote: vi.fn(),
  saveNote: vi.fn(),
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
  fetchBook: vi.fn().mockResolvedValue(new Blob(["a book"])),
  uploadBook: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/api", () => ({
  fetchFiles,
  fetchNote,
  saveNote,
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
  uploadBook,
  // Left off the factory this constant arrives in the route as undefined,
  // `file.size > undefined` is false for every file, and the size check never
  // fires while its boundary guard passes vacuously over the break.
  ASSET_LIMIT_BYTES: 100 * 1024 * 1024,
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
    /** The reader, while a pane is holding one. */
    reader: () => container.querySelector("foliate-view"),
    /** The panel a reader draws instead of a book. */
    alert: () => container.querySelector("[role='alert']"),
    /** The tree's own panel, which is where its bare keys are pressed. */
    tree: () => container.querySelector("[aria-label='Vault']") as HTMLElement,
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

// crypto finishes a digest off the event loop, which no fake timer reaches, so
// the real timer is kept from before the fakes go in.
const realTimeout = globalThis.setTimeout;

/** Let the digest of a write the route made land, which takes a real tick. */
async function hashed() {
  await act(async () => {
    await new Promise((resolve) => realTimeout(resolve, 0));
  });
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
    saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    // Reset with the rest, because `resetAllMocks` takes the answer above off
    // it and a query function answering undefined is an error rather than an
    // empty list.
    fetchTodos.mockResolvedValue([]);
    fetchBook.mockResolvedValue(new Blob(["a book"]));
    resetFoliateFake();
  });

  afterEach(() => {
    // By hand and first: unmounting flushes what the editor was holding, so
    // the automatic cleanup would reach mocks that have already been reset.
    cleanup();
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

  /** What the vault says when somebody else writes the note that is open. */
  function somebodyElseWrote() {
    act(() => stream().send({ path: "index.md", change: "written", digest: "a".repeat(64) }));
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

    // Once, on opening. Reading it again is what puts the vault's text in front
    // of the editor, and the buffer is holding words that are nowhere else.
    expect(fetchNote).toHaveBeenCalledTimes(1);
    expect(app.text()).toBe("he index note");
    expect(app.status()).toBe("Changed on disk");
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
    expect(saveNote).toHaveBeenCalledTimes(1);
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

  it("still leaves a conflicted note for a click into another pane", async () => {
    // The hole `moveTo` cannot close, pinned so that closing it later is a
    // decision somebody made rather than something that drifted. The layout
    // hears about this after the browser has moved the focus, so a refusal here
    // is a fight with the browser rather than a key declining.
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

    // The focus moved, the note it left was flushed on the way, and the vault
    // has the buffer's text over whatever the other writer put there.
    expect(app.status()).toBeUndefined();
    expect(saveNote).toHaveBeenCalledTimes(1);
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
      "\n# 2026-08-06 Thursday\n\n" +
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
    await settle();

    expect(saveNote).toHaveBeenCalledWith("index.md", "he index note");
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
    fetchBook.mockResolvedValue(new Blob(["a book"]));
    resetFoliateFake();
  });

  afterEach(() => {
    cleanup();
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

  it("follows the note when its folder moves", async () => {
    const app = await reading();
    expect(fetchBook).toHaveBeenCalledWith("20 Literature/DDIA.epub");
    moveFolder.mockResolvedValue({ path: "Literature" });
    fetchFiles.mockResolvedValue(["Literature/DDIA.md", "index.md"]);

    await renameFolder(app, "Literature");

    expect(fetchBook).toHaveBeenCalledWith("Literature/DDIA.epub");
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

  it("says its note is gone when the note alone is renamed", async () => {
    // A rename moves the note and leaves the epub where it was, so rewriting
    // `book` here would aim the reader at a file that is not the book it holds.
    const app = await reading();
    // Back to the note's own pane: a rename acts on the focused pane's note.
    app.leader("o");
    await settle();
    renameNote.mockResolvedValue({ path: "20 Literature/Designing.md", content: "# DDIA" });
    fetchFiles.mockResolvedValue(["20 Literature/Designing.md", "index.md"]);

    app.leader("r", "f");
    await settle();
    app.fill("20 Literature/Designing.md");
    await settle();

    expect(fetchBook).toHaveBeenCalledTimes(1);
    expect(app.alert()).not.toBeNull();
  });
  describe("keeping your place", () => {
    /** What the pane reports, and what the note ends up carrying. */
    const PLACE = "epubcfi(/6/4!/4/4/1:0)";

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

    // Unmounted here rather than by the hook outside, so the flush the reader's
    // own teardown runs is finished with before the mocks are reset. A write
    // left in the air lands inside the next test carrying this one's position.
    afterEach(async () => {
      cleanup();
      await settle();
    });

    /** Let the whole wait pass, and whatever it started settle. */
    async function waited() {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(WAIT);
      });
      await settle();
    }

    it("writes where the reader got to once the reading stops", async () => {
      await reading();

      turnedTo(PLACE);
      await settle();
      expect(saveNote).not.toHaveBeenCalled();

      await waited();

      expect(saveNote).toHaveBeenCalledWith(LIT, expect.stringContaining(`reading: ${PLACE}`));
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

      expect(saveNote).toHaveBeenCalledWith(LIT, expect.stringContaining(`reading: ${PLACE}`));
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

describe("putting a book beside a note", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("scrollTo", () => {});
    FakeEventSource.last = undefined;
    fetchFiles.mockResolvedValue(Object.keys(VAULT));
    fetchNote.mockImplementation(async (path: string) => VAULT[path]);
    saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
    fetchTodos.mockResolvedValue([]);
    fetchBook.mockResolvedValue(new Blob(["a book"]));
    // Re-armed with the rest: `resetAllMocks` takes the answer off it, and a
    // call that hands back undefined instead of a promise throws on `.then`.
    uploadBook.mockResolvedValue(undefined);
    resetFoliateFake();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it("blanks the picker and then opens it", async () => {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    const picker = app.picker();
    // The order, recorded through a setter spy. Asserting the value is empty
    // afterwards would pass with the blanking deleted, a file input starting
    // empty, and seeding a non-empty one is refused by the DOM. Blanking
    // matters because an input keeps the last file chosen and picking the same
    // one again may fire no `change` at all, which is the retry in user story
    // 5 doing nothing.
    const order: string[] = [];
    Object.defineProperty(picker, "value", { set: () => order.push("blank") });
    vi.spyOn(picker, "click").mockImplementation(() => {
      order.push("click");
    });

    app.leader("c", "b");

    expect(order).toEqual(["blank", "click"]);
  });

  it("does nothing at all with no note in the focused pane", async () => {
    // A guard, not a red step: the early return already does the work. It sits
    // after the implement because before it there is no input to spy on. All
    // three assertions, because "nothing threw" is not the promise.
    const app = await renderApp();
    await settle();
    const click = vi.spyOn(app.picker(), "click");

    app.leader("c", "b");
    await settle();

    expect(click).not.toHaveBeenCalled();
    expect(uploadBook).not.toHaveBeenCalled();
    expect(app.notice()).toBeNull();
  });

  it("puts the chosen file at the sidecar path, and tells the reader", async () => {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    app.leader("g", "r");
    await settle();
    // The reader opens beside the note and takes the focus with it, so the
    // focus goes back to the note before the key that needs one is pressed.
    app.focusPane(0);
    await settle();
    expect(fetchBook).toHaveBeenCalledTimes(1);
    const file = new File(["a book"], "DDIA.epub");

    app.leader("c", "b");
    app.choose(file);
    await settle();

    expect(uploadBook).toHaveBeenCalledWith("index.epub", file);
    // The `listing` event the write fires invalidates `["files"]` alone, so
    // without the invalidation a reader sitting on "no sidecar" would never
    // notice the book that just arrived.
    expect(fetchBook).toHaveBeenCalledTimes(2);
  });

  it("refuses a book over the cap without sending a byte", async () => {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    const file = new File(["a book"], "DDIA.epub");
    Object.defineProperty(file, "size", { value: ASSET_LIMIT_BYTES + 1 });

    app.leader("c", "b");
    app.choose(file);
    await settle();

    expect(uploadBook).not.toHaveBeenCalled();
    expect(app.notice()).toBe("That book is too big");
  });

  it("sends a book exactly at the cap", async () => {
    // A guard, not a red step: the check is strictly greater, so the boundary
    // passes either way. It pins the client's own boundary and says nothing
    // about production, where Cloudflare answers first.
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    const file = new File(["a book"], "DDIA.epub");
    Object.defineProperty(file, "size", { value: ASSET_LIMIT_BYTES });

    app.leader("c", "b");
    app.choose(file);
    await settle();

    expect(uploadBook).toHaveBeenCalledWith("index.epub", file);
  });

  it("puts the vault's own sentence in the bar when the upload fails", async () => {
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    uploadBook.mockRejectedValue(new Error("A book is already there"));

    app.leader("c", "b");
    app.choose(new File(["a book"], "DDIA.epub"));
    await settle();

    expect(app.notice()).toBe("A book is already there");
  });

  it("says something when the failure carries no sentence at all", async () => {
    // A `fetch` rejects on a dropped connection or a suspended tab, and there
    // is no status to name.
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    uploadBook.mockRejectedValue("no response");

    app.leader("c", "b");
    app.choose(new File(["a book"], "DDIA.epub"));
    await settle();

    expect(app.notice()).toBe("The upload failed");
  });

  it("clears the bar on the next press, picker cancelled or not", async () => {
    // A guard: the command already clears it. It earns its place anyway,
    // without it `setNotice(undefined)` can be deleted with every other test
    // still green. Pressing the key and then cancelling the picker wipes the
    // old sentence, because you asked for a fresh go at it.
    const app = await renderApp();
    await settle();
    app.click("index.md");
    await settle();
    uploadBook.mockRejectedValue(new Error("A book is already there"));
    app.leader("c", "b");
    app.choose(new File(["a book"], "DDIA.epub"));
    await settle();
    expect(app.notice()).toBe("A book is already there");

    app.leader("c", "b");
    await settle();

    expect(app.notice()).toBeNull();
  });
});
