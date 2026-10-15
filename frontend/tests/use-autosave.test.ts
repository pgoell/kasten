import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { ChangedOnDisk } from "@/lib/api";
import { heldText, holdText, moveHeld, resetHeld } from "@/lib/held-text";
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
 * The hook, following `path`. `shown` stands in for the focused editor's
 * document, which the route reads off the view.
 */
function renderAutosave(path = "index.md", shown?: () => string | undefined) {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);

  const { result, rerender, unmount } = renderHook(({ open }) => useAutosave(open, shown), {
    initialProps: { open: path },
    wrapper,
  });

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
    restored: () => result.current.restored,
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
      act(() => {
        result.current.revert(force);
      });
    },
    /** The vault reporting a write to the open note, which is all an event says. */
    reconcile: () => {
      let reload: boolean | undefined;
      act(() => {
        reload = result.current.reconcile();
      });
      return reload;
    },
    open: (next: string) => act(() => rerender({ open: next })),
    unmount: () => act(() => unmount()),
    cached: (of: string) => queryClient.getQueryData(["note", of]),
    /** Put a note in the cache, which is what an editor already open was opened on. */
    seed: (of: string, text: string) => queryClient.setQueryData(["note", of], text),
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
    pendingSave();
    note.change("# sent quietly");
    await idle();
    // The keepalive that never answers: the page went away under it.
    saveNote.mockImplementationOnce(() => new Promise(() => {}));

    await pagehide();

    expect(heldText("index.md")?.content).toBe("# sent quietly");
    expect(saveNote).toHaveBeenNthCalledWith(2, "index.md", "# sent quietly", true);
  });

  it("holds and resends a quiet write still in flight when a phone backgrounds the page", async () => {
    const note = renderAutosave("index.md");
    pendingSave();
    note.change("# sent quietly");
    await idle();
    saveNote.mockImplementationOnce(() => new Promise(() => {}));

    await background();

    expect(heldText("index.md")?.content).toBe("# sent quietly");
    expect(saveNote).toHaveBeenNthCalledWith(2, "index.md", "# sent quietly", true);
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
    expect(saveNote).toHaveBeenNthCalledWith(2, "index.md", "# typed after", true);
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
      expect(note.reconcile()).toBe(true);
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
});
