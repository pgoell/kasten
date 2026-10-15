import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { ChangedOnDisk } from "@/lib/api";
import { heldText, heldTexts, holdText, moveHeld, resetHeld, useHeld } from "@/lib/held-text";
import { noteBase } from "@/lib/note-base";
import { useAutosave } from "@/lib/use-autosave";

const { saveNote } = vi.hoisted(() => ({ saveNote: vi.fn() }));
// The real refusal, which the hook tells apart from every other failure.
vi.mock("@/lib/api", async (importOriginal) => ({
  saveNote,
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
function renderAutosave(path = "index.md", shown?: () => string | undefined) {
  const queryClient = new QueryClient();
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
    // Back before the flush answers, so the buffer opens on the vault's text.
    note.open("index.md");
    expect(note.allowReload("the index note")).toBe(true);
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
    expect(note.allowReload("the index note")).toBe(true);
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
      expect(note.allowReload("the index note")).toBe(true);
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

      expect(note.cached("index.md")).toBe("start");
      await second.finish();
      expect(note.cached("index.md")).toBe(written("from pane b").content);
    });
  });
});
