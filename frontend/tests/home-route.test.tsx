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
  fetchTerminals,
  fetchTodos,
} = vi.hoisted(() => ({
  fetchFiles: vi.fn(),
  fetchNote: vi.fn(),
  saveNote: vi.fn(),
  searchNotes: vi.fn(),
  createNote: vi.fn(),
  renameNote: vi.fn(),
  moveFolder: vi.fn(),
  // The terminal prompt asks for these when it opens. No route test opens
  // it, so an empty list is the whole of what this has to answer.
  fetchTerminals: vi.fn().mockResolvedValue([]),
  // The todo pane asks for these the moment it opens. Nothing here is about
  // what the vault holds to do, so an empty list is the whole of the answer.
  fetchTodos: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/api", () => ({
  fetchFiles,
  fetchNote,
  saveNote,
  searchNotes,
  createNote,
  renameNote,
  moveFolder,
  fetchTerminals,
  fetchTodos,
}));

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
    /** The row being edited in the pane, as the input it turns into. */
    editedLine: () => container.querySelector("[aria-label='edit line']"),
    /** How many panes the active tab draws. */
    panes: () => container.querySelectorAll("[data-pane]").length,
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
    // Reset with the rest, because `resetAllMocks` takes the answer above off
    // it and a query function answering undefined is an error rather than an
    // empty list.
    fetchTodos.mockResolvedValue([]);
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
});
