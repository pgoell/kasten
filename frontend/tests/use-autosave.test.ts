import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { ChangedOnDisk } from "@/lib/api";
import {
  heldText,
  heldTexts,
  holdText,
  landedAs,
  moveHeld,
  resetHeld,
  useHeld,
} from "@/lib/held-text";
import { noteBase } from "@/lib/note-base";
import { forgetQueues, useAutosave } from "@/lib/use-autosave";

const { saveNote, fetchNote } = vi.hoisted(() => ({ saveNote: vi.fn(), fetchNote: vi.fn() }));
// The real refusal, which the hook tells apart from every other failure.
vi.mock("@/lib/api", async (importOriginal) => ({
  saveNote,
  fetchNote,
  ChangedOnDisk: (await importOriginal<typeof import("@/lib/api")>()).ChangedOnDisk,
}));

/**
 * The note as the vault holds it once `content` has been written to it.
 *
 * `PUT` stamps a fresh `modified` on the way through, so what lands on disk is
 * never the text that was sent. Every test here writes through that, because
 * the difference is what the cache and the base are about.
 */
function written(content: string) {
  return { path: "index.md", content: `${content}\nmodified: now` };
}

/**
 * Let every promise in hand settle. A write behind another to the same note
 * goes out once the one before answers, a microtask later.
 */
async function settled() {
  await act(async () => {});
}

/** A save the test finishes by hand, so the in-flight state can be looked at. */
function pendingSave() {
  let settle: (() => void) | undefined;
  let fail: (() => void) | undefined;

  saveNote.mockImplementationOnce(
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
function renderAutosave(
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
async function idle() {
  await act(async () => {
    vi.advanceTimersByTime(800);
  });
}

/**
 * A quiet save the vault refuses over its base, which is the one way a note
 * comes to stand conflicted. Wants text waiting.
 */
async function refused() {
  saveNote.mockRejectedValueOnce(new ChangedOnDisk());
  await idle();
}

/** The bar's list of held texts as it stands, one row per entry. */
function heldRows() {
  return renderHook(() => useHeld()).result.current;
}

/** A save the test refuses by hand, the vault having moved past its base. */
function refusedLater() {
  let refuse: (() => void) | undefined;
  saveNote.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        refuse = () => reject(new ChangedOnDisk());
      }),
  );
  return () => act(async () => refuse?.());
}

/** A reload or a closed tab, as the page hears it, and the write it starts. */
async function pagehide() {
  await act(async () => {
    window.dispatchEvent(new Event("pagehide"));
  });
}

/** A phone sending the app to the background, which fires no `pagehide`. */
async function background() {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

describe("useAutosave", () => {
  beforeEach(() => {
    // The write queue is the page's, and each test is a page of its own.
    forgetQueues();
    vi.useFakeTimers();
    saveNote.mockImplementation(async (_path: string, content: string) => written(content));
  });

  afterEach(async () => {
    // By hand and first: unmounting flushes, so the automatic cleanup would
    // otherwise reach a mock that has already been reset.
    cleanup();
    // A flush queued behind another goes out a microtask later, and would
    // otherwise reach the reset mock.
    await settled();
    vi.useRealTimers();
    saveNote.mockReset();
    // After the cleanup, whose flushes may hold text of their own.
    localStorage.removeItem("kasten.held");
    localStorage.removeItem("kasten.held.2");
    resetHeld();
    // The own property a backgrounding test put over jsdom's getter.
    Reflect.deleteProperty(document, "visibilityState");
  });

  it("holds the text back until the typing stops", async () => {
    const note = renderAutosave();

    note.change("# edited");
    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    expect(saveNote).not.toHaveBeenCalled();
    expect(note.status()).toBe("unsaved");
  });

  it("writes once the typing stops", async () => {
    const note = renderAutosave();

    note.change("# edited");
    await idle();

    expect(saveNote).toHaveBeenCalledWith("index.md", "# edited");
    expect(note.status()).toBe("saved");
  });

  it("folds a burst of keystrokes into one write", async () => {
    const note = renderAutosave();

    note.change("# e");
    note.change("# ed");
    note.change("# edited");
    await idle();

    expect(saveNote).toHaveBeenCalledOnce();
    expect(saveNote).toHaveBeenCalledWith("index.md", "# edited");
  });

  it("writes at once when asked to", async () => {
    const note = renderAutosave();

    note.change("# edited");
    await act(async () => note.save());

    expect(saveNote).toHaveBeenCalledWith("index.md", "# edited");
  });

  it("does not write when there is nothing to write", async () => {
    const note = renderAutosave();

    await act(async () => note.save());
    await idle();

    expect(saveNote).not.toHaveBeenCalled();
    expect(note.status()).toBe("saved");
  });

  it("says it is saving while the write is in flight", async () => {
    const note = renderAutosave();
    const write = pendingSave();

    note.change("# edited");
    await idle();
    expect(note.status()).toBe("saving");

    await write.finish();

    expect(note.status()).toBe("saved");
  });

  it("writes pending text to the note it was typed into, not the one just opened", async () => {
    // NoteEditor is not remounted when the path changes, so a timer left
    // running would fire with the new path and the old text.
    const note = renderAutosave("index.md");

    note.change("# edited");
    note.open("daily/2026-08-05.md");

    expect(saveNote).toHaveBeenCalledWith("index.md", "# edited");
  });

  it("writes pending text when the editor goes away", async () => {
    const note = renderAutosave();

    note.change("# edited");
    note.unmount();

    expect(saveNote).toHaveBeenCalledWith("index.md", "# edited");
  });

  it("puts the note the vault wrote in the cache, not the text that was sent", async () => {
    // The editor reloads from this cache, so a cache one stamp behind disk is
    // a note that replaces itself under the reader after every single save.
    const note = renderAutosave();

    note.change("# edited");
    await idle();

    expect(note.cached("index.md")).toBe(written("# edited").content);
  });

  it("leaves the cache alone when newer text was typed during the write", async () => {
    // The editor reloads from this cache too, so putting the text that was in
    // the air into it takes the newer keystrokes off screen.
    const note = renderAutosave();
    const write = pendingSave();

    note.change("# edited");
    await idle();
    note.change("# edited again");
    await write.finish();

    expect(note.cached("index.md")).toBeUndefined();
  });

  it("does not call itself saved while newer text is waiting", async () => {
    const note = renderAutosave();
    const write = pendingSave();

    note.change("# edited");
    await idle();
    note.change("# edited again");
    await write.finish();

    expect(note.status()).toBe("unsaved");
  });

  it("reports success when there was nothing to write", async () => {
    const note = renderAutosave();

    expect(await note.saved()).toBe(true);
  });

  it("reports success once the write lands", async () => {
    const note = renderAutosave();

    note.change("# edited");

    expect(await note.saved()).toBe(true);
  });

  it("reports failure when the write is refused", async () => {
    const note = renderAutosave();
    saveNote.mockRejectedValueOnce(new Error("PUT /api/files/index.md failed with 500"));

    note.change("# edited");

    expect(await note.saved()).toBe(false);
  });

  it("keeps the text when the write fails, and retries on the next save", async () => {
    const note = renderAutosave();
    const write = pendingSave();

    note.change("# edited");
    await idle();
    await write.break();
    expect(note.status()).toBe("error");

    await act(async () => note.save());

    expect(saveNote).toHaveBeenLastCalledWith("index.md", "# edited");
    expect(note.status()).toBe("saved");
  });

  it("keeps why the write failed, and drops it once one goes through", async () => {
    // The status says a write failed; only this says what the vault answered,
    // which is the difference between a retry and a look at the server.
    const note = renderAutosave();
    const write = pendingSave();

    note.change("# edited");
    await idle();
    await write.break();
    expect(note.reason()).toBe("PUT /api/files/index.md failed with 500");

    await act(async () => note.save());

    expect(note.reason()).toBeUndefined();
  });

  it("marks nothing when its own write comes back while the typing goes on", async () => {
    // Every write comes back over the stream, this hook's included. The buffer
    // keeps its text, and the next save names what the last one landed as.
    const note = renderAutosave();

    note.change("# edited");
    await idle();
    note.change("# edited more");

    expect(note.reconcile()).toBe(false);
    expect(note.status()).toBe("unsaved");
    await idle();
    expect(saveNote).toHaveBeenLastCalledWith(
      "index.md",
      "# edited more",
      false,
      noteBase(written("# edited").content),
    );
    expect(note.status()).toBe("saved");
  });

  it("asks for the reload when the buffer holds nothing unwritten", async () => {
    const note = renderAutosave();

    expect(note.reconcile()).toBe(true);
    expect(note.status()).toBe("saved");
  });

  it("keeps saying so while the note is typed into", async () => {
    // Typing does not settle anything: the vault still holds text this buffer
    // never saw, and a reading of `unsaved` would promise a write that the
    // quiet period no longer makes.
    const note = renderAutosave();

    note.change("# edited");
    await refused();
    note.change("# edited more");

    expect(note.status()).toBe("conflict");
  });

  it("writes nothing on the quiet period while the note stands conflicted", async () => {
    const note = renderAutosave();

    note.change("# edited");
    await refused();
    note.change("# edited more");
    await idle();

    expect(saveNote).toHaveBeenCalledOnce();
    expect(note.status()).toBe("conflict");
  });

  it("overwrites the vault when saved by hand, which is what clears the conflict", async () => {
    // `:w` is the reader deciding, and the only way past a conflict. The text
    // it keeps is theirs, not the vault's.
    const note = renderAutosave();

    note.change("# edited");
    await refused();
    await act(async () => note.save());

    expect(saveNote).toHaveBeenLastCalledWith("index.md", "# edited");
    expect(note.status()).toBe("saved");

    // And the quiet period writes again afterwards. A conflict left standing
    // stops every automatic write there is, and the bar would go on reading
    // `Saved` while nothing at all reached the vault.
    note.change("# edited again");
    await idle();
    await settled();

    expect(saveNote).toHaveBeenLastCalledWith(
      "index.md",
      "# edited again",
      false,
      noteBase(written("# edited").content),
    );
    expect(note.status()).toBe("saved");
  });

  it("clears a conflict when the vault comes to hold the buffer's text", async () => {
    const note = renderAutosave();

    note.change("# edited");
    await refused();
    expect(note.status()).toBe("conflict");

    expect(note.allowReload("# edited")).toBe(true);
    expect(note.status()).toBe("saved");
    expect(heldText("index.md")).toBeUndefined();
    await idle();
    expect(saveNote).toHaveBeenCalledOnce();
  });

  it("keeps a held entry the buffer never showed when the vault comes to hold the buffer's text", async () => {
    const note = renderAutosave("index.md");
    const flush = pendingSave();

    note.change("# typed");
    note.open("daily/2026-08-05.md");
    note.open("index.md");
    // Refused a take while the flush is in the air, so the buffer never shows it.
    expect(note.allowReload("the index note")).toBe(true);
    note.change("# typed more");
    await flush.break();
    expect(heldText("index.md")?.content).toBe("# typed");

    expect(note.allowReload("# typed more")).toBe(true);
    expect(heldText("index.md")?.content).toBe("# typed");
  });

  it("takes anything from the vault while nothing is waiting", async () => {
    const note = renderAutosave();

    expect(note.allowReload("# somebody else wrote this")).toBe(true);
    expect(note.status()).toBe("saved");
  });

  it("takes nothing from the vault while text is waiting, and marks nothing", async () => {
    const note = renderAutosave();

    note.change("# edited");

    expect(note.allowReload("# somebody else wrote this")).toBe(false);
    expect(note.status()).toBe("unsaved");
  });

  it("says nothing when the text waiting to go out beat its own last write here", async () => {
    // The answer to our own `PUT`, arriving a keystroke late. Every save moves
    // the cache, so this is every save the reader typed through, and calling it
    // a conflict would stop the autosave of somebody who did nothing but type.
    const note = renderAutosave();

    note.change("# edited");
    await idle();
    note.change("# edited more");

    expect(note.allowReload(written("# edited").content)).toBe(false);
    expect(note.status()).toBe("unsaved");
  });

  it("writes on the way to another command when nothing is in conflict", async () => {
    const note = renderAutosave();

    note.change("# edited");

    expect(await note.saveFirst()).toBe(true);
    expect(saveNote).toHaveBeenCalledWith("index.md", "# edited");
  });

  it("writes nothing on the way to another command while the note stands conflicted", async () => {
    // Closing the note, moving it, moving a folder above it, reading its
    // links: all of them save first, and none of them was pressed to decide
    // that the buffer beats what the vault now holds.
    const note = renderAutosave();

    note.change("# edited");
    await refused();

    expect(await note.saveFirst()).toBe(false);
    expect(saveNote).toHaveBeenCalledOnce();
    expect(note.status()).toBe("conflict");
  });
  it("says a write is in the air for the note it was typed into", async () => {
    // Off a count of its own and not off `pending`, which `save` empties on the
    // way out: a note whose text is between the keyboard and the disk would
    // otherwise read as clean.
    const note = renderAutosave();
    const write = pendingSave();

    note.change("# edited");
    await idle();
    expect(note.isWriting("index.md")).toBe(true);

    await write.finish();

    expect(note.isWriting("index.md")).toBe(false);
  });

  it("counts the writes rather than flagging them", async () => {
    // `:w` during a quiet write puts two in the air for one note, and the first
    // to answer must not read as the last. A flag passes every other case here.
    const note = renderAutosave();
    const quiet = pendingSave();
    const asked = pendingSave();

    note.change("# edited");
    await idle();
    note.change("# edited again");
    note.startSave();
    await quiet.finish();
    // `:w` goes out once the quiet write lands, naming its hash.
    await settled();
    expect(note.isWriting("index.md")).toBe(true);

    await asked.finish();

    expect(note.isWriting("index.md")).toBe(false);
  });

  it("answers about the note named, not about the one it is following", async () => {
    // The tail this exists for: moving to another pane flushes the note being
    // left, and the hook's own path has moved on while that write is still out.
    const note = renderAutosave("index.md");
    const write = pendingSave();

    note.change("# edited");
    note.open("daily/2026-08-05.md");

    expect(note.isWriting("index.md")).toBe(true);
    expect(note.isWriting("daily/2026-08-05.md")).toBe(false);
    await write.finish();
    expect(note.isWriting("index.md")).toBe(false);
  });

  it("says nothing is in the air after a write that failed on discarded text", async () => {
    // The failure arm returns early once the reader has thrown the text away,
    // so a count lowered at the end of it leaks for the life of the page and
    // that note is never bookmarked again.
    const note = renderAutosave();
    const write = pendingSave();

    note.change("# edited");
    await idle();
    note.revert(true);
    await write.break();

    expect(note.isWriting("index.md")).toBe(false);
  });
  it("names the new note's own save as its base when the old note's flush answers late", async () => {
    // The flush of the note left behind answers with the closure of that note,
    // after the hook already follows the next one. Taking `onDisk` there would
    // name the old note's text as the new one's base, and the vault refuses.
    const note = renderAutosave("index.md");
    const flush = pendingSave();

    note.change("# left behind");
    note.open("daily/2026-08-05.md");
    note.change("# daily");
    await note.save();
    await flush.finish();
    note.change("# daily more");
    await idle();

    expect(saveNote).toHaveBeenLastCalledWith(
      "daily/2026-08-05.md",
      "# daily more",
      false,
      noteBase(written("# daily").content),
    );
    expect(note.status()).toBe("saved");
  });

  it("leaves the next note alone when the old note's flush fails and it is left untouched", async () => {
    // The failure arm used to keep the text for a retry, but the retry runs
    // with the next note's closure: the old note's words would land in it.
    const note = renderAutosave("index.md");
    const flush = pendingSave();

    note.change("# left behind");
    note.open("daily/2026-08-05.md");
    await flush.break();
    note.unmount();

    expect(saveNote).toHaveBeenCalledOnce();
    expect(saveNote).toHaveBeenCalledWith("index.md", "# left behind");
  });

  it("leaves the next note alone when the old note's flush fails and it is saved", async () => {
    const note = renderAutosave("index.md");
    const flush = pendingSave();

    note.change("# left behind");
    note.open("daily/2026-08-05.md");
    await flush.break();
    await note.save();

    expect(saveNote).toHaveBeenCalledOnce();
    expect(saveNote).not.toHaveBeenCalledWith("daily/2026-08-05.md", expect.anything());
  });

  it("holds the left note's text when the flush on the way out fails", async () => {
    // The held list in the bar reports it; the note on screen is not the one
    // whose text the vault refused, so its own reading stays its own.
    const note = renderAutosave("index.md");
    saveNote.mockRejectedValueOnce(new Error("failed with 500"));

    note.change("# left behind");
    note.open("daily/2026-08-05.md");
    await act(async () => {});

    expect(heldText("index.md")).toEqual({
      content: "# left behind",
      reason: "failed with 500",
      conflicted: false,
    });
    expect(note.status()).toBe("saved");
    expect(note.reason()).toBeUndefined();
  });

  it("still holds the left note's text when the next note was reverted meanwhile", async () => {
    // `:e!` on the next note throws away that note's text, not the old one's.
    const note = renderAutosave("index.md");
    const flush = pendingSave();

    note.change("# left behind");
    note.open("daily/2026-08-05.md");
    note.revert(true);
    await flush.break();

    expect(heldText("index.md")?.content).toBe("# left behind");
  });

  it("keeps the next note's own failure alone when the old note's flush fails", async () => {
    // The next note's text is still waiting and `:w` would write it, so the
    // bar must go on offering that, its reason the next note's alone.
    const note = renderAutosave("index.md");
    const flush = pendingSave();

    note.change("# left behind");
    note.open("daily/2026-08-05.md");
    saveNote.mockRejectedValueOnce(new Error("PUT /api/files/daily/2026-08-05.md failed with 500"));
    note.change("# daily");
    await idle();
    expect(note.status()).toBe("error");
    await flush.break();

    expect(note.status()).toBe("error");
    expect(note.reason()).toBe("PUT /api/files/daily/2026-08-05.md failed with 500");
    expect(heldText("index.md")?.content).toBe("# left behind");
  });

  it("keeps the next note's conflict alone when the old note's flush fails", async () => {
    // The conflict holds every write back, so a bar reading `error` instead
    // would hide the one thing the reader has to settle with `:w`.
    const note = renderAutosave("index.md");
    const flush = pendingSave();

    note.change("# left behind");
    note.open("daily/2026-08-05.md");
    note.change("# daily");
    await refused();
    await flush.break();

    expect(note.status()).toBe("conflict");
    expect(heldText("index.md")?.content).toBe("# left behind");
  });

  it("keeps the left note's held text through a save in the next note", async () => {
    const note = renderAutosave("index.md");
    saveNote.mockRejectedValueOnce(new Error("failed with 500"));

    note.change("# left behind");
    note.open("daily/2026-08-05.md");
    await act(async () => {});
    note.change("# daily");
    await idle();

    expect(saveNote).toHaveBeenLastCalledWith("daily/2026-08-05.md", "# daily");
    expect(note.status()).toBe("saved");
    expect(heldText("index.md")?.content).toBe("# left behind");
  });

  it("holds the text when the flush on unmount fails", async () => {
    // Leaving the editor route unmounts the hook with the visit unchanged, so
    // the failure lands in the arm for the note on screen, with nobody left.
    const note = renderAutosave("index.md");
    saveNote.mockRejectedValueOnce(new Error("failed with 502"));

    note.change("# typed");
    note.unmount();
    await act(async () => {});

    expect(heldText("index.md")).toEqual({
      content: "# typed",
      reason: "failed with 502",
      conflicted: false,
    });
  });

  it("holds a write that fails after its note moved under the new path", async () => {
    // The route follows a move with `moveHeld` and opens the note at its new
    // path, both before the write in the air answers.
    const note = renderAutosave("index.md");
    const write = pendingSave();

    note.change("# edited");
    await idle();
    moveHeld((path) => (path === "index.md" ? "moved.md" : undefined));
    note.open("moved.md");
    await write.break();

    expect(heldText("index.md")).toBeUndefined();
    expect(heldText("moved.md")).toMatchObject({ content: "# edited" });
  });

  it("drops the held entry a move carried when the write in the air lands", async () => {
    const note = renderAutosave("index.md");
    const write = pendingSave();

    // What a hide holds of a quiet write still in the air.
    holdText("index.md", { content: "# edited", reason: "hidden", conflicted: false });
    note.change("# edited");
    await idle();
    moveHeld((path) => (path === "index.md" ? "moved.md" : undefined));
    note.open("moved.md");
    await write.finish();

    expect(heldText("moved.md")).toBeUndefined();
  });

  it("holds a conflicted note as conflicted on leaving, with no flush to fail", async () => {
    // Leaving a conflicted note writes nothing over the vault: the text goes to
    // the held store, and the reader decides on return.
    const note = renderAutosave("index.md");

    note.change("# mine");
    await refused();
    note.change("# mine, more");
    note.open("daily/2026-08-05.md");
    await act(async () => {});

    expect(saveNote).toHaveBeenCalledOnce();
    expect(heldText("index.md")).toMatchObject({
      content: "# mine, more",
      reason: "Changed on disk before the note was left",
      conflicted: true,
    });
  });

  it("holds a conflicted note's text and writes nothing when another note is opened", async () => {
    const note = renderAutosave("index.md");

    note.change("# mine");
    await refused();
    note.open("daily/2026-08-05.md");
    await act(async () => {});

    expect(saveNote).toHaveBeenCalledOnce();
    expect(heldText("index.md")).toMatchObject({ content: "# mine", conflicted: true });
    expect(note.status()).toBe("saved");
  });

  it("holds a conflicted note's text and writes nothing when the editor goes away", async () => {
    const note = renderAutosave("index.md");

    note.change("# mine");
    await refused();
    note.unmount();
    await act(async () => {});

    expect(saveNote).toHaveBeenCalledOnce();
    expect(heldText("index.md")).toMatchObject({ content: "# mine", conflicted: true });
  });

  it("reopens a conflicted note left behind as a conflict, and writes nothing on the quiet period", async () => {
    const note = renderAutosave("index.md");
    note.seed("index.md", "the index note");

    note.change("# mine");
    await refused();
    note.open("daily/2026-08-05.md");
    note.open("index.md");
    expect(note.allowReload("the index note")).toBe(false);
    await idle();

    expect(saveNote).toHaveBeenCalledOnce();
    expect(note.status()).toBe("conflict");
  });

  it("writes the kept text with :w after a conflicted note is reopened, and drops the held entry", async () => {
    const note = renderAutosave("index.md");
    note.seed("index.md", "the index note");

    note.change("# mine");
    await refused();
    note.open("daily/2026-08-05.md");
    note.open("index.md");
    note.allowReload("the index note");
    expect(saveNote).toHaveBeenCalledOnce();

    expect(await note.saved()).toBe(true);
    expect(saveNote).toHaveBeenLastCalledWith("index.md", "# mine");
    expect(heldText("index.md")).toBeUndefined();
    expect(note.status()).toBe("saved");
  });

  it("drops a reopened conflict's held text when the vault's read equals it", async () => {
    // Somebody wrote the kept text into the vault before the reopen: the
    // reopen takes it against the stale cache, and the fresh read settles it.
    const note = renderAutosave("index.md");
    note.seed("index.md", "the index note");

    note.change("# mine");
    await refused();
    note.open("daily/2026-08-05.md");
    note.open("index.md");
    expect(note.allowReload("the index note")).toBe(false);
    expect(note.status()).toBe("conflict");

    expect(note.allowReload("# mine")).toBe(true);
    expect(note.status()).toBe("saved");
    expect(heldText("index.md")).toBeUndefined();
    await idle();
    expect(saveNote).toHaveBeenCalledOnce();
  });

  it("puts held text back in the buffer when its note is reopened", async () => {
    const note = renderAutosave("index.md");
    saveNote.mockRejectedValueOnce(new Error("failed with 500"));
    note.change("# left behind");
    note.open("daily/2026-08-05.md");
    await act(async () => {});

    note.open("index.md");
    // The editor opens on the held text and asks about the vault's.
    expect(note.allowReload("the index note")).toBe(false);

    expect(note.status()).toBe("error");
    expect(note.reason()).toBe("failed with 500");
    expect(await note.saved()).toBe(true);
    expect(saveNote).toHaveBeenLastCalledWith("index.md", "# left behind");
    expect(heldText("index.md")).toBeUndefined();
  });

  it("keeps a flush that fails after its note was reopened through the next save of that note", async () => {
    // The reader came back before the flush answered, so the buffer holds the
    // vault's text and not the refused one: a save of that buffer says nothing
    // about the held text, which is still nowhere else.
    const note = renderAutosave("index.md");
    const flush = pendingSave();
    note.change("# left behind");
    note.open("daily/2026-08-05.md");
    note.open("index.md");
    await flush.break();
    expect(note.restored()).toBe(false);

    // A reload asked after the failure finds a buffer that never showed it.
    expect(note.allowReload("the index note\nmore")).toBe(true);
    note.change("# typed after coming back");
    await idle();
    await settled();

    expect(saveNote).toHaveBeenLastCalledWith(
      "index.md",
      "# typed after coming back",
      false,
      noteBase("the index note\nmore"),
    );
    expect(note.status()).toBe("saved");
    expect(heldText("index.md")?.content).toBe("# left behind");
  });

  it("writes nothing on hide while reopened held text is untouched", async () => {
    holdText("index.md", { content: "# held", reason: "failed with 500", conflicted: false });
    const note = renderAutosave("index.md");
    note.allowReload("the index note");
    expect(note.restored()).toBe(true);

    await pagehide();
    expect(saveNote).not.toHaveBeenCalled();
    expect(heldText("index.md")?.reason).toBe("failed with 500");

    // Typed into, it is the reader's text again, and the hide writes it.
    note.change("# held and more");
    await pagehide();
    expect(saveNote).toHaveBeenCalledWith("index.md", "# held and more", true);
    expect(heldText("index.md")).toBeUndefined();
  });

  it("takes held text back when the focus returns to a pane still showing it", async () => {
    // A split: the note's editor stayed mounted while the focus was elsewhere,
    // so it asks nothing about the vault's text on the way back.
    const note = renderAutosave("daily/2026-08-05.md", () => "# held");
    note.seed("index.md", "the index note");
    holdText("index.md", { content: "# held", reason: "failed with 500", conflicted: false });

    note.open("index.md");

    expect(note.status()).toBe("error");
    expect(await note.saved()).toBe(true);
    expect(saveNote).toHaveBeenLastCalledWith(
      "index.md",
      "# held",
      false,
      noteBase("the index note"),
    );
  });

  it("leaves held text listed when the focus moves to a pane showing the vault's text", async () => {
    // The note open in a second pane that never showed the refused text:
    // taking it into `pending` there would send the vault's text plus a key.
    const note = renderAutosave("daily/2026-08-05.md", () => "the index note");
    note.seed("index.md", "the index note");
    holdText("index.md", { content: "# held", reason: "failed with 500", conflicted: false });

    note.open("index.md");
    note.change("the index note!");
    await idle();
    await settled();

    expect(note.restored()).toBe(false);
    expect(saveNote).toHaveBeenLastCalledWith(
      "index.md",
      "the index note!",
      false,
      noteBase("the index note"),
    );
    expect(heldText("index.md")?.content).toBe("# held");
  });

  it("leaves held text listed through an outside write to a pane showing the vault's text", async () => {
    const note = renderAutosave("daily/2026-08-05.md", () => "the index note");
    note.seed("index.md", "the index note");
    holdText("index.md", { content: "# held", reason: "failed with 500", conflicted: false });
    note.open("index.md");

    // Somebody else writes the note; the clean buffer takes it.
    expect(note.allowReload("somebody else's note")).toBe(true);

    expect(note.restored()).toBe(false);
    expect(note.status()).toBe("saved");
    expect(heldText("index.md")?.content).toBe("# held");
  });

  /** Pane `a` showing text held for index.md, taken into the buffer. */
  function showingHeld() {
    const screen = { doc: "# held" };
    holdText("index.md", { content: "# held", reason: "failed with 500", conflicted: false });
    const note = renderAutosave("index.md", () => screen.doc);
    note.seed("index.md", "the index note");
    expect(note.allowReload("the index note")).toBe(false);
    expect(note.restored()).toBe(true);
    // Pane `b` on the same note shows the vault's text.
    screen.doc = "the index note";
    return note;
  }

  it("keeps held text one pane showed when the reader types in a second pane on the same note", async () => {
    const note = showingHeld();

    note.focus("b");
    note.change("the index note!");
    await idle();
    await settled();

    // The switch is a leave: pane `a`'s text goes out with it.
    expect(saveNote).toHaveBeenCalledWith("index.md", "# held", false, noteBase("the index note"));
    expect(saveNote).toHaveBeenLastCalledWith(
      "index.md",
      "the index note!",
      false,
      noteBase("the index note"),
    );
  });

  it("keeps held text one pane showed when the reader saves in a second pane on the same note", async () => {
    const note = showingHeld();

    note.focus("b");
    note.change("the index note!");
    await note.save();
    await settled();

    expect(saveNote).toHaveBeenCalledWith("index.md", "# held", false, noteBase("the index note"));
    expect(saveNote).toHaveBeenLastCalledWith(
      "index.md",
      "the index note!",
      false,
      noteBase("the index note"),
    );
  });

  it("writes a first pane's unsaved text before a second pane on the same note types", async () => {
    const screen = { doc: "the index note" };
    const note = renderAutosave("index.md", () => screen.doc);
    note.seed("index.md", "the index note");
    expect(note.allowReload("the index note")).toBe(true);

    note.change("pane a's text");
    // Inside the quiet period.
    note.focus("b");
    note.change("pane b's text");
    await idle();
    await settled();

    expect(saveNote).toHaveBeenCalledWith(
      "index.md",
      "pane a's text",
      false,
      noteBase("the index note"),
    );
    // Typed on the vault's text, which pane `a`'s write has moved past: the
    // vault's refusal decides.
    expect(saveNote).toHaveBeenLastCalledWith(
      "index.md",
      "pane b's text",
      false,
      noteBase("the index note"),
    );
  });

  it("sends nothing on a pane switch on the same note with nothing waiting", async () => {
    const note = renderAutosave("index.md", () => "the index note");
    note.seed("index.md", "the index note");
    expect(note.allowReload("the index note")).toBe(true);

    note.focus("b");
    await idle();
    await settled();

    expect(saveNote).not.toHaveBeenCalled();
    expect(note.status()).toBe("saved");
  });

  it("reopens held text as an error, not a conflict, when the last write landed while typing went on", async () => {
    const left = renderAutosave("index.md");
    left.seed("index.md", "the index note");
    const first = pendingSave();
    left.change("a");
    await idle();
    left.change("ab");
    await first.finish();
    // The cache still holds the note from before the write, which landed.
    expect(left.cached("index.md")).toBe("the index note");
    saveNote.mockRejectedValue(new TypeError("Failed to fetch"));
    await pagehide();
    left.unmount();
    await act(async () => {});

    const note = renderAutosave("index.md");
    expect(note.allowReload(written("a").content)).toBe(false);

    expect(note.status()).toBe("error");
  });

  it("drops held text when the flush on leaving carries it", async () => {
    holdText("index.md", { content: "# held", reason: "failed with 500", conflicted: false });
    const note = renderAutosave("index.md");
    note.allowReload("the index note");

    note.change("# held new");
    note.open("daily/2026-08-05.md");
    await act(async () => {});

    expect(saveNote).toHaveBeenLastCalledWith("index.md", "# held new");
    expect(heldText("index.md")).toBeUndefined();
  });

  it("keeps text held at hide time when an older write lands", async () => {
    const note = renderAutosave("index.md");
    const older = pendingSave();
    note.change("c1");
    await idle();
    // The keepalive that never answers: the page went away under it.
    saveNote.mockImplementationOnce(() => new Promise(() => {}));
    note.change("c2");
    await pagehide();

    await older.finish();

    expect(heldText("index.md")?.content).toBe("c2");
  });

  it("keeps text held at hide time when an older write fails", async () => {
    const note = renderAutosave("index.md");
    const older = pendingSave();
    note.change("c1");
    await idle();
    saveNote.mockImplementationOnce(() => new Promise(() => {}));
    note.change("c2");
    await pagehide();

    await older.break();

    expect(heldText("index.md")?.content).toBe("c2");
    // Nor does the older text come back into `pending` to be written later.
    await note.save();
    expect(saveNote).not.toHaveBeenLastCalledWith("index.md", "c1");
  });

  it("keeps both texts when a flush refused after the reopen is followed by a refused save", async () => {
    const note = renderAutosave("index.md");
    note.seed("index.md", "the index note");
    const refuseFlush = refusedLater();

    note.change("# T1");
    note.open("other.md");
    // Back before the flush answers, on a buffer still holding the vault's
    // text. The read of that text is from before the flush, and declined (#304).
    note.open("index.md");
    expect(note.allowReload("the index note")).toBe(false);
    await refuseFlush();
    note.change("# T2");
    saveNote.mockRejectedValueOnce(new ChangedOnDisk());
    await note.save();

    expect(heldText("index.md")?.content).toBe("# T1");
    expect(heldRows()).toHaveLength(2);
  });

  it("keeps a flush refused after the reopen beside text the hide held there", async () => {
    // The hide's text was typed on the vault's, not on the flush's, so it is
    // no newer version of that text.
    const note = renderAutosave("index.md");
    note.seed("index.md", "the index note");
    const refuseFlush = refusedLater();

    note.change("# T1");
    note.open("other.md");
    note.open("index.md");
    // Declined as a read from before the flush (#304); the buffer keeps it.
    expect(note.allowReload("the index note")).toBe(false);
    note.change("# T2");
    saveNote.mockImplementationOnce(() => new Promise(() => {}));
    await pagehide();
    await refuseFlush();

    expect(heldRows()).toHaveLength(2);
  });

  it("keeps held text a pane never showed beside that pane's failed save", async () => {
    const note = renderAutosave("daily/2026-08-05.md", () => "the index note");
    note.seed("index.md", "the index note");
    holdText("index.md", { content: "# held", reason: "failed with 500", conflicted: false });

    note.open("index.md");
    note.change("the index note!");
    saveNote.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await idle();

    expect(heldText("index.md")?.content).toBe("# held");
    expect(heldRows()).toHaveLength(2);
  });

  it("keeps held text a pane never showed beside that pane's refused save", async () => {
    const note = renderAutosave("daily/2026-08-05.md", () => "the index note");
    note.seed("index.md", "the index note");
    holdText("index.md", { content: "# held", reason: "failed with 500", conflicted: false });

    note.open("index.md");
    note.change("the index note!");
    saveNote.mockRejectedValueOnce(new ChangedOnDisk());
    await idle();

    expect(heldText("index.md")?.content).toBe("# held");
    expect(heldRows()).toHaveLength(2);
  });

  it("keeps every text when a write fails after its note moved onto a path holding text", async () => {
    // Text left from a note deleted at the new path, and text of the note moved.
    holdText("moved.md", { content: "# stale", reason: "failed with 500", conflicted: false });
    holdText("index.md", { content: "# hidden", reason: "hidden", conflicted: false });
    const note = renderAutosave("index.md");
    const write = pendingSave();

    note.change("# edited");
    await idle();
    moveHeld((path) => (path === "index.md" ? "moved.md" : undefined));
    note.open("moved.md");
    await write.break();

    expect(heldText("index.md")).toBeUndefined();
    expect(heldText("moved.md")?.content).toBe("# stale");
    expect(heldRows().map(({ path }) => path)).toEqual(["moved.md", "moved.md", "moved.md"]);
  });

  describe("held text of another note at the path", () => {
    // Left by a note deleted at Y.md; the note there now was moved onto it.
    const theirs = "---\nid: y\n---\nthe deleted note's text";
    const mine = "---\nid: x\n---\nthe moved note's text";
    const vault = "---\nid: x\n---\nthe moved note";

    it("offers no held text of a deleted note to a note moved onto its path", async () => {
      holdText("Y.md", { content: theirs, reason: "failed with 500", conflicted: false });
      const note = renderAutosave("Y.md");

      expect(note.allowReload(vault)).toBe(true);

      expect(note.status()).toBe("saved");
      expect(note.restored()).toBe(false);
      expect(heldText("Y.md")?.content).toBe(theirs);
      expect(await note.saved()).toBe(true);
      expect(saveNote).not.toHaveBeenCalled();
    });

    it("offers a note its own entry behind a foreign one at its path", async () => {
      holdText("Y.md", { content: theirs, reason: "failed with 500", conflicted: false });
      holdText("Y.md", { content: mine, reason: "failed with 502", conflicted: false });
      const note = renderAutosave("other.md");
      note.seed("Y.md", vault);
      note.open("Y.md");

      expect(note.allowReload(vault)).toBe(false);

      expect(note.status()).toBe("error");
      expect(await note.saved()).toBe(true);
      expect(saveNote).toHaveBeenLastCalledWith("Y.md", mine, false, noteBase(vault));
      expect(heldText("Y.md")?.content).toBe(theirs);
    });

    it("loads the vault's text over a foreign entry the editor opened on", async () => {
      // The vault's text was not cached, so the editor opened on the oldest.
      holdText("Y.md", { content: theirs, reason: "failed with 500", conflicted: false });
      holdText("Y.md", { content: mine, reason: "failed with 502", conflicted: false });
      const note = renderAutosave("Y.md", () => theirs);

      expect(note.allowReload(vault)).toBe(true);

      expect(note.status()).toBe("saved");
      expect(note.restored()).toBe(false);
      expect(heldRows()).toHaveLength(2);
    });

    it("offers an entry with no id as before", () => {
      holdText("Y.md", { content: "# held", reason: "failed with 500", conflicted: false });
      const note = renderAutosave("Y.md");

      expect(note.allowReload(vault)).toBe(false);

      expect(note.restored()).toBe(true);
      expect(note.status()).toBe("error");
    });

    it("offers a note its own entry when the reader edited its id line", () => {
      holdText("Y.md", {
        content: "---\nid: edited\n---\n# held",
        reason: "failed with 500",
        conflicted: false,
        base: "---\nid: x\n---\n# start",
      });
      const note = renderAutosave("Y.md");

      expect(note.allowReload("---\nid: x\nmodified: now\n---\n# start")).toBe(false);

      expect(note.restored()).toBe(true);
    });
  });

  it("offers no entry a pane does not show after its shown entry was found landed", async () => {
    // The pane stayed mounted on the oldest entry, which the vault came to hold.
    const note = renderAutosave("daily/2026-08-05.md", () => "# first");
    note.seed("index.md", "# first");
    holdText("index.md", { content: "# first", reason: "failed with 500", conflicted: false });
    holdText("index.md", { content: "# second", reason: "failed with 502", conflicted: false });

    note.open("index.md");
    expect(note.allowReload("somebody else's note")).toBe(true);

    expect(note.restored()).toBe(false);
    expect(heldText("index.md")?.content).toBe("# second");
  });

  it("reopens text held at hide as not saved when the write in the air never reached the vault", async () => {
    const note = renderAutosave("index.md");
    note.seed("index.md", "the index note");
    // The page dies under both: the quiet write never arrives, and nobody
    // hears how the keepalive went.
    saveNote.mockImplementationOnce(() => new Promise(() => {}));
    saveNote.mockImplementationOnce(() => new Promise(() => {}));

    note.change("# one");
    await idle();
    note.change("# two");
    await pagehide();

    forgetQueues();
    const again = renderAutosave("index.md");
    expect(again.allowReload("the index note")).toBe(false);
    expect(again.status()).toBe("error");
  });

  it("drops only the taken entry when it is saved, and offers the next on the next opening", async () => {
    holdText("index.md", { content: "# first", reason: "failed with 500", conflicted: false });
    holdText("index.md", { content: "# second", reason: "failed with 502", conflicted: false });
    const note = renderAutosave("index.md");

    expect(note.allowReload("the index note")).toBe(false);
    expect(await note.saved()).toBe(true);
    expect(saveNote).toHaveBeenLastCalledWith("index.md", "# first");
    expect(heldText("index.md")?.content).toBe("# second");

    note.open("other.md");
    note.open("index.md");
    expect(note.allowReload(written("# first").content)).toBe(false);
    expect(note.reason()).toBe("failed with 502");
  });

  it("drops only the entry the buffer showed on :e!", async () => {
    holdText("index.md", { content: "# first", reason: "failed with 500", conflicted: false });
    holdText("index.md", { content: "# second", reason: "failed with 502", conflicted: false });
    const note = renderAutosave("index.md");
    note.allowReload("the index note");

    note.revert(true);
    expect(heldText("index.md")?.content).toBe("# second");
    // A buffer that took no held text throws none away.
    note.revert(true);
    expect(heldText("index.md")?.content).toBe("# second");
  });

  it("holds one entry for the hide and the failure of the same write", async () => {
    const note = renderAutosave("index.md");
    const quiet = pendingSave();
    note.change("# sent quietly");
    await idle();
    saveNote.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await pagehide();
    await quiet.break();

    expect(heldRows()).toHaveLength(1);
  });

  it("keeps text another tab held for the note through this tab's failed write", async () => {
    const note = renderAutosave("index.md");
    // A tab of the old build, still open after the deploy.
    localStorage.setItem(
      "kasten.held",
      JSON.stringify({
        "index.md": { content: "# theirs", reason: "failed with 500", conflicted: false },
      }),
    );

    note.change("# mine");
    saveNote.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await idle();

    expect(heldText("index.md")?.content).toBe("# theirs");
    expect(heldRows()).toHaveLength(2);
  });

  it("reopens held text as conflicted when the vault moved since it was held", async () => {
    saveNote.mockRejectedValue(new TypeError("Failed to fetch"));
    const left = renderAutosave("index.md");
    left.seed("index.md", "the index note");
    left.change("# mine");
    await pagehide();
    expect(heldText("index.md")?.base).toBe("the index note");
    left.unmount();
    await act(async () => {});

    // Somebody else wrote the note before it was opened again.
    const note = renderAutosave("index.md");
    expect(note.allowReload("somebody else's note")).toBe(false);

    expect(note.status()).toBe("conflict");
    expect(await note.saveFirst()).toBe(false);
  });

  it("writes nothing on its own when a held note is reopened", async () => {
    holdText("index.md", { content: "# held", reason: "failed with 500", conflicted: false });
    const note = renderAutosave("index.md");

    expect(note.allowReload("the index note")).toBe(false);
    await idle();

    expect(saveNote).not.toHaveBeenCalled();
    expect(note.status()).toBe("error");
  });

  it("does not take held text a second time while its write is in the air", async () => {
    holdText("index.md", { content: "# held", reason: "failed with 500", conflicted: false });
    const note = renderAutosave("index.md");
    note.allowReload("the index note");
    const write = pendingSave();
    note.startSave();

    // The write's own echo, read while the entry is still there.
    expect(note.allowReload("# held\nmodified: now")).toBe(true);
    await write.finish();
    expect(heldText("index.md")).toBeUndefined();
  });

  it("still shows an outside write as a conflict after a held note is reopened", async () => {
    holdText("index.md", { content: "# held", reason: "failed with 500", conflicted: false });
    const note = renderAutosave("index.md");
    note.seed("index.md", "the index note");
    note.allowReload("the index note");

    expect(note.reconcile()).toBe(false);
    saveNote.mockRejectedValueOnce(new ChangedOnDisk());
    await note.save();

    expect(saveNote).toHaveBeenCalledWith("index.md", "# held", false, noteBase("the index note"));
    expect(note.status()).toBe("conflict");
  });

  it("reopens a note held while conflicted as conflicted", async () => {
    holdText("index.md", { content: "# held", reason: "failed with 500", conflicted: true });
    const note = renderAutosave("index.md");

    expect(note.allowReload("the index note")).toBe(false);

    expect(note.status()).toBe("conflict");
    expect(await note.saveFirst()).toBe(false);
  });

  it("drops held text the vault already holds, the stamp aside", async () => {
    // A keepalive write that landed after the page was gone.
    const held = "---\nmodified: 2026-10-14T10:00:00+00:00\n---\n# held";
    holdText("index.md", { content: held, reason: "failed with 500", conflicted: false });
    const note = renderAutosave("index.md");

    expect(note.allowReload("---\nmodified: 2026-10-14T10:00:03+00:00\n---\n# held")).toBe(true);

    expect(heldText("index.md")).toBeUndefined();
    expect(note.status()).toBe("saved");
  });

  it("drops held text on :e!", async () => {
    holdText("index.md", { content: "# held", reason: "failed with 500", conflicted: false });
    const note = renderAutosave("index.md");
    note.allowReload("the index note");

    note.revert(true);

    expect(heldText("index.md")).toBeUndefined();
    expect(note.status()).toBe("saved");
  });

  it("writes the waiting text with keepalive when the page is hidden", async () => {
    const note = renderAutosave("index.md");

    note.change("# typed just now");
    await pagehide();

    expect(saveNote).toHaveBeenCalledWith("index.md", "# typed just now", true);
  });

  it("writes the waiting text when a phone backgrounds the page, and says how it went", async () => {
    const note = renderAutosave("index.md");

    note.change("# typed just now");
    await background();

    expect(saveNote).toHaveBeenCalledWith("index.md", "# typed just now", true);
    expect(note.status()).toBe("saved");
    expect(heldText("index.md")).toBeUndefined();
  });

  it("holds and resends a quiet write still in flight when the page is hidden", async () => {
    const note = renderAutosave("index.md");
    note.allowReload("# on disk");
    pendingSave();
    note.change("# sent quietly");
    await idle();
    // The keepalive that never answers: the page went away under it.
    saveNote.mockImplementationOnce(() => new Promise(() => {}));

    await pagehide();

    expect(heldText("index.md")?.content).toBe("# sent quietly");
    // The same text as the write in the air, so the same base: it lands if
    // that write was cancelled, and is the server's no-op if that write landed.
    const quietBase = saveNote.mock.calls[0]?.[3];
    expect(quietBase).toBeDefined();
    expect(saveNote).toHaveBeenNthCalledWith(2, "index.md", "# sent quietly", true, quietBase);
  });

  it("holds and resends a quiet write still in flight when a phone backgrounds the page", async () => {
    const note = renderAutosave("index.md");
    note.allowReload("# on disk");
    pendingSave();
    note.change("# sent quietly");
    await idle();
    saveNote.mockImplementationOnce(() => new Promise(() => {}));

    await background();

    expect(heldText("index.md")?.content).toBe("# sent quietly");
    const quietBase = saveNote.mock.calls[0]?.[3];
    expect(quietBase).toBeDefined();
    expect(saveNote).toHaveBeenNthCalledWith(2, "index.md", "# sent quietly", true, quietBase);
  });

  it("drops the copy held at hide time once the quiet write lands", async () => {
    const note = renderAutosave("index.md");
    const quiet = pendingSave();
    note.change("# sent quietly");
    await idle();
    saveNote.mockImplementationOnce(() => new Promise(() => {}));
    await pagehide();
    expect(heldText("index.md")?.content).toBe("# sent quietly");

    await quiet.finish();

    expect(heldText("index.md")).toBeUndefined();
  });

  it("holds and sends text typed after the quiet write went out, not the quiet write's", async () => {
    const note = renderAutosave("index.md");
    pendingSave();
    note.change("# sent quietly");
    await idle();
    saveNote.mockImplementationOnce(() => new Promise(() => {}));
    note.change("# typed after");

    await pagehide();

    expect(heldText("index.md")?.content).toBe("# typed after");
    expect(saveNote).toHaveBeenCalledTimes(2);
    expect(saveNote).toHaveBeenNthCalledWith(
      2,
      "index.md",
      "# typed after",
      true,
      noteBase("# sent quietly"),
    );
  });

  it("holds and sends nothing on hide when the quiet write in flight was thrown away", async () => {
    const note = renderAutosave("index.md");
    pendingSave();
    note.change("# thrown away");
    await idle();
    note.revert(true);

    await pagehide();

    expect(heldText("index.md")).toBeUndefined();
    expect(saveNote).toHaveBeenCalledTimes(1);
  });

  it("writes nothing when the page is shown again", async () => {
    const note = renderAutosave("index.md");

    note.change("# typed just now");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(saveNote).not.toHaveBeenCalled();
  });

  it("keeps the text held when the keepalive write is refused at hide time", async () => {
    // Over 64 KiB, or the network already gone: fetch rejects with a TypeError.
    const note = renderAutosave("index.md");
    saveNote.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    note.change("# typed just now");
    await pagehide();

    expect(heldText("index.md")?.content).toBe("# typed just now");
    expect(note.status()).toBe("error");
  });

  it("holds the text without writing when the page is hidden while conflicted", async () => {
    const note = renderAutosave("index.md");

    note.change("# mine");
    await refused();
    note.change("# mine, more");
    await pagehide();

    expect(saveNote).toHaveBeenCalledOnce();
    expect(heldText("index.md")).toEqual({
      content: "# mine, more",
      reason: "Not yet written when the page was hidden",
      conflicted: true,
    });
  });

  it("does not call the next note saved when the old note's flush answers late", async () => {
    const note = renderAutosave("index.md");
    const flush = pendingSave();
    const daily = pendingSave();

    note.change("# left behind");
    note.open("daily/2026-08-05.md");
    note.change("# daily");
    note.startSave();
    await flush.finish();

    expect(note.status()).toBe("saving");
    expect(note.cached("daily/2026-08-05.md")).toBeUndefined();
    await daily.finish();
  });

  describe("the base a save names", () => {
    it("names the vault's text under the buffer", async () => {
      const note = renderAutosave();
      note.seed("index.md", "the index note");

      note.change("# edited");
      await idle();
      await settled();

      expect(saveNote).toHaveBeenCalledWith(
        "index.md",
        "# edited",
        false,
        noteBase("the index note"),
      );
    });

    it("names its own landed text when the typing goes on through a save", async () => {
      const note = renderAutosave();
      note.seed("index.md", "the index note");

      note.change("# edited");
      await idle();
      await settled();
      note.change("# edited more");
      await idle();
      await settled();

      expect(saveNote).toHaveBeenLastCalledWith(
        "index.md",
        "# edited more",
        false,
        noteBase(written("# edited").content),
      );
    });

    it("names another writer's text once a reload took it into a clean buffer", async () => {
      const note = renderAutosave();

      note.change("# edited");
      await idle();
      await settled();
      expect(note.reconcile()).toBe(true);
      expect(note.allowReload("somebody else's text")).toBe(true);
      note.change("somebody else's text, and mine");
      await idle();
      await settled();

      expect(saveNote).toHaveBeenLastCalledWith(
        "index.md",
        "somebody else's text, and mine",
        false,
        noteBase("somebody else's text"),
      );
    });

    it("names the vault's text read for :e! once the typing starts again", async () => {
      // The route reads the vault into the cache, then throws the buffer away.
      const note = renderAutosave();

      note.change("# edited");
      await idle();
      await settled();
      note.change("# edited more");
      note.seed("index.md", "somebody else's text");
      note.revert(true);
      note.change("somebody else's text, and mine");
      await idle();
      await settled();

      expect(saveNote).toHaveBeenLastCalledWith(
        "index.md",
        "somebody else's text, and mine",
        false,
        noteBase("somebody else's text"),
      );
    });

    it("sends :w during a quiet write once that write lands, naming what it landed as", async () => {
      // What the quiet write lands as is what `:w` finds on disk, and only its
      // answer says what that is.
      const note = renderAutosave();
      note.seed("index.md", "the index note");
      const quiet = pendingSave();

      note.change("# edited");
      await idle();
      await settled();
      note.change("# edited more");
      note.startSave();
      await settled();
      expect(saveNote).toHaveBeenCalledOnce();
      await quiet.finish();
      await settled();

      expect(saveNote).toHaveBeenLastCalledWith(
        "index.md",
        "# edited more",
        false,
        noteBase(written("# edited").content),
      );
      expect(note.status()).toBe("saved");
    });

    it("names the landed text when the vault stamped more than modified on the write before", async () => {
      // A note with no block gets one on its first save, so the text sent never
      // hashes like the text that landed.
      const note = renderAutosave();
      note.seed("index.md", "the index note");
      const stamped = (content: string) => `---\nid: 1\nmodified: now\n---\n${content}`;
      let land: (() => void) | undefined;
      saveNote.mockImplementationOnce(
        (path: string, content: string) =>
          new Promise((resolve) => {
            land = () => resolve({ path, content: stamped(content) });
          }),
      );

      note.change("# edited");
      await idle();
      await settled();
      note.change("# edited more");
      note.startSave();
      await settled();
      await act(async () => land?.());
      await settled();

      expect(saveNote).toHaveBeenLastCalledWith(
        "index.md",
        "# edited more",
        false,
        noteBase(stamped("# edited")),
      );
    });

    it("names its own visit's base behind a flush still in the air from the visit before", async () => {
      // Back before the flush answered, so the buffer opened on the cache's
      // text and not the flushed one: naming what the flush lands as would put
      // this buffer over text that is then nowhere else.
      const note = renderAutosave("index.md");
      note.seed("index.md", "the index note");
      const flush = pendingSave();

      note.change("# T1");
      note.open("other.md");
      await settled();
      note.open("index.md");
      // A buffer still on the old text; the read of it is from before the
      // flush, and declined (#304).
      expect(note.allowReload("the index note")).toBe(false);
      note.change("# T2");
      saveNote.mockRejectedValueOnce(new ChangedOnDisk());
      note.startSave();
      await flush.finish();
      await settled();

      expect(saveNote).toHaveBeenLastCalledWith(
        "index.md",
        "# T2",
        false,
        noteBase("the index note"),
      );
      expect(note.status()).toBe("conflict");
      await note.save();
      expect(saveNote).toHaveBeenLastCalledWith("index.md", "# T2");
    });

    it("names the base of a write before it that failed, which never landed", async () => {
      const note = renderAutosave();
      note.seed("index.md", "the index note");
      const quiet = pendingSave();

      note.change("# edited");
      await idle();
      await settled();
      note.change("# edited more");
      note.startSave();
      await settled();
      await quiet.break();
      await settled();

      expect(saveNote).toHaveBeenLastCalledWith(
        "index.md",
        "# edited more",
        false,
        noteBase("the index note"),
      );
    });

    it("reads a save the vault refused over its base as a conflict, and keeps the text", async () => {
      const note = renderAutosave();
      note.seed("index.md", "the index note");
      saveNote.mockRejectedValueOnce(new ChangedOnDisk());

      note.change("# edited");
      await idle();
      await settled();

      expect(note.status()).toBe("conflict");
      expect(note.restored()).toBe(true);
      expect(heldText("index.md")).toMatchObject({ content: "# edited", conflicted: true });
      expect(note.cached("index.md")).toBe("the index note");
      expect(await note.saveFirst()).toBe(false);
      // Nothing more goes out on its own, and `:w` sends the kept text over
      // whatever is there, naming no base.
      await idle();
      await settled();
      expect(saveNote).toHaveBeenCalledOnce();
      await note.save();
      expect(saveNote).toHaveBeenLastCalledWith("index.md", "# edited");
    });

    it("only holds a refused write when a reload took the vault's text into the buffer meanwhile", async () => {
      // The other writer's event found nothing waiting, so the editor took their
      // text: the refused text is on screen nowhere, and `:w` must not send it.
      let doc = "# edited";
      const note = renderAutosave("index.md", () => doc);
      note.seed("index.md", "the index note");
      let refuse: (() => void) | undefined;
      saveNote.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            refuse = () => reject(new ChangedOnDisk());
          }),
      );

      note.change("# edited");
      await idle();
      await settled();
      // The event is declined while the write is in the air (#296); a route
      // write still reaches the editor through the cache.
      expect(note.reconcile()).toBe(false);
      expect(note.allowReload("somebody else's text")).toBe(true);
      doc = "somebody else's text";
      await act(async () => refuse?.());

      expect(heldText("index.md")).toMatchObject({ content: "# edited", conflicted: true });
      expect(note.restored()).toBe(false);
      expect(note.status()).toBe("saved");
      await note.save();
      expect(saveNote).toHaveBeenCalledOnce();
    });

    it("holds a flush on leaving that the vault refused as conflicted, and reopens it as one", async () => {
      const note = renderAutosave("index.md");
      note.seed("index.md", "the index note");
      saveNote.mockRejectedValueOnce(new ChangedOnDisk());

      note.change("# edited");
      note.open("other.md");
      await settled();

      expect(heldText("index.md")).toMatchObject({ content: "# edited", conflicted: true });
      note.open("index.md");
      expect(note.allowReload("somebody else's text")).toBe(false);
      expect(note.status()).toBe("conflict");
    });

    it("marks nothing on an outside write's event, and shows the conflict once the save is refused", async () => {
      const note = renderAutosave();
      note.seed("index.md", "the index note");

      note.change("# edited");
      expect(note.reconcile()).toBe(false);
      expect(note.status()).toBe("unsaved");

      saveNote.mockRejectedValueOnce(new ChangedOnDisk());
      await idle();

      expect(saveNote).toHaveBeenCalledWith(
        "index.md",
        "# edited",
        false,
        noteBase("the index note"),
      );
      expect(note.status()).toBe("conflict");
    });

    it("names the old base over a route write under a dirty buffer, so the vault refuses it", async () => {
      // A bookmark landing in the open note reaches the editor through the
      // cache. The buffer keeps its text, and the save that follows is what
      // finds out, rather than writing over the bookmark.
      const note = renderAutosave();
      note.seed("index.md", "the index note");

      note.change("# edited");
      expect(note.allowReload("the index note\nreading: epubcfi(/6/4)")).toBe(false);
      expect(note.status()).toBe("unsaved");

      saveNote.mockRejectedValueOnce(new ChangedOnDisk());
      await idle();

      expect(saveNote).toHaveBeenLastCalledWith(
        "index.md",
        "# edited",
        false,
        noteBase("the index note"),
      );
      expect(note.status()).toBe("conflict");
    });

    it("names the vault's text under the buffer as the keepalive's base", async () => {
      const note = renderAutosave();
      note.seed("index.md", "the index note");

      note.change("# typed just now");
      await pagehide();

      expect(saveNote).toHaveBeenCalledWith(
        "index.md",
        "# typed just now",
        true,
        noteBase("the index note"),
      );
    });

    /**
     * A vault that refuses a stale base, landing each write as the text with
     * its `modified` line restamped. Returns the text on disk, read live.
     */
    function vault(start: string) {
      let disk = start;
      const land = (content: string, base?: string) => {
        if (base !== undefined && base !== noteBase(disk)) throw new ChangedOnDisk();
        disk = content.replace(/\n---\n/, "\nmodified: now\n---\n");
        return { path: "index.md", content: disk };
      };
      saveNote.mockImplementation(
        async (_path: string, content: string, _k?: boolean, base?: string) => land(content, base),
      );
      /** The next write, held until the returned call lets it reach the vault. */
      const held = () => {
        let release: (() => Promise<void>) | undefined;
        saveNote.mockImplementationOnce(
          (_path: string, content: string, _k?: boolean, base?: string) =>
            new Promise((resolve, reject) => {
              release = async () => {
                try {
                  resolve(land(content, base));
                } catch (error) {
                  if (!(error instanceof ChangedOnDisk)) throw error;
                  reject(error);
                }
              };
            }),
        );
        return () => act(async () => release?.());
      };
      return { held, disk: () => disk };
    }

    it("names the write in the air as the keepalive's base, so text typed behind it lands", async () => {
      const note = renderAutosave();
      const server = vault("---\nid: a\n---\nzero");
      note.seed("index.md", "---\nid: a\n---\nzero");
      const first = server.held();
      const keepalive = server.held();

      note.change("---\nid: a\n---\none");
      await idle();
      note.change("---\nid: a\n---\ntwo");
      await pagehide();
      await first();
      await keepalive();

      expect(saveNote).toHaveBeenLastCalledWith(
        "index.md",
        "---\nid: a\n---\ntwo",
        true,
        noteBase("---\nid: a\n---\none"),
      );
      expect(server.disk()).toBe("---\nid: a\nmodified: now\n---\ntwo");
      expect(note.cached("index.md")).toBe("---\nid: a\nmodified: now\n---\ntwo");
      expect(heldText("index.md")).toBeUndefined();
    });

    it("holds a queued write that fails against what the write ahead of it landed", async () => {
      const note = renderAutosave();
      const server = vault("---\nid: a\n---\nzero");
      note.seed("index.md", "---\nid: a\n---\nzero");
      const first = server.held();
      saveNote.mockRejectedValueOnce(new TypeError("Failed to fetch"));

      note.change("---\nid: a\n---\none");
      await idle();
      note.change("---\nid: a\n---\ntwo");
      note.startSave();
      await first();
      await settled();

      expect(heldText("index.md")?.after).toBe(server.disk());
      // The next page, opening the note on what the vault holds.
      forgetQueues();
      const again = renderAutosave("index.md");
      expect(again.allowReload(server.disk())).toBe(false);
      expect(again.status()).toBe("error");
    });

    it("holds text typed behind a write in the air at hide against that write's text", async () => {
      const note = renderAutosave();
      const server = vault("---\nid: a\n---\nzero");
      note.seed("index.md", "---\nid: a\n---\nzero");
      const first = server.held();
      let drop: (() => void) | undefined;
      saveNote.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            drop = () => reject(new TypeError("Failed to fetch"));
          }),
      );

      note.change("---\nid: a\n---\none");
      await idle();
      note.change("---\nid: a\n---\ntwo");
      await pagehide();
      await first();
      await act(async () => drop?.());

      forgetQueues();
      const again = renderAutosave("index.md");
      expect(again.allowReload(server.disk())).toBe(false);
      expect(again.status()).toBe("error");
    });

    it("names the text read for :e! as its base after the cache moves under a dirty buffer", async () => {
      const note = renderAutosave();
      const server = vault("the index note");
      note.seed("index.md", "the index note");

      note.change("# edited");
      await idle();
      // The route reads the vault into the cache, then throws the buffer away.
      note.seed("index.md", server.disk());
      note.revert(true);
      note.change("# typed after :e!");
      // A highlight lands, and the cache follows it; the dirty editor declines it.
      note.seed("index.md", "a highlight");
      vault("a highlight");
      await idle();

      expect(saveNote).toHaveBeenLastCalledWith(
        "index.md",
        "# typed after :e!",
        false,
        noteBase("# edited"),
      );
      expect(note.status()).toBe("conflict");
    });

    it("names the cached text as its base on returning to a pane whose editor stayed mounted", async () => {
      let doc = "the index note";
      const note = renderAutosave("other.md", () => doc);
      note.seed("index.md", "the index note");

      note.open("index.md");
      doc = "the index note!";
      note.change(doc);
      note.seed("index.md", "a highlight");
      vault("a highlight");
      await idle();

      expect(saveNote).toHaveBeenLastCalledWith(
        "index.md",
        "the index note!",
        false,
        noteBase("the index note"),
      );
      expect(note.status()).toBe("conflict");
    });
  });

  it("drops held text of a note with no block once the vault holds it stamped", async () => {
    // The keepalive landed after the page was gone, and the vault gave the note
    // the block every write of one without it gets.
    holdText("index.md", { content: "# held", reason: "hidden", conflicted: false });
    const note = renderAutosave("index.md");

    expect(
      note.allowReload(
        "---\nid: 0199\ncreated: 2026-10-14T10:00:00+00:00\ntype: Note\nmodified: 2026-10-14T10:00:00+00:00\n---\n# held",
      ),
    ).toBe(true);

    expect(heldText("index.md")).toBeUndefined();
    expect(note.status()).toBe("saved");
  });

  it("keeps held text whose type the vault does not hold", async () => {
    holdText("index.md", {
      content: "---\nid: 0199\ntype: Book\n---\n# held",
      reason: "hidden",
      conflicted: false,
    });
    const note = renderAutosave("index.md");

    expect(note.allowReload("---\nid: 0199\ntype: Note\nmodified: now\n---\n# held")).toBe(false);

    expect(heldText("index.md")?.content).toBe("---\nid: 0199\ntype: Book\n---\n# held");
    expect(note.restored()).toBe(true);
  });

  describe("a failed write under newer text (#290)", () => {
    it("never writes a failed write's text over newer text that landed behind it", async () => {
      let screen = "start";
      const note = renderAutosave("index.md", () => screen);
      note.seed("index.md", "start");
      const first = pendingSave();
      screen = "A";
      note.change("A");
      await idle();
      const second = pendingSave();
      screen = "B";
      note.change("B");
      await idle();

      await first.break();
      await second.finish();

      expect(note.status()).toBe("saved");
      saveNote.mockClear();
      await note.save();
      note.open("other.md");
      expect(saveNote).not.toHaveBeenCalled();
      expect(heldText("index.md")).toBeUndefined();
    });

    it("keeps the newer text waiting when the write behind a failed one fails too", async () => {
      let screen = "start";
      const note = renderAutosave("index.md", () => screen);
      note.seed("index.md", "start");
      const first = pendingSave();
      screen = "A";
      note.change("A");
      await idle();
      const second = pendingSave();
      screen = "B";
      note.change("B");
      await idle();

      await first.break();
      await second.break();

      expect(heldRows().map((row) => row.entry.content)).toEqual(["B"]);
      saveNote.mockClear();
      await note.save();
      expect(saveNote.mock.calls.map((call) => call[1])).toEqual(["B"]);
    });

    it("holds a failed write's text when the buffer took other text while it was in the air", async () => {
      let screen = "start";
      const note = renderAutosave("index.md", () => screen);
      note.seed("index.md", "start");
      const first = pendingSave();
      screen = "A";
      note.change("A");
      await idle();
      // Somebody else writes the note, and the clean buffer takes their text.
      expect(note.allowReload("X")).toBe(true);
      screen = "X";

      await first.break();

      expect(heldText("index.md")?.content).toBe("A");
      expect(note.status()).toBe("saved");
      screen = "X typed";
      note.change("X typed");
      await idle();
      expect(saveNote).toHaveBeenLastCalledWith("index.md", "X typed", false, noteBase("X"));
      expect(heldText("index.md")?.content).toBe("A");
    });

    it("holds a failed write's text when the reader typed on other text the buffer took", async () => {
      let screen = "start";
      const note = renderAutosave("index.md", () => screen);
      note.seed("index.md", "start");
      const first = pendingSave();
      screen = "A";
      note.change("A");
      await idle();
      expect(note.allowReload("X")).toBe(true);
      screen = "X typed";
      note.change("X typed");

      await first.break();
      await idle();

      expect(saveNote).toHaveBeenLastCalledWith("index.md", "X typed", false, noteBase("X"));
      expect(heldText("index.md")?.content).toBe("A");
    });

    it("holds a failed write's text when a write typed on other text the buffer took is queued behind it", async () => {
      let screen = "start";
      const note = renderAutosave("index.md", () => screen);
      note.seed("index.md", "start");
      const first = pendingSave();
      screen = "A";
      note.change("A");
      await idle();
      expect(note.allowReload("X")).toBe(true);
      const second = pendingSave();
      screen = "X typed";
      note.change("X typed");
      await idle();

      await first.break();

      expect(heldText("index.md")?.content).toBe("A");
      await second.finish();
    });
  });

  describe(":e during a write (#291)", () => {
    it("refuses :e without the bang while a write is in the air, and holds that write's text when it fails", async () => {
      const note = renderAutosave("index.md", () => "A");
      note.seed("index.md", "start");
      const write = pendingSave();
      note.change("A");
      await idle();

      expect(note.revert(false)).toBe(false);
      await write.break();

      expect(heldText("index.md")?.content).toBe("A");
    });

    it("lets :e through once the write has answered", async () => {
      const note = renderAutosave("index.md", () => "A");
      note.seed("index.md", "start");
      const write = pendingSave();
      note.change("A");
      await idle();
      await write.finish();

      expect(note.revert(false)).toBe(true);
    });

    it("still throws the buffer away on :e! while a write is in the air", async () => {
      const note = renderAutosave("index.md", () => "A");
      note.seed("index.md", "start");
      const write = pendingSave();
      note.change("A");
      await idle();

      expect(note.revert(true)).toBe(true);
      await write.break();

      expect(heldText("index.md")).toBeUndefined();
      expect(note.status()).toBe("saved");
    });
  });

  describe("an older write answering behind a newer one (#296, #297, #298)", () => {
    /**
     * The hook with an editor on `index.md`, opened on `seed`. The editor puts
     * the cache on screen when it moves, asking first, as its reload does; it
     * asks nothing while the cache stands still.
     */
    function withEditor(seed: string) {
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
        /** Another writer's text, reaching the editor through the cache. */
        outside: (text: string) => {
          note.seed("index.md", text);
          seen = text;
          if (note.allowReload(text)) doc = text;
        },
        shown: () => doc,
      };
    }

    it("keeps the first write's answer out of the cache while the second is queued", async () => {
      const { note, type, look, shown } = withEditor("start");
      const first = pendingSave();
      const second = pendingSave();

      type("T1");
      await idle();
      type("T2");
      await idle();
      await first.finish();
      look();

      expect(note.cached("index.md")).toBe("start");
      expect(shown()).toBe("T2");
      expect(note.status()).toBe("saving");
      await second.finish();
      expect(note.cached("index.md")).toBe(written("T2").content);
      expect(note.status()).toBe("saved");
    });

    it("keeps keys typed after the first write lands on the second write's text", async () => {
      const { type, look, shown } = withEditor("start");
      const first = pendingSave();
      const second = pendingSave();

      type("T1");
      await idle();
      type("T2");
      await idle();
      await first.finish();
      look();
      type(`${shown()}, and more`);
      await second.finish();
      look();
      await idle();
      await settled();

      expect(saveNote).toHaveBeenLastCalledWith(
        "index.md",
        "T2, and more",
        false,
        noteBase(written("T2").content),
      );
    });

    it("keeps the second write's text in pending when it fails after the first landed", async () => {
      const { note, type, look, shown } = withEditor("start");
      const first = pendingSave();
      const second = pendingSave();

      type("T1");
      await idle();
      type("T2");
      await idle();
      await first.finish();
      look();
      await second.break();
      look();

      expect(note.status()).toBe("error");
      expect(note.restored()).toBe(true);
      // The vault's text, which the first write left there; the screen keeps
      // the second's.
      expect(note.cached("index.md")).toBe(written("T1").content);
      expect(shown()).toBe("T2");
      await note.save();
      expect(saveNote).toHaveBeenLastCalledWith(
        "index.md",
        "T2",
        false,
        noteBase(written("T1").content),
      );
    });

    it("keeps the second write's text in pending when it is refused after the first landed", async () => {
      const { note, type, look } = withEditor("start");
      const first = pendingSave();
      const refuse = refusedLater();

      type("T1");
      await idle();
      type("T2");
      await idle();
      await first.finish();
      look();
      await refuse();
      look();

      expect(note.status()).toBe("conflict");
      expect(note.cached("index.md")).toBe("start");
      expect(heldText("index.md")).toMatchObject({ content: "T2", conflicted: true });
      await note.save();
      expect(saveNote).toHaveBeenLastCalledWith("index.md", "T2");
    });

    it("holds the second write as a conflict when both are refused", async () => {
      const { note, type } = withEditor("start");
      const first = refusedLater();
      const second = refusedLater();

      type("T1");
      await idle();
      type("T2");
      await idle();
      await first();
      await settled();
      await second();

      expect(note.status()).toBe("conflict");
      expect(heldText("index.md")).toMatchObject({ content: "T2", conflicted: true });
    });

    it("declines an outside write's event while a write is in the air", async () => {
      const { note, type } = withEditor("start");
      pendingSave();
      pendingSave();

      type("T1");
      await idle();
      expect(note.reconcile()).toBe(false);
      type("T2");
      await idle();
      expect(note.reconcile()).toBe(false);
    });

    it("reloads a declined event's note once the last write to it answers", async () => {
      const { note, type } = withEditor("start");
      const first = pendingSave();
      const invalidate = vi.spyOn(note.client, "invalidateQueries");

      type("T1");
      await idle();
      expect(note.reconcile()).toBe(false);
      expect(invalidate).not.toHaveBeenCalled();
      await first.finish();

      expect(invalidate).toHaveBeenCalledWith(
        { queryKey: ["note", "index.md"] },
        { cancelRefetch: false },
      );
    });

    it("names a reload's text behind a write that fails", async () => {
      const { note, type, outside } = withEditor("start");
      const first = pendingSave();
      const second = pendingSave();

      type("T1");
      await idle();
      outside("E");
      type("E, and mine");
      await idle();
      await first.break();
      await second.finish();

      expect(saveNote).toHaveBeenLastCalledWith("index.md", "E, and mine", false, noteBase("E"));
      expect(note.status()).toBe("saved");
    });

    it("names a reload's text behind a write that lands, and caches neither answer over it", async () => {
      const { note, type, outside } = withEditor("start");
      const first = pendingSave();
      const second = pendingSave();

      type("T1");
      await idle();
      outside("E");
      type("E, and mine");
      await idle();
      await first.finish();

      expect(note.cached("index.md")).toBe("E");
      await second.finish();
      expect(saveNote).toHaveBeenLastCalledWith("index.md", "E, and mine", false, noteBase("E"));
    });

    it("reopens without a conflict after the second write and the flush fail behind a landed first", async () => {
      const { note, type, look } = withEditor("start");
      const first = pendingSave();
      const second = pendingSave();

      type("T1");
      await idle();
      type("T2");
      await idle();
      await first.finish();
      look();
      await second.break();
      look();
      saveNote.mockRejectedValueOnce(new Error("PUT /api/files/index.md failed with 500"));
      note.open("other.md");
      await settled();
      note.open("index.md");
      // The editor opens on what the cache holds, and asks about it.
      note.allowReload(String(note.cached("index.md")));

      expect(note.status()).toBe("error");
    });

    it("drops an older write that fails behind the hide's text when another note reloaded", async () => {
      let doc = "start";
      const note = renderAutosave("index.md", () => doc);
      note.seed("index.md", "start");
      const first = pendingSave();
      pendingSave();

      doc = "T1";
      note.change("T1");
      await idle();
      doc = "T1x";
      note.change("T1x");
      await pagehide();
      note.seed("b.md", "b text");
      doc = "b text";
      note.open("b.md");
      note.allowReload("somebody else's b");
      await first.break();

      expect(heldTexts("index.md").map((entry) => entry.content)).toEqual(["T1x"]);
    });

    it("keeps the base in the cache when a keepalive behind a failed write fails too", async () => {
      let doc = "start";
      const note = renderAutosave("index.md", () => doc);
      note.seed("index.md", "start");
      const first = pendingSave();
      const keepalive = pendingSave();

      doc = "T1";
      note.change("T1");
      await idle();
      doc = "T1x";
      note.change("T1x");
      await pagehide();
      await first.break();
      await keepalive.break();

      expect(note.cached("index.md")).toBe("start");
    });

    it("names a reload's text typed while the older write was in the air, once that write lands", async () => {
      const { type, outside } = withEditor("start");
      const first = pendingSave();

      type("T1");
      await idle();
      outside("E");
      type("E, and mine");
      await first.finish();
      await idle();
      await settled();

      expect(saveNote).toHaveBeenLastCalledWith("index.md", "E, and mine", false, noteBase("E"));
    });

    it("holds an older write that fails after a reload beside the hide's text", async () => {
      const { type, outside } = withEditor("start");
      const first = pendingSave();
      pendingSave();

      type("T1");
      await idle();
      outside("E");
      type("E, and mine");
      await pagehide();
      await first.break();

      expect(heldTexts("index.md").map((entry) => entry.content)).toEqual(["E, and mine", "T1"]);
    });

    it("names a reload's text on the keepalive, not the write in the air", async () => {
      const { type, outside } = withEditor("start");
      pendingSave();
      pendingSave();

      type("T1");
      await idle();
      outside("E");
      type("E, and mine");
      await pagehide();

      expect(saveNote).toHaveBeenLastCalledWith("index.md", "E, and mine", true, noteBase("E"));
      expect(heldText("index.md")).toMatchObject({ content: "E, and mine", base: "E" });
      expect(heldText("index.md")?.after).toBeUndefined();
    });

    it("keeps a flush's answer out of the cache while the next pane's write is queued", async () => {
      const { note, type } = withEditor("start");
      const flush = pendingSave();
      const second = pendingSave();

      type("from pane a");
      note.focus("b");
      type("from pane b");
      await idle();
      await flush.finish();

      // The text the leave sent, put there as it went (#303), not its answer.
      expect(note.cached("index.md")).toBe("from pane a");
      await second.finish();
      expect(note.cached("index.md")).toBe(written("from pane b").content);
    });
  });

  describe("save queue (#301-#307)", () => {
    afterEach(() => {
      fetchNote.mockReset();
    });

    /**
     * The hook with an editor on `index.md`, as in the block above, plus a way
     * to put text on screen by hand: a reopen or a second pane shows what its
     * own buffer holds, not what the cache moved to.
     */
    function withEditor(seed: string) {
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
        /** What the focused editor shows, set by hand. */
        show: (text: string) => {
          doc = text;
          seen = text;
        },
        /** `:e!`: the route reads the vault into the cache, then asks. */
        discard: (text: string) => {
          note.seed("index.md", text);
          note.revert(true);
          doc = text;
          seen = text;
        },
        shown: () => doc,
      };
    }

    it("never sends a write still queued at :e!", async () => {
      const { note, type, discard, shown } = withEditor("start");
      const first = pendingSave();

      type("T1");
      await idle();
      type("T2");
      note.startSave();
      discard("start");
      await first.finish();
      await settled();

      // T2 never goes; "start" is the write `:e!` queues behind T1 (#311).
      expect(saveNote.mock.calls.map((call) => call[1])).toEqual(["T1", "start"]);
      expect(note.cached("index.md")).not.toBe(written("T2").content);
      expect(shown()).toBe("start");
    });

    it("lets a rename wait for the write in the air, and refuses when it fails", async () => {
      const { note, type } = withEditor("start");
      const first = pendingSave();

      type("T1");
      await idle();
      let outcome: boolean | undefined;
      void note.askSaveFirst().then((answer) => {
        outcome = answer;
      });
      await settled();

      // Nothing is pending, but the note's write is still on its way: a rename
      // now would move the path under it.
      expect(outcome).toBeUndefined();
      await first.break();
      await settled();
      expect(outcome).toBe(false);
    });

    it("sends nothing on hide when the note reloaded since its write went out", async () => {
      const { type, outside } = withEditor("start");
      pendingSave();

      type("T1");
      await idle();
      outside("R");
      await pagehide();

      // T1 was typed on "start", and the screen holds R now: a keepalive of it
      // named R would land it over another writer's text unasked.
      expect(saveNote.mock.calls.filter((call) => call[2] === true)).toEqual([]);
    });

    it("declines a refetch answering while a write is in the air, and reloads once it lands", async () => {
      const { note, type } = withEditor("start");
      const first = pendingSave();
      const invalidate = vi.spyOn(note.client, "invalidateQueries");

      type("T1");
      await idle();
      // A refetch that started before T1 went out, answering with the text
      // under it. `pending` is empty, but the screen holds newer text.
      expect(note.allowReload("start")).toBe(false);
      await first.finish();
      expect(invalidate).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ["note", "index.md"] }),
        expect.anything(),
      );
    });

    it("holds and resends the flush to a note just left when the page is hidden", async () => {
      const { note, type } = withEditor("start");
      pendingSave();

      type("A text");
      note.seed("b.md", "b text");
      note.open("b.md");
      await pagehide();

      // The hook follows b.md now, and the flush to index.md is the only copy
      // of A's text, which the page going away cancels.
      expect(heldText("index.md")).toMatchObject({ content: "A text" });
      expect(saveNote).toHaveBeenCalledWith("index.md", "A text", true, expect.anything());
    });

    it("reopens a note on the flush's text and names its answer behind it", async () => {
      const { note, type, look, show } = withEditor("start");
      const flush = pendingSave();

      type("T1");
      note.seed("other.md", "other");
      note.open("other.md");
      // The flush's text goes into the cache as it goes out, so the editor
      // opened next reads the reader's newest text and not the text under it.
      expect(note.cached("index.md")).toBe("T1");
      note.open("index.md");
      show(String(note.cached("index.md")));
      note.allowReload(String(note.cached("index.md")));
      type("T1, T2");
      await idle();
      await flush.finish();
      await settled();
      look();

      expect(saveNote).toHaveBeenLastCalledWith(
        "index.md",
        "T1, T2",
        false,
        noteBase(written("T1").content),
      );
      expect(note.status()).not.toBe("conflict");
    });

    it("lets a second pane type on the first pane's text while its write is in the air", async () => {
      const { note, type, look, show, shown } = withEditor("start");
      const flush = pendingSave();

      type("A1");
      // Pane b's own buffer, opened before A1 was typed, holds its text before
      // the focus moves. It takes the cache the way a standby pane does.
      show("start");
      note.focus("b");
      look();
      type(`${shown()}, B`);
      await idle();
      await flush.finish();
      await settled();

      expect(saveNote).toHaveBeenLastCalledWith(
        "index.md",
        "A1, B",
        false,
        noteBase(written("A1").content),
      );
      expect(note.status()).not.toBe("conflict");
    });

    it("follows the queue in a second pane that took the first pane's text before it got the focus", async () => {
      const { note, type, shown } = withEditor("start");
      const flush = pendingSave();

      type("A1");
      // Pane b took A1 through the route's standby reload while unfocused, so
      // it shows A1 at the opening and asks the hook nothing.
      note.focus("b");
      type(`${shown()}, B`);
      await idle();
      await flush.finish();
      await settled();

      expect(saveNote).toHaveBeenLastCalledWith(
        "index.md",
        "A1, B",
        false,
        noteBase(written("A1").content),
      );
      expect(note.status()).not.toBe("conflict");
    });

    it("names the old text from a pane that never took the first pane's, and holds the refusal", async () => {
      const { note, type, show } = withEditor("start");
      const flush = pendingSave();
      const refuse = refusedLater();

      type("A1");
      // Pane b still shows the text from before A1 and took nothing since:
      // typed on that, its write must name it, and the vault refuse it. The
      // view holds that text before the focus moves.
      show("start");
      note.focus("b");
      type("start, B");
      await idle();
      await flush.finish();
      await settled();
      await refuse();

      expect(saveNote).toHaveBeenLastCalledWith("index.md", "start, B", false, noteBase("start"));
      expect(note.status()).toBe("conflict");
      expect(heldText("index.md")).toMatchObject({ content: "start, B", conflicted: true });
      expect(saveNote).not.toHaveBeenCalledWith("index.md", "start, B");
    });

    it("names the keepalive's answer on the next write when the page lives on", async () => {
      const { type } = withEditor("start");
      const first = pendingSave();
      const keepalive = pendingSave();

      type("T1");
      await idle();
      type("T2");
      await background();
      type("T2, T3");
      await idle();
      await first.finish();
      await keepalive.finish();
      await settled();

      // The keepalive left after W1 and lands after it: T2 is on disk when T3
      // goes out.
      expect(saveNote).toHaveBeenLastCalledWith(
        "index.md",
        "T2, T3",
        false,
        noteBase(written("T2").content),
      );
    });

    it("resends a refused keepalive naming the base when the write ahead of it failed", async () => {
      const { note, type } = withEditor("start");
      const first = pendingSave();
      const refuse = refusedLater();

      type("A");
      await idle();
      type("B");
      await pagehide();
      await first.break();
      // The keepalive named A, which never landed: its refusal is no conflict.
      await refuse();
      await settled();

      expect(saveNote).toHaveBeenLastCalledWith(
        "index.md",
        "B",
        expect.any(Boolean),
        noteBase("start"),
      );
      expect(note.status()).not.toBe("conflict");
    });

    it("reads the note before naming a base after a write failed with no answer", async () => {
      const { type } = withEditor("start");
      // The server wrote T2 and the response was lost on the way back. With a
      // real stamp, which the hook checks the read against.
      const stamped = "---\nmodified: now\n---\nT2";
      fetchNote.mockResolvedValue(stamped);

      type("T1");
      await idle();
      type("T2");
      saveNote.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      await idle();
      await settled();
      type("T2, T3");
      await idle();
      await settled();

      expect(fetchNote).toHaveBeenCalledWith("index.md");
      expect(saveNote).toHaveBeenLastCalledWith("index.md", "T2, T3", false, noteBase(stamped));
    });

    it("keeps the old base after a write lost on the network when somebody else wrote meanwhile", async () => {
      const { type } = withEditor("start");
      // Somebody else wrote X, and W1 never reached the server.
      fetchNote.mockResolvedValue("X");

      type("T1");
      saveNote.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      await idle();
      await settled();
      type("T1, T2");
      await idle();
      await settled();

      // X is not our text: naming it would land T2 over X unasked.
      expect(fetchNote).toHaveBeenCalledWith("index.md");
      expect(saveNote).toHaveBeenLastCalledWith("index.md", "T1, T2", false, noteBase("start"));
    });

    it("keeps a failed flush's text on the screen it reopened on", async () => {
      const { note, type, look, show, shown } = withEditor("start");
      const flush = pendingSave();

      type("T1");
      note.seed("other.md", "other");
      note.open("other.md");
      note.open("index.md");
      show(String(note.cached("index.md")));
      note.allowReload("T1");
      await flush.break();
      await settled();
      look();

      // The clean screen showed T1 and nothing else holds it: it stays there,
      // unwritten, and not only on the bar.
      expect(shown()).toBe("T1");
      expect(note.status()).toBe("error");
      expect(note.restored()).toBe(true);
    });

    it("drops an older write to a left note refused behind the hide's keepalive", async () => {
      const { note, type } = withEditor("start");
      const refuse = refusedLater();
      const keepalive = pendingSave();

      type("T1");
      await idle();
      type("T2");
      note.seed("b.md", "b");
      note.open("b.md");
      // The page lives on: the keepalive of T2 lands before W1, which the
      // vault then refuses. T1 is older text T2 was typed on, not a conflict.
      await background();
      await keepalive.finish();
      await refuse();
      await settled();

      expect(heldTexts("index.md").map((entry) => entry.content)).not.toContain("T1");
    });

    it("lets a rename go when a later write landed after a failed one", async () => {
      const { note, type } = withEditor("start");
      const first = pendingSave();

      type("T1");
      await idle();
      type("T1, T2");
      note.startSave();
      let outcome: boolean | undefined;
      void note.askSaveFirst().then((answer) => {
        outcome = answer;
      });
      await first.break();
      await settled();

      // The second write carried T1 and landed: the vault holds the buffer.
      expect(outcome).toBe(true);
    });

    it("drops a failed flush's text that a later write in another visit carries", async () => {
      const { note, type, shown } = withEditor("start");
      const first = pendingSave();

      type("T1");
      await idle();
      // Pane b shows T1 at the opening, and types on it behind W1.
      note.focus("b");
      type(`${shown()}, T2`);
      await idle();
      await first.break();
      await settled();

      // T2 landed with T1 in it: held, T1 would be offered as a conflict with
      // it, and `:w` there would lose T2.
      expect(saveNote).toHaveBeenLastCalledWith("index.md", "T1, T2", false, expect.anything());
      expect(heldTexts("index.md").map((entry) => entry.content)).not.toContain("T1");
    });
  });

  describe("a keepalive behind a queued write, and :e! during a write (#310, #311)", () => {
    /**
     * A vault that keeps every write apart in two steps: reaching the server,
     * which lands it or refuses it there and then, and its answer reaching the
     * page, which a page gone away never hears. Each write lands with a block
     * stamped on, as `PUT` stamps it, and a base may name the text with that
     * block set aside. A stale base over a disk that already holds the text is
     * a 200, as the backend answers it.
     */
    function server(start: string) {
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
      saveNote.mockImplementation(
        (_path: string, content: string, keepalive = false, base?: string) =>
          new Promise((resolve, reject) => {
            let outcome: (() => void) | undefined;
            requests.push({
              content,
              keepalive,
              base,
              arrive: () => {
                if (
                  base !== undefined &&
                  base !== noteBase(disk) &&
                  base !== noteBase(body(disk))
                ) {
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
    function withEditor(seed: string) {
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
    function reopen(text: string, doc: string) {
      // None of the old page's writes, which died with it.
      forgetQueues();
      const again = renderAutosave("index.md", () => doc);
      again.seed("index.md", text);
      again.allowReload(text);
      return again;
    }

    it("names the last write sent on hide behind a queued write, and lands over it", async () => {
      const vault = server("start");
      const { note, type } = withEditor("start");

      type("T1");
      await idle();
      type("T2");
      note.startSave();
      await pagehide();
      // W2 waits behind W1 and never left: on disk after W1 is T1, not the base.
      expect(vault.request(1)).toMatchObject({
        content: "T2",
        keepalive: true,
        base: noteBase("T1"),
      });
      // The page is gone: W1 and the keepalive reach the vault, unheard.
      await vault.arrive(0);
      await vault.arrive(1);
      expect(landedAs("T2", vault.disk())).toBe(true);

      const again = reopen(vault.disk(), "T2");
      expect(heldText("index.md")).toBeUndefined();
      expect(again.status()).toBe("saved");
    });

    it("names the last write sent for a left note whose newest write is still queued", async () => {
      const vault = server("start");
      const { note, type } = withEditor("start");

      type("T1");
      await idle();
      type("T2");
      note.startSave();
      note.seed("b.md", "b");
      note.open("b.md");
      await pagehide();
      expect(vault.request(1)).toMatchObject({
        content: "T2",
        keepalive: true,
        base: noteBase("T1"),
      });
      await vault.arrive(0);
      await vault.arrive(1);
      expect(landedAs("T2", vault.disk())).toBe(true);

      const again = reopen(vault.disk(), "T2");
      expect(heldText("index.md")).toBeUndefined();
      expect(again.status()).toBe("saved");
    });

    it("resends a keepalive that overtook the write ahead of it, naming that write's answer", async () => {
      const vault = server("start");
      const { note, type } = withEditor("start");

      type("T1");
      await idle();
      type("T2");
      await pagehide();
      // The keepalive reaches the vault first, which still holds "start".
      await vault.land(1);
      await vault.land(0);
      const first = vault.disk();
      await settled();

      expect(saveNote).toHaveBeenLastCalledWith("index.md", "T2", false, noteBase(first));
      await vault.land(2);
      expect(landedAs("T2", vault.disk())).toBe(true);
      expect(heldTexts("index.md")).toEqual([]);
      expect(note.status()).not.toBe("conflict");
    });

    it("holds a keepalive refused after the write ahead landed as a conflict", async () => {
      const vault = server("start");
      const { note, type } = withEditor("start");

      type("T1");
      await idle();
      type("T2");
      await pagehide();
      await vault.land(0);
      // Somebody else writes between W1 and the keepalive: a true conflict.
      vault.write("X");
      await vault.land(1);

      expect(saveNote).toHaveBeenCalledTimes(2);
      expect(vault.disk()).toBe("X");
      expect(heldText("index.md")).toMatchObject({ content: "T2", conflicted: true });
      expect(note.status()).toBe("conflict");
    });

    it("keeps what :e! threw away out of the vault and off the screen when its write lands after", async () => {
      const vault = server("start");
      const { note, type, look, outside, discard, shown } = withEditor("start");

      type("T1");
      await idle();
      discard("start");
      await vault.land(0);
      // W1's event, and a refetch answering with what W1 landed.
      const echo = vault.disk();
      if (note.reconcile()) outside(echo);
      outside(echo);
      expect(shown()).toBe("start");
      expect(note.status()).toBe("saving");

      await vault.land(1);
      look();
      expect(saveNote.mock.calls.map((call) => call[1])).toEqual(["T1", "start"]);
      expect(landedAs("start", vault.disk())).toBe(true);
      expect(landedAs("start", shown())).toBe(true);
      expect(note.status()).toBe("saved");
    });

    it("reloads somebody else's text when the write after :e! is refused, holding nothing", async () => {
      const vault = server("start");
      const { note, type, outside, discard, shown } = withEditor("start");

      type("T1");
      await idle();
      discard("start");
      await vault.land(0);
      vault.write("X");
      if (note.reconcile()) outside("X");
      await vault.land(1);
      // The refetch the declined event left for once nothing is in the air.
      outside(vault.disk());

      expect(vault.disk()).toBe("X");
      expect(shown()).toBe("X");
      expect(heldTexts("index.md")).toEqual([]);
      expect(note.status()).toBe("saved");
    });

    it("sends keys typed after :e! behind its write, naming that write's answer", async () => {
      const vault = server("start");
      const { note, type, discard } = withEditor("start");

      type("T1");
      await idle();
      discard("start");
      type("start, more");
      await idle();
      await vault.land(0);
      await vault.land(1);
      const restored = vault.disk();
      await vault.land(2);

      expect(saveNote.mock.calls.map((call) => call[1])).toEqual(["T1", "start", "start, more"]);
      expect(saveNote).toHaveBeenLastCalledWith(
        "index.md",
        "start, more",
        false,
        noteBase(restored),
      );
      expect(landedAs("start, more", vault.disk())).toBe(true);
      expect(note.status()).toBe("saved");
    });

    it("holds nothing when the write after :e! fails", async () => {
      const vault = server("start");
      const { note, type, discard } = withEditor("start");

      type("T1");
      await idle();
      discard("start");
      await vault.land(0);
      await vault.fail(1);

      expect(saveNote.mock.calls.map((call) => call[1])).toEqual(["T1", "start"]);
      expect(heldTexts("index.md")).toEqual([]);
      expect(note.status()).toBe("saved");
      // Nothing waits to go out: a save writes nothing.
      expect(await note.saved()).toBe(true);
      expect(saveNote).toHaveBeenCalledTimes(2);
    });

    it("writes nothing on :e! with no write in the air", async () => {
      server("start");
      const { type, discard } = withEditor("start");

      type("T1");
      discard("start");
      await idle();
      await settled();

      expect(saveNote).not.toHaveBeenCalled();
    });

    it("holds and sends nothing on hide while the write after :e! waits its turn", async () => {
      const vault = server("start");
      const { note, type, outside, discard, shown } = withEditor("start");

      type("T1");
      await idle();
      discard("start");
      // The page lives on through the hide.
      await background();
      await vault.land(0);
      vault.write("X");
      if (note.reconcile()) outside("X");
      await vault.land(1);
      await vault.land(2);
      // The refetch the declined event left for once nothing is in the air.
      outside(vault.disk());

      expect(vault.disk()).toBe("X");
      expect(shown()).toBe("X");
      expect(heldTexts("index.md")).toEqual([]);
      expect(note.status()).toBe("saved");
    });

    it("names the base on hide when the buffer reopened on the text under a write in the air", async () => {
      const vault = server("start");
      const { note, type, show } = withEditor("start");

      type("T1");
      await idle();
      note.seed("b.md", "b");
      note.open("b.md");
      // The quiet write put nothing in the cache: the editor reopens on "start".
      show("start");
      note.open("index.md");
      type("start T2");
      await pagehide();
      await vault.land(0);
      const first = vault.disk();
      await vault.land(1);
      await vault.land(2);

      // Typed on "start" and not on T1: the vault refuses it, and T1 stands.
      expect(vault.disk()).toBe(first);
      expect(landedAs("T1", vault.disk())).toBe(true);
      expect(heldText("index.md")).toMatchObject({ content: "start T2", conflicted: true });
      expect(note.status()).toBe("conflict");
    });

    it("holds without sending on hide when the buffer reopened on the text under a write in the air", async () => {
      server("start");
      const { note, type, show } = withEditor("start");

      type("T1");
      await idle();
      note.seed("b.md", "b");
      note.open("b.md");
      show("start");
      note.open("index.md");
      await pagehide();

      // The screen shows "start": a keepalive would land T1 over it unseen.
      expect(saveNote).toHaveBeenCalledTimes(1);
      // W1 dies with the page, so its text is held where the screen is not.
      expect(heldText("index.md")).toMatchObject({ content: "T1", conflicted: false });
      expect(note.restored()).toBe(false);
    });

    it("holds the write in the air off screen against the write it named, so reopening reads no conflict", async () => {
      const vault = server("start");
      const { note, type, show } = withEditor("start");

      type("T0");
      await idle();
      type("T1");
      note.startSave();
      note.seed("b.md", "b");
      note.open("b.md");
      show("start");
      note.open("index.md");
      // W1 goes out behind W0, naming what W0 landed, and never answers.
      await vault.land(0);
      expect(vault.request(1)).toMatchObject({ content: "T1", base: noteBase(vault.disk()) });
      await pagehide();
      expect(saveNote).toHaveBeenCalledTimes(2);

      // The vault holds W0's text, the reader's own: T1 was typed on it.
      const again = reopen(vault.disk(), "T1");
      expect(heldText("index.md")).toMatchObject({ content: "T1" });
      expect(again.status()).not.toBe("conflict");
    });

    it("holds without sending when a phone backgrounds the page reopened on the text under a write in the air", async () => {
      const vault = server("start");
      const { note, type, show } = withEditor("start");

      type("T1");
      await idle();
      note.seed("b.md", "b");
      note.open("b.md");
      show("start");
      note.open("index.md");
      await background();

      expect(saveNote).toHaveBeenCalledTimes(1);
      expect(heldText("index.md")).toMatchObject({ content: "T1", conflicted: false });
      expect(note.restored()).toBe(false);
      await vault.land(0);
    });

    it("drops the copy held off screen at hide once the write in the air lands", async () => {
      const vault = server("start");
      const { note, type, show } = withEditor("start");

      type("T1");
      await idle();
      note.seed("b.md", "b");
      note.open("b.md");
      show("start");
      note.open("index.md");
      // The page lives on through the hide.
      await background();
      expect(heldText("index.md")).toMatchObject({ content: "T1" });
      await vault.land(0);

      expect(saveNote).toHaveBeenCalledTimes(1);
      expect(landedAs("T1", vault.disk())).toBe(true);
      expect(heldTexts("index.md")).toEqual([]);
      expect(note.status()).not.toBe("error");
    });

    it("holds and resends on hide once the reopened buffer took the text of the write in the air", async () => {
      const vault = server("start");
      const { note, type, show, outside } = withEditor("start");

      type("T1");
      await idle();
      note.seed("b.md", "b");
      note.open("b.md");
      show("start");
      note.open("index.md");
      // The buffer takes the write's text: it follows that write now.
      outside("T1");
      await pagehide();

      expect(vault.request(1)).toMatchObject({ content: "T1", keepalive: true });
      expect(heldText("index.md")).toMatchObject({ content: "T1" });
    });

    it("keeps a quiet write's text when it fails after the buffer reopened on the text under it", async () => {
      const vault = server("start");
      const { note, type, show } = withEditor("start");

      type("T1");
      await idle();
      note.seed("b.md", "b");
      note.open("b.md");
      show("start");
      note.open("index.md");
      await vault.fail(0);

      expect(saveNote).toHaveBeenCalledTimes(1);
      expect(heldText("index.md")).toMatchObject({ content: "T1" });
    });

    /** T1's quiet write in the air, the buffer reopened on "start" and typed on. */
    function typedOnTheTextUnder() {
      const vault = server("start");
      const editor = withEditor("start");
      editor.type("T1");
      return {
        vault,
        editor,
        reopenAndType: async () => {
          await idle();
          editor.note.seed("b.md", "b");
          editor.note.open("b.md");
          editor.show("start");
          editor.note.open("index.md");
          editor.type("start T2");
        },
      };
    }

    it("holds the write in the air off screen beside text typed on the text under it when the page dies at hide", async () => {
      const { vault, reopenAndType } = typedOnTheTextUnder();
      await reopenAndType();
      await pagehide();
      // W1 dies with the page; the keepalive names "start" and lands.
      expect(vault.request(1)).toMatchObject({ content: "start T2", keepalive: true });
      await vault.arrive(1);

      expect(landedAs("start T2", vault.disk())).toBe(true);
      expect(heldTexts("index.md").map((entry) => entry.content)).toEqual(["T1", "start T2"]);
      // The next page opens on T1, which the vault never got.
      expect(heldText("index.md", vault.disk())).toMatchObject({ content: "T1" });
      const again = reopen(vault.disk(), "T1");
      expect(again.restored()).toBe(true);
    });

    it("holds the write in the air beside text typed on the text under it when a phone backgrounds the page and it dies", async () => {
      const { vault, reopenAndType } = typedOnTheTextUnder();
      await reopenAndType();
      await background();
      await vault.arrive(1);

      expect(landedAs("start T2", vault.disk())).toBe(true);
      expect(heldTexts("index.md").map((entry) => entry.content)).toEqual(["T1", "start T2"]);
    });

    it("drops the copy of the write in the air once it lands after a hide with text typed on the text under it", async () => {
      const { vault, editor, reopenAndType } = typedOnTheTextUnder();
      await reopenAndType();
      // The page lives on through the hide.
      await pagehide();
      await vault.land(0);
      await vault.land(1);

      expect(landedAs("T1", vault.disk())).toBe(true);
      expect(heldTexts("index.md")).toEqual([
        expect.objectContaining({ content: "start T2", conflicted: true }),
      ]);
      expect(editor.note.status()).toBe("conflict");
    });

    it("holds the write in the air once when the vault refuses it after the keepalive of text typed on the text under it", async () => {
      const { vault, reopenAndType } = typedOnTheTextUnder();
      await reopenAndType();
      await pagehide();
      await vault.land(1);
      await vault.land(0);

      expect(landedAs("start T2", vault.disk())).toBe(true);
      expect(heldTexts("index.md")).toEqual([
        expect.objectContaining({ content: "T1", conflicted: true }),
      ]);
    });

    it("holds the write in the air once when it fails after a hide with text typed on the text under it", async () => {
      const { vault, reopenAndType } = typedOnTheTextUnder();
      await reopenAndType();
      await pagehide();
      await vault.fail(0);

      expect(heldTexts("index.md").map((entry) => entry.content)).toEqual(["T1", "start T2"]);
      await vault.land(1);
      expect(landedAs("start T2", vault.disk())).toBe(true);
      expect(heldTexts("index.md").map((entry) => entry.content)).toEqual(["T1"]);
    });

    it("drops the copy of the write in the air on reopening once it reached the vault before the page died", async () => {
      const { vault, reopenAndType } = typedOnTheTextUnder();
      await reopenAndType();
      await pagehide();
      // W1 reaches the vault, then the keepalive naming "start" is refused there.
      await vault.arrive(0);
      await vault.arrive(1);
      expect(heldTexts("index.md").map((entry) => entry.content)).toEqual(["T1", "start T2"]);

      // The next page opens on the oldest entry, T1, which the vault holds.
      reopen(vault.disk(), "T1");
      expect(landedAs("T1", vault.disk())).toBe(true);
      expect(heldTexts("index.md").map((entry) => entry.content)).toEqual(["start T2"]);
    });

    it("holds the write in the air off screen when the page dies with a quiet write of the reopened buffer queued behind it", async () => {
      const { vault, editor, reopenAndType } = typedOnTheTextUnder();
      await reopenAndType();
      // W2 of "start T2" waits behind W1; the keepalive follows W2, not W1.
      await idle();
      editor.type("start T2b");
      await pagehide();
      expect(vault.request(1)).toMatchObject({
        content: "start T2b",
        keepalive: true,
        base: noteBase("start"),
      });
      await vault.arrive(1);

      expect(landedAs("start T2b", vault.disk())).toBe(true);
      expect(heldTexts("index.md").map((entry) => entry.content)).toEqual(["T1", "start T2b"]);
    });

    it("holds the write in the air off screen when a phone backgrounds the page with a quiet write of the reopened buffer queued behind it", async () => {
      const { vault, editor, reopenAndType } = typedOnTheTextUnder();
      await reopenAndType();
      await idle();
      editor.type("start T2b");
      await background();
      await vault.arrive(1);

      expect(landedAs("start T2b", vault.disk())).toBe(true);
      expect(heldTexts("index.md").map((entry) => entry.content)).toEqual(["T1", "start T2b"]);
    });

    it("keeps the write in the air on disk when it lands after a hide with a quiet write of the reopened buffer queued behind it", async () => {
      const { vault, editor, reopenAndType } = typedOnTheTextUnder();
      await reopenAndType();
      await idle();
      editor.type("start T2b");
      // The page lives on through the hide.
      await pagehide();
      await vault.land(0);
      await vault.land(1);
      await vault.land(2);

      // Typed on "start" and not on T1: the vault refuses both, and T1 stands.
      expect(landedAs("T1", vault.disk())).toBe(true);
      expect(heldTexts("index.md")).toEqual([
        expect.objectContaining({ content: "start T2b", conflicted: true }),
      ]);
      expect(editor.note.status()).toBe("conflict");
    });

    it("names the reopened buffer's own write on hide once it went out with the text of the write it never took", async () => {
      const vault = server("start");
      const { note, type, show } = withEditor("start");

      type("T1");
      await idle();
      note.seed("b.md", "b");
      note.open("b.md");
      show("start");
      note.open("index.md");
      // The same text typed again on "start": W2 waits behind W1.
      type("T1");
      await idle();
      await vault.land(0);
      expect(vault.request(1)).toMatchObject({ content: "T1", keepalive: false });
      type("T1 more");
      await pagehide();
      expect(vault.request(2)).toMatchObject({ content: "T1 more", keepalive: true });
      await vault.land(1);
      await vault.land(2);

      expect(landedAs("T1 more", vault.disk())).toBe(true);
      expect(heldTexts("index.md")).toEqual([]);
      expect(note.status()).toBe("saved");
    });

    it("holds a queued write off screen when the page dies with the reopened buffer's write queued behind it", async () => {
      const vault = server("start");
      const { note, type, show } = withEditor("start");

      type("T0");
      await idle();
      type("T1");
      note.startSave();
      note.seed("b.md", "b");
      note.open("b.md");
      show("start");
      note.open("index.md");
      type("start T2");
      await idle();
      type("start T2b");
      await pagehide();
      // W0 is the only write that went out; the keepalive names the base.
      expect(vault.request(1)).toMatchObject({
        content: "start T2b",
        keepalive: true,
        base: noteBase("start"),
      });

      expect(heldTexts("index.md").map((entry) => entry.content)).toEqual(["T1", "start T2b"]);
    });

    describe("a live conflict the vault comes to settle (#269)", () => {
      /** Somebody else's write of `text`, stamped as `PUT` stamps it. */
      const stamped = (text: string) => `---\nmodified: other\n---\n${text}`;

      /** "T1" typed on "start", refused over somebody else's "X". */
      async function standing() {
        const vault = server("start");
        const editor = withEditor("start");
        editor.type("T1");
        vault.write("X");
        await idle();
        await vault.land(0);
        expect(editor.note.status()).toBe("conflict");
        return { vault, ...editor };
      }

      /** An outside write's event, and the refetch the route makes when told yes. */
      function event(
        vault: ReturnType<typeof server>,
        outside: (text: string) => void,
        note: ReturnType<typeof renderAutosave>,
      ) {
        if (note.reconcile()) outside(vault.disk());
      }

      it("clears a live conflict once another writer writes the buffer's text", async () => {
        const { vault, note, outside, shown } = await standing();

        vault.write(stamped("T1"));
        event(vault, outside, note);

        expect(note.status()).toBe("saved");
        expect(landedAs("T1", shown())).toBe(true);
      });

      it("keeps a live conflict and the buffer when another writer writes other text", async () => {
        const { vault, note, outside, shown } = await standing();

        vault.write(stamped("Y"));
        event(vault, outside, note);

        expect(note.status()).toBe("conflict");
        expect(shown()).toBe("T1");
        expect(heldText("index.md")).toMatchObject({ content: "T1", conflicted: true });
      });

      it("writes the next key on the vault's text once a live conflict cleared itself", async () => {
        const { vault, note, outside, type } = await standing();

        vault.write(stamped("T1"));
        event(vault, outside, note);
        type("T1 more");
        await idle();
        await vault.land(1);

        expect(saveNote).toHaveBeenLastCalledWith(
          "index.md",
          "T1 more",
          false,
          noteBase(stamped("T1")),
        );
        expect(landedAs("T1 more", vault.disk())).toBe(true);
        expect(note.status()).toBe("saved");
      });

      it("drops the held entry of a live conflict that cleared itself", async () => {
        const { vault, note, outside } = await standing();
        expect(heldTexts("index.md")).toHaveLength(1);

        vault.write(stamped("T1"));
        event(vault, outside, note);

        expect(heldTexts("index.md")).toEqual([]);
        expect(heldRows()).toEqual([]);
      });

      it("declines and marks missed the buffer's text written while :w of a conflict is in the air", async () => {
        const { vault, note } = await standing();
        const invalidate = vi.spyOn(note.client, "invalidateQueries");

        note.startSave();
        vault.write(stamped("T1"));
        expect(note.reconcile()).toBe(false);
        expect(invalidate).not.toHaveBeenCalled();
        await vault.land(1);

        expect(invalidate).toHaveBeenCalledWith(
          { queryKey: ["note", "index.md"] },
          { cancelRefetch: false },
        );
      });
    });

    describe("leaving the route with a write in the air (#382)", () => {
      // The editor's `pagehide` listener goes with the route, so a page closed
      // after the leave hears nothing: what is held at the leave is all there is.
      const left = (content: string, base = "start") => ({
        content,
        reason: "Not yet written when the note was left",
        conflicted: false,
        base,
      });

      /** The editor mounted again on the route's cache, which the leave put T1 in. */
      const cameBack = (note: ReturnType<typeof renderAutosave>, path = "index.md") => {
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

      it("holds the flush on leaving the route when the page goes before it answers", async () => {
        const vault = server("start");
        const { note, type } = withEditor("start");

        type("T1");
        note.unmount();
        await pagehide();

        expect(vault.request(0)).toMatchObject({ content: "T1", keepalive: false });
        expect(heldTexts("index.md")).toEqual([left("T1")]);
      });

      it("holds a quiet write in the air on leaving the route with nothing waiting", async () => {
        const vault = server("start");
        const { note, type } = withEditor("start");

        type("T1");
        await idle();
        note.unmount();
        await pagehide();

        expect(vault.request(1)).toBeUndefined();
        expect(heldTexts("index.md")).toEqual([left("T1")]);
      });

      it("holds the flush on leaving the route when a phone backgrounds the app before it answers", async () => {
        server("start");
        const { note, type } = withEditor("start");

        type("T1");
        note.unmount();
        await background();

        expect(heldTexts("index.md")).toEqual([left("T1")]);
      });

      it("offers the flush on leaving the route after a reload that cancelled it (#381)", async () => {
        const vault = server("start");
        const { note, type } = withEditor("start");

        type("T1");
        await idle();
        type("T2");
        note.unmount();
        // The reload: the page and its writes are gone, storage is not.
        resetHeld();
        expect(heldTexts("index.md")).toEqual([{ ...left("T2"), after: "T1" }]);

        const again = reopen(vault.disk(), "T2");
        expect(again.status()).toBe("error");
        expect(heldText("index.md")?.content).toBe("T2");
      });

      it("drops the text held on leaving the route once the flush lands", async () => {
        const vault = server("start");
        const { note, type } = withEditor("start");

        type("T1");
        note.unmount();
        expect(heldTexts("index.md")).toHaveLength(1);
        await vault.land(0);

        expect(heldTexts("index.md")).toEqual([]);
        expect(heldRows()).toEqual([]);
      });

      it("drops the text held on leaving the route once the quiet write in the air lands", async () => {
        const vault = server("start");
        const { note, type } = withEditor("start");

        type("T1");
        await idle();
        note.unmount();
        expect(heldTexts("index.md")).toHaveLength(1);
        await vault.land(0);

        expect(heldTexts("index.md")).toEqual([]);
        expect(heldRows()).toEqual([]);
      });

      it("keeps one entry when the flush on leaving the route fails", async () => {
        const vault = server("start");
        const { note, type } = withEditor("start");

        type("T1");
        note.unmount();
        await vault.fail(0);

        expect(heldTexts("index.md")).toMatchObject([
          { content: "T1", reason: "PUT /api/files/index.md failed with 500" },
        ]);
      });

      it("holds nothing on leaving the route once every write answered", async () => {
        const vault = server("start");
        const { note, type } = withEditor("start");

        type("T1");
        await idle();
        await vault.land(0);
        note.unmount();
        await pagehide();

        expect(saveNote).toHaveBeenCalledOnce();
        expect(heldRows()).toEqual([]);
      });

      it("never lands the flush over text typed after the route came back", async () => {
        const vault = server("start");
        const { note, type } = withEditor("start");

        type("T1");
        note.unmount();
        // The editor mounted again on the route's cache, which the leave put
        // the flush's text in.
        let doc = "T1";
        const again = renderAutosave("index.md", () => doc, note.client);
        expect(again.allowReload("T1")).toBe(true);
        doc = "T2";
        again.change("T2");
        await pagehide();
        expect(vault.request(1)).toMatchObject({
          content: "T2",
          keepalive: true,
          base: noteBase("T1"),
        });
        // The page is gone: the flush was cancelled and the keepalive is refused.
        await vault.arrive(1);

        expect(vault.disk()).toBe("start");
        // Typed on the flush's text, over the vault's own: nobody else wrote.
        expect(heldTexts("index.md")).toMatchObject([
          { content: "T2", base: "start", after: "T1" },
        ]);
        const back = reopen(vault.disk(), "T2");
        expect(heldText("index.md")?.content).toBe("T2");
        expect(back.status()).toBe("error");
      });

      it("holds text typed after the route came back as an error when a phone backgrounds the page and it dies", async () => {
        const vault = server("start");
        const { note, type } = withEditor("start");

        type("T1");
        note.unmount();
        const { type: retype } = cameBack(note);
        retype("T2");
        await background();
        expect(vault.request(1)).toMatchObject({ content: "T2", keepalive: true });
        await vault.arrive(1);

        expect(vault.disk()).toBe("start");
        const back = reopen(vault.disk(), "T2");
        expect(heldText("index.md")?.content).toBe("T2");
        expect(back.status()).toBe("error");
      });

      it("keeps the flush held when the route comes back on it before it answers", async () => {
        // The cache holds the flush's text because the leave put it there, not
        // because the vault does: a page closed now still cancels the flush.
        const vault = server("start");
        const { note, type } = withEditor("start");

        type("T1");
        note.unmount();
        const again = renderAutosave("index.md", () => "T1", note.client);
        expect(again.allowReload("T1")).toBe(true);
        expect(again.status()).toBe("saved");
        expect(heldRows()).toHaveLength(1);
        await pagehide();

        expect(vault.request(1)).toBeUndefined();
        expect(heldTexts("index.md")).toEqual([left("T1")]);
      });

      it("drops the flush held when it lands after the route came back on it", async () => {
        const vault = server("start");
        const { note, type } = withEditor("start");

        type("T1");
        note.unmount();
        const again = renderAutosave("index.md", () => "T1", note.client);
        again.allowReload("T1");
        await vault.land(0);

        expect(heldTexts("index.md")).toEqual([]);
        expect(again.status()).toBe("saved");
      });

      it("takes the leave flush's failure into the buffer that came back on it", async () => {
        const vault = server("start");
        const { note, type } = withEditor("start");

        type("T1");
        note.unmount();
        const { again, type: retype } = cameBack(note);
        await vault.fail(0);

        expect(again.status()).toBe("error");
        expect(heldTexts("index.md")).toHaveLength(1);
        expect(again.taken()).toBe(heldTexts("index.md")[0]);
        // The vault never moved off "start", so the next write names it.
        retype("T1x");
        await idle();
        expect(vault.request(1)).toMatchObject({ content: "T1x", base: noteBase("start") });
        await vault.land(1);
        expect(again.status()).toBe("saved");
        expect(heldTexts("index.md")).toEqual([]);
      });

      it("writes the text :e! chose behind the leave flush after the route came back", async () => {
        const vault = server("start");
        const { note, type } = withEditor("start");

        type("T1");
        note.unmount();
        const { again, show } = cameBack(note);
        // `:e!`: the route reads the vault into the cache, then asks.
        again.seed("index.md", "start");
        expect(again.revert(true)).toBe(true);
        show("start");
        expect(vault.request(1)).toBeUndefined();
        await vault.land(0);
        expect(vault.request(1)).toMatchObject({ content: "start", base: noteBase(vault.disk()) });
        await vault.land(1);

        expect(landedAs("start", vault.disk())).toBe(true);
        expect(landedAs("start", String(again.cached("index.md")))).toBe(true);
        expect(again.status()).toBe("saved");
        expect(heldTexts("index.md")).toEqual([]);
      });

      it("holds nothing when the leave flush fails after :e! once the route came back", async () => {
        const vault = server("start");
        const { note, type } = withEditor("start");

        type("T1");
        note.unmount();
        const { again, show } = cameBack(note);
        again.seed("index.md", "start");
        again.revert(true);
        show("start");
        await vault.fail(0);
        await vault.land(1);

        expect(landedAs("start", vault.disk())).toBe(true);
        expect(heldTexts("index.md")).toEqual([]);
        expect(again.status()).toBe("saved");
      });

      it("names the text :e! chose after the route came back when the leave flush is refused", async () => {
        const vault = server("start");
        const { note, type } = withEditor("start");

        type("T1");
        note.unmount();
        const { again, type: retype, show } = cameBack(note);
        vault.write("X");
        again.seed("index.md", "X");
        again.revert(true);
        show("X");
        await vault.land(0);
        // The write putting X back fails, so only `:e!` told the buffer of X.
        await vault.fail(1);
        retype("X2");
        await idle();
        expect(vault.request(2)).toMatchObject({ content: "X2", base: noteBase("X") });
        await vault.land(2);

        expect(landedAs("X2", vault.disk())).toBe(true);
        expect(again.status()).toBe("saved");
      });

      it("keeps text typed after the route came back when the note is reopened within the route on the leave flush's text", async () => {
        const vault = server("start");
        const { note, type } = withEditor("start");

        type("T1");
        note.unmount();
        const { again, type: retype, show } = cameBack(note);
        retype("T1 T2");
        await idle();
        again.seed("b.md", "b");
        show("b");
        again.open("b.md");
        // The cache still holds the leave's T1, and the entry of it: the
        // editor opens on T1, which W2's "T1 T2" was typed over.
        show("T1");
        again.open("index.md");
        again.allowReload("T1");
        retype("T1 k");
        await idle();
        await vault.land(0);
        await vault.land(1);
        await vault.land(2);

        expect(landedAs("T1 T2", vault.disk())).toBe(true);
        expect(again.status()).toBe("conflict");
        expect(heldTexts("index.md").map((entry) => entry.content)).toContain("T1 k");
      });

      it("names the leave flush's answer for text typed after the route came back", async () => {
        const vault = server("start");
        const { note, type } = withEditor("start");

        type("T1");
        note.unmount();
        const { again, type: retype } = cameBack(note);
        retype("T1 T2");
        await idle();
        expect(vault.request(1)).toBeUndefined();
        await vault.land(0);
        expect(vault.request(1)).toMatchObject({ content: "T1 T2", base: noteBase(vault.disk()) });
        await vault.land(1);

        expect(landedAs("T1 T2", vault.disk())).toBe(true);
        expect(heldTexts("index.md")).toEqual([]);
        expect(again.status()).toBe("saved");
      });

      it("holds both texts when the leave flush is refused after the route came back and text was typed", async () => {
        const vault = server("start");
        const { note, type } = withEditor("start");

        type("T1");
        note.unmount();
        const { again, type: retype } = cameBack(note);
        retype("T1 T2");
        await idle();
        vault.write("X");
        await vault.land(0);
        await vault.land(1);

        expect(vault.disk()).toBe("X");
        expect(again.status()).toBe("conflict");
        // T2 was typed on T1 and carries it: one entry, with both.
        expect(heldTexts("index.md").map((entry) => entry.content)).toEqual(["T1 T2"]);
      });

      it("keeps another note's queue apart after the route came back", async () => {
        const vault = server("start");
        const { note, type } = withEditor("start");

        type("T1");
        note.unmount();
        note.seed("b.md", "b");
        const { again, type: retype } = cameBack(note, "b.md");
        expect(again.isWriting("index.md")).toBe(true);
        expect(again.isWriting("b.md")).toBe(false);
        retype("b2");
        await idle();
        expect(vault.request(1)).toMatchObject({ content: "b2" });
        await vault.fail(0);

        expect(again.status()).toBe("saving");
        expect(again.restored()).toBe(false);
        expect(heldText("b.md")).toBeUndefined();
      });

      it("refuses :e after the route came back while the leave flush is in the air", async () => {
        const vault = server("start");
        const { note, type } = withEditor("start");

        type("T1");
        note.unmount();
        const { again } = cameBack(note);

        expect(again.revert(false)).toBe(false);
        await vault.land(0);
        expect(again.revert(false)).toBe(true);
      });

      it("lets a rename after the route came back wait for the leave flush, and refuses when it fails", async () => {
        const vault = server("start");
        const { note, type } = withEditor("start");

        type("T1");
        note.unmount();
        const { again } = cameBack(note);
        let answer: boolean | undefined;
        void again.askSaveFirst().then((landed) => {
          answer = landed;
        });
        await settled();
        expect(answer).toBeUndefined();
        await vault.fail(0);

        expect(answer).toBe(false);
      });
    });
  });
});
