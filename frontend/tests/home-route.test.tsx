import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { VaultEvent } from "@/lib/vault-events";
import { routeTree } from "@/routeTree.gen";

/**
 * The route itself, mounted, because its own lines are what nothing else pins.
 *
 * Every other file here renders one component or one hook, and this project
 * kept falling into the seam that leaves: the pieces each well pinned and the
 * wiring between them not pinned at all. Four lines of `routes/index.tsx`
 * decide whether a write from outside can take a reader's unsaved text, and
 * every one of them could be reverted with the whole suite green. Each test
 * below kills one of those four. Extracting the decisions into pure functions
 * would not have done it, because what survives the mutation is the call and
 * not the callee.
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

const { fetchFiles, fetchNote, saveNote, searchNotes, createNote, renameNote, moveFolder } =
  vi.hoisted(() => ({
    fetchFiles: vi.fn(),
    fetchNote: vi.fn(),
    saveNote: vi.fn(),
    searchNotes: vi.fn(),
    createNote: vi.fn(),
    renameNote: vi.fn(),
    moveFolder: vi.fn(),
  }));
vi.mock("@/lib/api", () => ({
  fetchFiles,
  fetchNote,
  saveNote,
  searchNotes,
  createNote,
  renameNote,
  moveFolder,
}));

const VAULT: Record<string, string> = {
  "index.md": "the index note",
  "other.md": "the other note",
};

/** The vault's stream, opened by the route and driven by the test. */
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

/** Mount the app the way `main.tsx` does, over a history that is not a browser. */
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
    /** Open a note the way a reader does, by clicking its row in the tree. */
    click: (path: string) =>
      fireEvent.click(container.querySelector(`[title='${path}']`) as HTMLElement),
    text: () => editor().textContent,
    status: () =>
      container.querySelector("[data-testid='save-status']")?.getAttribute("aria-label"),
    /** How many tabs the strip draws, which is none until there are two. */
    tabs: () => container.querySelectorAll("[role='tab']").length,
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
});
