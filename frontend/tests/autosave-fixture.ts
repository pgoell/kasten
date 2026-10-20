import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { ChangedOnDisk, saveNote } from "@/lib/api";
import { landedAs, resetHeld, useHeld } from "@/lib/held-text";
import { noteBase } from "@/lib/note-base";
import { forgetQueues, useAutosave } from "@/lib/use-autosave";

/**
 * The note as the vault holds it once `content` has been written to it.
 *
 * `PUT` stamps a fresh `modified` on the way through, so what lands on disk is
 * never the text that was sent. Every test here writes through that, because
 * the difference is what the cache and the base are about.
 */
export function written(content: string) {
  return { path: "index.md", content: `${content}\nmodified: now` };
}

/**
 * Let every promise in hand settle. A write behind another to the same note
 * goes out once the one before answers, a microtask later.
 */
export async function settled() {
  await act(async () => {});
}

/** A save the test finishes by hand, so the in-flight state can be looked at. */
export function pendingSave() {
  let settle: (() => void) | undefined;
  let fail: (() => void) | undefined;

  vi.mocked(saveNote).mockImplementationOnce(
    (_path: string, content: string) =>
      new Promise((resolve, reject) => {
        settle = () => resolve(written(content));
        fail = () => reject(new Error("PUT /api/files/index.md failed with 500"));
      }),
  );

  // A save queued behind another asks only once that one answers.
  return {
    finish: async () => {
      if (!settle) await settled();
      await act(async () => settle?.());
    },
    break: async () => {
      if (!fail) await settled();
      await act(async () => fail?.());
    },
  };
}

/**
 * The hook, following `path` in pane `a`. `shown` stands in for the focused
 * editor's document, which the route reads off the view.
 */
export function renderAutosave(
  path = "index.md",
  shown?: () => string | undefined,
  // Another hook's, for an editor mounted again on the route's own cache.
  queryClient = new QueryClient(),
) {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);

  let props = { open: path, pane: "a" };
  const { result, rerender, unmount } = renderHook(
    ({ open, pane }) => useAutosave(open, shown, pane),
    { initialProps: props, wrapper },
  );

  return {
    change: (doc: string) => act(() => result.current.change(doc)),
    save: () => act(() => result.current.save()),
    /** Start a save and leave it in flight, which is `:w` during a quiet write. */
    startSave: () => {
      act(() => {
        void result.current.save();
      });
    },
    /** Save the way a key that does something else saves, and report the answer. */
    saveFirst: async () => {
      let outcome: boolean | undefined;
      await act(async () => {
        outcome = await result.current.saveFirst();
      });
      return outcome;
    },
    /** The same, left in flight, for a test that looks before it answers. */
    askSaveFirst: () => {
      let asked: Promise<boolean> = Promise.resolve(false);
      act(() => {
        asked = result.current.saveFirst();
      });
      return asked;
    },
    /** Save, and report whether the vault ended up holding the text. */
    saved: async () => {
      let outcome: boolean | undefined;
      await act(async () => {
        outcome = await result.current.save();
      });
      return outcome;
    },
    status: () => result.current.status,
    /** Whether the buffer holds text taken from the held store. */
    restored: () => result.current.restored !== null,
    /** The held entry the buffer holds, which the bar leaves out by identity. */
    taken: () => result.current.restored,
    reason: () => result.current.reason,
    /** Ask the way the editor asks, with the text it is about to put in. */
    allowReload: (text: string) => {
      let allowed: boolean | undefined;
      act(() => {
        allowed = result.current.allowReload(text);
      });
      return allowed;
    },
    /** Whether text for `of` is on its way to the vault, as the route asks. */
    isWriting: (of: string) => result.current.isWriting(of),
    /** Throw the buffer away, which is what `:e!` does. */
    revert: (force: boolean) => {
      let done: boolean | undefined;
      act(() => {
        done = result.current.revert(force);
      });
      return done;
    },
    /** The vault reporting a write to the open note, which is all an event says. */
    reconcile: () => {
      let reload: boolean | undefined;
      act(() => {
        reload = result.current.reconcile();
      });
      return reload;
    },
    open: (next: string) => {
      props = { ...props, open: next };
      act(() => rerender(props));
    },
    /** Move the focus to pane `id`, which holds the same note. */
    focus: (id: string) => {
      props = { ...props, pane: id };
      act(() => rerender(props));
    },
    unmount: () => act(() => unmount()),
    cached: (of: string) => queryClient.getQueryData(["note", of]),
    /** Put a note in the cache, which is what an editor already open was opened on. */
    seed: (of: string, text: string) => queryClient.setQueryData(["note", of], text),
    /** The client itself, for a test that watches what the hook asks of it. */
    client: queryClient,
  };
}

/** Let the debounce elapse, and let the promise it started settle. */
export async function idle() {
  await act(async () => {
    vi.advanceTimersByTime(800);
  });
}

/**
 * A quiet save the vault refuses over its base, which is the one way a note
 * comes to stand conflicted. Wants text waiting.
 */
export async function refused() {
  vi.mocked(saveNote).mockRejectedValueOnce(new ChangedOnDisk());
  await idle();
}

/** The bar's list of held texts as it stands, one row per entry. */
export function heldRows() {
  return renderHook(() => useHeld()).result.current;
}

/** A save the test refuses by hand, the vault having moved past its base. */
export function refusedLater() {
  let refuse: (() => void) | undefined;
  vi.mocked(saveNote).mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        refuse = () => reject(new ChangedOnDisk());
      }),
  );
  return () => act(async () => refuse?.());
}

/** A reload or a closed tab, as the page hears it, and the write it starts. */
export async function pagehide() {
  await act(async () => {
    window.dispatchEvent(new Event("pagehide"));
  });
}

/** A phone sending the app to the background, which fires no `pagehide`. */
export async function background() {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

/** Registers the setup and teardown that every useAutosave test shares. */
export function eachPage() {
  beforeEach(() => {
    // The write queue is the page's, and each test is a page of its own.
    forgetQueues();
    vi.useFakeTimers();
    vi.mocked(saveNote).mockImplementation(async (_path: string, content: string) =>
      written(content),
    );
  });

  afterEach(async () => {
    // By hand and first: unmounting flushes, so the automatic cleanup would
    // otherwise reach a mock that has already been reset.
    cleanup();
    // A flush queued behind another goes out a microtask later, and would
    // otherwise reach the reset mock.
    await settled();
    vi.useRealTimers();
    vi.mocked(saveNote).mockReset();
    // After the cleanup, whose flushes may hold text of their own.
    localStorage.removeItem("kasten.held");
    localStorage.removeItem("kasten.held.2");
    resetHeld();
    // The own property a backgrounding test put over jsdom's getter.
    Reflect.deleteProperty(document, "visibilityState");
  });
}

/**
 * A vault that keeps every write apart in two steps: reaching the server,
 * which lands it or refuses it there and then, and its answer reaching the
 * page, which a page gone away never hears. Each write lands with a block
 * stamped on, as `PUT` stamps it, and a base may name the text with that
 * block set aside. A stale base over a disk that already holds the text is
 * a 200, as the backend answers it.
 */
export function server(start: string) {
  let disk = start;
  let stamps = 0;
  const body = (text: string) => text.replace(/^---\n[\s\S]*?\n---\n/, "");
  const requests: {
    content: string;
    keepalive: boolean;
    base?: string;
    arrive: () => void;
    answer: () => void;
    fail: () => void;
  }[] = [];
  vi.mocked(saveNote).mockImplementation(
    (_path: string, content: string, keepalive = false, base?: string) =>
      new Promise((resolve, reject) => {
        let outcome: (() => void) | undefined;
        requests.push({
          content,
          keepalive,
          base,
          arrive: () => {
            if (base !== undefined && base !== noteBase(disk) && base !== noteBase(body(disk))) {
              const now = disk;
              outcome = landedAs(content, now)
                ? () => resolve({ path: "index.md", content: now })
                : () => reject(new ChangedOnDisk());
              return;
            }
            stamps += 1;
            disk = `---\nmodified: ${stamps}\n---\n${content}`;
            const now = disk;
            outcome = () => resolve({ path: "index.md", content: now });
          },
          answer: () => outcome?.(),
          fail: () => reject(new Error("PUT /api/files/index.md failed with 500")),
        });
      }),
  );
  return {
    disk: () => disk,
    /** Somebody else's write. */
    write: (text: string) => {
      disk = text;
    },
    request: (at: number) => requests[at],
    /** The write reaches the server, and the page hears nothing back. */
    arrive: async (at: number) => {
      await settled();
      requests[at]?.arrive();
    },
    /** The write reaches the server and its answer reaches the page. */
    land: async (at: number) => {
      await settled();
      requests[at]?.arrive();
      await act(async () => requests[at]?.answer());
      await settled();
    },
    /** The write fails on the way with no word from the vault. */
    fail: async (at: number) => {
      await settled();
      await act(async () => requests[at]?.fail());
      await settled();
    },
  };
}

/** The hook with an editor on `index.md`, as in the blocks above. */
export function withEditor(seed: string) {
  let doc = seed;
  const note = renderAutosave("index.md", () => doc);
  note.seed("index.md", seed);
  let seen: unknown = seed;
  return {
    note,
    type: (text: string) => {
      doc = text;
      note.change(text);
    },
    look: () => {
      const now = note.cached("index.md");
      if (now === seen || typeof now !== "string") return;
      seen = now;
      if (note.allowReload(now)) doc = now;
    },
    outside: (text: string) => {
      note.seed("index.md", text);
      seen = text;
      if (note.allowReload(text)) doc = text;
    },
    /** `:e!`: the route reads the vault into the cache, then asks. */
    discard: (text: string) => {
      note.seed("index.md", text);
      note.revert(true);
      doc = text;
      seen = text;
    },
    /** What the focused editor shows, set by hand. */
    show: (text: string) => {
      doc = text;
      seen = text;
    },
    shown: () => doc,
  };
}

/** The note opened again on a new page, its editor showing `doc`. */
export function reopen(text: string, doc: string) {
  // None of the old page's writes, which died with it.
  forgetQueues();
  const again = renderAutosave("index.md", () => doc);
  again.seed("index.md", text);
  again.allowReload(text);
  return again;
}

// The editor's `pagehide` listener goes with the route, so a page closed
// after the leave hears nothing: what is held at the leave is all there is.
export const left = (content: string, base = "start") => ({
  content,
  reason: "Not yet written when the note was left",
  conflicted: false,
  base,
});

/** The editor mounted again on the route's cache, which the leave put T1 in. */
export const cameBack = (note: ReturnType<typeof renderAutosave>, path = "index.md") => {
  let doc = String(note.cached(path));
  const again = renderAutosave(path, () => doc, note.client);
  again.allowReload(doc);
  return {
    again,
    type: (text: string) => {
      doc = text;
      again.change(text);
    },
    show: (text: string) => {
      doc = text;
    },
  };
};
