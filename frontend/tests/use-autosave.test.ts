import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { ChangedOnDisk } from "@/lib/api";
import { heldText, holdText, moveHeld, resetHeld, unstamped } from "@/lib/held-text";
import { useAutosave } from "@/lib/use-autosave";
import { digestOf } from "@/lib/vault-events";

// crypto finishes a digest off the event loop, which no fake timer reaches, so
// the real timer is kept from before the fakes go in. `hashed` below is what
// the tests wait on for the hash of a write to land.
const realTimeout = globalThis.setTimeout;

const { saveNote } = vi.hoisted(() => ({ saveNote: vi.fn() }));
// The real refusal, which the hook tells apart from every other failure.
vi.mock("@/lib/api", async (importOriginal) => ({
  saveNote,
  ChangedOnDisk: (await importOriginal<typeof import("@/lib/api")>()).ChangedOnDisk,
}));

// The real digest behind a spy, so one test can hold a hash back and land it
// after a later one.
const { real } = vi.hoisted(() => ({ real: { digestOf: (_: string) => Promise.resolve("") } }));
vi.mock("@/lib/vault-events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/vault-events")>();
  real.digestOf = actual.digestOf;
  return { ...actual, digestOf: vi.fn(actual.digestOf) };
});

/**
 * The note as the vault holds it once `content` has been written to it.
 *
 * `PUT` stamps a fresh `modified` on the way through, so what lands on disk is
 * never the text that was sent. Every test here writes through that, because
 * the difference is what the cache and the digest are about.
 */
function written(content: string) {
  return { path: "index.md", content: `${content}\nmodified: now` };
}

/** The base a save names for `text` on disk: its sha256, `modified` set aside. */
function baseOf(text: string): Promise<string> {
  return real.digestOf(unstamped(text));
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

  return {
    finish: () => act(async () => settle?.()),
    break: () => act(async () => fail?.()),
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
    /** Tell the hook a write the route made was its own. */
    adopt: (of: string, content: string) => act(() => result.current.adopt(of, content)),
    /** Throw the buffer away, which is what `:e!` does. */
    revert: (force: boolean) => {
      act(() => {
        result.current.revert(force);
      });
    },
    reconcile: (digest: string | null) => {
      let reload: boolean | undefined;
      act(() => {
        reload = result.current.reconcile(digest);
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

/** Let the digest of what the vault answered with land, which takes a real tick. */
async function hashed() {
  await act(async () => {
    await new Promise((resolve) => realTimeout(resolve, 0));
  });
}

/** Hold the next digest back until the returned call, the way a slow `crypto.subtle` would. */
function holdDigest(): () => void {
  let release: (() => void) | undefined;
  vi.mocked(digestOf).mockImplementationOnce(
    (text) =>
      new Promise((resolve) => {
        release = () => void real.digestOf(text).then(resolve);
      }),
  );
  return () => release?.();
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
    // A flush naming a base goes out once its hash lands, a real tick away,
    // and would otherwise reach the next test's mock.
    await hashed();
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

  it("asks for no reload when the write the vault reports is its own", async () => {
    // Every write comes back over the stream, this hook's included. Reading
    // that as somebody else's would flag a false conflict on every autosave
    // the typing carried on through.
    const note = renderAutosave();

    note.change("# edited");
    await idle();
    await hashed();

    expect(note.reconcile(await digestOf(written("# edited").content))).toBe(false);
    expect(note.status()).toBe("saved");
  });

  it("asks for the reload when the buffer holds nothing unwritten", async () => {
    const note = renderAutosave();

    expect(note.reconcile("0".repeat(64))).toBe(true);
    expect(note.status()).toBe("saved");
  });

  it("refuses the reload and says so when text is still waiting", async () => {
    const note = renderAutosave();

    note.change("# edited");

    expect(note.reconcile("0".repeat(64))).toBe(false);
    expect(note.status()).toBe("conflict");
  });

  it("keeps saying so while the note is typed into", async () => {
    // Typing does not settle anything: the vault still holds text this buffer
    // never saw, and a reading of `unsaved` would promise a write that the
    // quiet period no longer makes.
    const note = renderAutosave();

    note.change("# edited");
    note.reconcile("0".repeat(64));
    note.change("# edited more");

    expect(note.status()).toBe("conflict");
  });

  it("writes nothing on the quiet period while the note stands conflicted", async () => {
    const note = renderAutosave();

    note.change("# edited");
    note.reconcile("0".repeat(64));
    note.change("# edited more");
    await idle();

    expect(saveNote).not.toHaveBeenCalled();
    expect(note.status()).toBe("conflict");
  });

  it("overwrites the vault when saved by hand, which is what clears the conflict", async () => {
    // `:w` is the reader deciding, and the only way past a conflict. The text
    // it keeps is theirs, not the vault's.
    const note = renderAutosave();

    note.change("# edited");
    note.reconcile("0".repeat(64));
    await act(async () => note.save());

    expect(saveNote).toHaveBeenCalledWith("index.md", "# edited");
    expect(note.status()).toBe("saved");

    // And the quiet period writes again afterwards. A conflict left standing
    // stops every automatic write there is, and the bar would go on reading
    // `Saved` while nothing at all reached the vault.
    note.change("# edited again");
    await idle();
    await hashed();

    expect(saveNote).toHaveBeenLastCalledWith(
      "index.md",
      "# edited again",
      false,
      await baseOf(written("# edited").content),
    );
    expect(note.status()).toBe("saved");
  });

  it("clears a conflict when the vault comes to hold the buffer's text", async () => {
    const note = renderAutosave();

    note.change("# edited");
    note.reconcile("0".repeat(64));
    expect(note.status()).toBe("conflict");

    expect(note.allowReload("# edited")).toBe(true);
    expect(note.status()).toBe("saved");
    await idle();
    expect(saveNote).not.toHaveBeenCalled();
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

  it("takes nothing from the vault while text is waiting, and says so", async () => {
    const note = renderAutosave();

    note.change("# edited");

    expect(note.allowReload("# somebody else wrote this")).toBe(false);
    expect(note.status()).toBe("conflict");
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
    note.reconcile("0".repeat(64));

    expect(await note.saveFirst()).toBe(false);
    expect(saveNote).not.toHaveBeenCalled();
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
  it("takes a write the route made as one of its own", async () => {
    const note = renderAutosave();
    const bookmark = "the index note\nreading: epubcfi(/6/4)";

    note.change("# edited");
    note.adopt("index.md", bookmark);
    await hashed();

    expect(note.reconcile(await digestOf(bookmark))).toBe(false);
    expect(note.status()).toBe("unsaved");
  });

  it("takes the same write coming back through the editor", async () => {
    // The other reader of it: the cache moves first, the editor's reload effect
    // asks, and the adopted text is what makes it refuse without flagging.
    const note = renderAutosave();
    const bookmark = "the index note\nreading: epubcfi(/6/4)";

    note.change("# edited");
    note.adopt("index.md", bookmark);
    await hashed();

    expect(note.allowReload(bookmark)).toBe(false);
    expect(note.status()).toBe("unsaved");
  });

  it("takes the write through the editor before its digest has landed", () => {
    // The route moves the cache straight after `adopt`, and the cache notifies
    // on a zero-delay timer, which on a loaded machine runs before
    // `crypto.subtle` answers. The editor's question is about text, so nothing
    // here waits on the digest.
    const note = renderAutosave();
    const bookmark = "the index note\nreading: epubcfi(/6/4)";

    note.change("# edited");
    note.adopt("index.md", bookmark);

    expect(note.allowReload(bookmark)).toBe(false);
    expect(note.status()).toBe("unsaved");
  });

  it("takes the write off the stream before its digest has landed", async () => {
    // The event carries a digest, which `adopt` only has once `crypto.subtle`
    // answers. An event arriving inside that wait is answered when it does.
    const note = renderAutosave();
    const bookmark = "the index note\nreading: epubcfi(/6/4)";
    const digest = await digestOf(bookmark);

    note.change("# edited");
    note.adopt("index.md", bookmark);

    expect(note.reconcile(digest)).toBe(false);
    expect(note.status()).toBe("unsaved");
    // Queued behind adopt's own digest of the same text, so by now it is in.
    await digestOf(bookmark);
    await hashed();
    expect(note.status()).toBe("unsaved");
  });

  it("still flags somebody else's write that arrives while a digest is out", async () => {
    const note = renderAutosave();
    // Taken before `adopt`, so its own digest is still out when the event lands.
    const other = await digestOf("somebody else's text");

    note.change("# edited");
    note.adopt("index.md", "the index note\nreading: epubcfi(/6/4)");

    expect(note.reconcile(other)).toBe(false);
    expect(note.status()).toBe("unsaved");
    await vi.waitFor(() => expect(note.status()).toBe("conflict"));
  });

  it("writes nothing over a write it cannot place yet", async () => {
    // Until the digests are in, the event may be somebody else's, and a save
    // now would overwrite it with no conflict ever shown. Held the way a
    // conflict holds: a key that saves first refuses, and the timer waits.
    const note = renderAutosave();
    const other = await digestOf("somebody else's text");

    note.change("# edited");
    note.adopt("index.md", "the index note\nreading: epubcfi(/6/4)");
    note.reconcile(other);

    expect(await note.saveFirst()).toBe(false);
    await idle();
    expect(saveNote).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(note.status()).toBe("conflict"));
  });

  it("saves as it would have once the held write turns out to be its own", async () => {
    const note = renderAutosave();
    const bookmark = "the index note\nreading: epubcfi(/6/4)";
    const digest = await digestOf(bookmark);

    note.change("# edited");
    note.adopt("index.md", bookmark);
    note.reconcile(digest);
    await idle();
    expect(saveNote).not.toHaveBeenCalled();

    const base = await baseOf(bookmark);
    await vi.waitFor(async () => {
      await idle();
      await hashed();
      expect(saveNote).toHaveBeenCalledWith("index.md", "# edited", false, base);
    });
    expect(note.status()).not.toBe("conflict");
  });

  it("still knows its own write when a bookmark lands between it and its event", async () => {
    // What fails when the adopted write shares `lastWritten`: the hook reads
    // its own save as somebody else's and locks the editor, which is the exact
    // fault `adopt` exists to prevent, reached from the other side.
    const note = renderAutosave();

    note.change("# edited");
    await idle();
    await hashed();
    note.change("# edited more");
    note.adopt("index.md", "a bookmark landing in between");
    await hashed();

    expect(note.reconcile(await digestOf(written("# edited").content))).toBe(false);
    expect(note.status()).toBe("unsaved");
  });

  it("takes nothing for a note it is not following", async () => {
    const note = renderAutosave();
    const bookmark = "another note\nreading: epubcfi(/6/4)";

    note.change("# edited");
    note.adopt("other.md", bookmark);
    await hashed();

    expect(note.allowReload(bookmark)).toBe(false);
    expect(note.status()).toBe("conflict");
  });

  it("knows two adopted writes arriving in the order they were made", async () => {
    // A list rather than one slot, which would rest on a promise about how far
    // apart two bookmark writes can be that nothing here enforces.
    const note = renderAutosave();

    note.change("# edited");
    note.adopt("index.md", "the first bookmark");
    note.adopt("index.md", "the second bookmark");
    await hashed();

    expect(note.reconcile(await digestOf("the first bookmark"))).toBe(false);
    expect(note.reconcile(await digestOf("the second bookmark"))).toBe(false);
    expect(note.status()).toBe("unsaved");
  });

  it("flags an adopted text coming back after a later adopted write's event", async () => {
    // The stream reports one note's writes in the order they landed, so the
    // second bookmark's event means the first is on disk and its event is gone.
    // That text coming back now is somebody restoring it, a `jj undo` say.
    const note = renderAutosave();

    note.change("# edited");
    note.adopt("index.md", "the first bookmark");
    note.adopt("index.md", "the second bookmark");
    await hashed();

    expect(note.reconcile(await digestOf("the second bookmark"))).toBe(false);
    expect(note.status()).toBe("unsaved");
    expect(note.reconcile(await digestOf("the first bookmark"))).toBe(false);
    expect(note.status()).toBe("conflict");
  });

  it("flags the same restored text through the editor", async () => {
    const note = renderAutosave();

    note.change("# edited");
    note.adopt("index.md", "the first bookmark");
    note.adopt("index.md", "the second bookmark");
    await hashed();
    note.reconcile(await digestOf("the second bookmark"));

    expect(note.allowReload("the first bookmark")).toBe(false);
    expect(note.status()).toBe("conflict");
  });

  it("drops an adopted write whose event was lost once a later save of its own comes back", async () => {
    // The save went out after the bookmark was on disk, so its event came after
    // the bookmark's: that one is not coming any more.
    const note = renderAutosave();
    const bookmark = "the index note\nreading: epubcfi(/6/4)";

    note.change("# edited");
    note.adopt("index.md", bookmark);
    await idle();
    await hashed();
    expect(note.reconcile(await digestOf(written("# edited").content))).toBe(false);

    note.change("# edited more");
    expect(note.reconcile(await digestOf(bookmark))).toBe(false);
    expect(note.status()).toBe("conflict");
  });

  it("drops adopted writes in the order they were made, not the order they hashed", async () => {
    // `crypto.subtle` answers in any order. Held back here, the first digest
    // lands after the second's event has already said the first is on disk.
    const note = renderAutosave();
    let release: (() => void) | undefined;
    vi.mocked(digestOf).mockImplementationOnce(
      (text) =>
        new Promise((resolve) => {
          release = () => void real.digestOf(text).then(resolve);
        }),
    );

    note.change("# edited");
    note.adopt("index.md", "the first bookmark");
    note.adopt("index.md", "the second bookmark");
    await hashed();
    expect(note.reconcile(await digestOf("the second bookmark"))).toBe(false);
    await act(async () => release?.());
    await hashed();

    expect(note.reconcile(await digestOf("the first bookmark"))).toBe(false);
    expect(note.status()).toBe("conflict");
  });

  it("flags text it has not been told about yet", async () => {
    // Why the route adopts before it moves the cache. Nothing is adopted here,
    // so this passes before `adopt` exists and guards the other direction.
    const note = renderAutosave();

    note.change("# edited");

    expect(note.allowReload("a bookmark nobody mentioned")).toBe(false);
    expect(note.status()).toBe("conflict");
  });

  it("forgets an adopted write once the reader leaves the note and comes back", async () => {
    // The route drops events for other notes, so the adopted write's event can
    // be lost on the way to the other note. Kept, the entry would take somebody
    // restoring that text, a `jj undo` say, for our own write.
    const note = renderAutosave("index.md");
    const bookmark = "the index note\nreading: epubcfi(/6/4)";

    note.adopt("index.md", bookmark);
    await hashed();
    note.open("daily/2026-08-05.md");
    note.open("index.md");
    note.change("# edited");

    expect(note.allowReload(bookmark)).toBe(false);
    expect(note.status()).toBe("conflict");
  });

  it("flags the adopted text off the stream after the reader left and came back", async () => {
    const note = renderAutosave("index.md");
    const bookmark = "the index note\nreading: epubcfi(/6/4)";

    note.adopt("index.md", bookmark);
    await hashed();
    note.open("daily/2026-08-05.md");
    note.open("index.md");
    note.change("# edited");

    expect(note.reconcile(await digestOf(bookmark))).toBe(false);
    expect(note.status()).toBe("conflict");
  });

  it("forgets its own save once the reader leaves the note and comes back", async () => {
    const note = renderAutosave("index.md");

    note.change("# edited");
    await note.save();
    await hashed();
    note.open("daily/2026-08-05.md");
    note.open("index.md");
    note.change("# edited more");

    expect(note.allowReload(written("# edited").content)).toBe(false);
    expect(note.status()).toBe("conflict");
  });

  it("flags its own saved text off the stream after the reader left and came back", async () => {
    const note = renderAutosave("index.md");

    note.change("# edited");
    await note.save();
    await hashed();
    note.open("daily/2026-08-05.md");
    note.open("index.md");
    note.change("# edited more");

    expect(note.reconcile(await digestOf(written("# edited").content))).toBe(false);
    expect(note.status()).toBe("conflict");
  });

  it("still knows the new note's save when the old note's flush answers late", async () => {
    // The flush of the note left behind answers with the closure of that note,
    // after the hook already follows the next one. Taking the slots there would
    // read the new note's own save as somebody else's write.
    const note = renderAutosave("index.md");
    const flush = pendingSave();

    note.change("# left behind");
    note.open("daily/2026-08-05.md");
    note.change("# daily");
    await note.save();
    await hashed();
    await flush.finish();
    await hashed();
    note.change("# daily more");

    expect(note.reconcile(await digestOf(written("# daily").content))).toBe(false);
    expect(note.allowReload(written("# daily").content)).toBe(false);
    expect(note.status()).toBe("unsaved");
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
    note.reconcile("0".repeat(64));
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
    saveNote.mockRejectedValueOnce(new Error("failed with 500"));

    note.change("# mine");
    note.reconcile("0".repeat(64));
    note.open("daily/2026-08-05.md");
    await act(async () => {});

    expect(saveNote).not.toHaveBeenCalled();
    expect(heldText("index.md")).toMatchObject({
      content: "# mine",
      reason: "Changed on disk before the note was left",
      conflicted: true,
    });
  });

  it("holds a conflicted note's text and writes nothing when another note is opened", async () => {
    const note = renderAutosave("index.md");

    note.change("# mine");
    note.reconcile("0".repeat(64));
    note.open("daily/2026-08-05.md");
    await act(async () => {});

    expect(saveNote).not.toHaveBeenCalled();
    expect(heldText("index.md")).toMatchObject({ content: "# mine", conflicted: true });
    expect(note.status()).toBe("saved");
  });

  it("holds a conflicted note's text and writes nothing when the editor goes away", async () => {
    const note = renderAutosave("index.md");

    note.change("# mine");
    note.reconcile("0".repeat(64));
    note.unmount();
    await act(async () => {});

    expect(saveNote).not.toHaveBeenCalled();
    expect(heldText("index.md")).toMatchObject({ content: "# mine", conflicted: true });
  });

  it("holds and writes nothing when the note is left while an outside write is being placed", async () => {
    // The event may yet turn out to be somebody else's write, so it is held the
    // way a conflict is, and reopens as one.
    const note = renderAutosave("index.md");
    const other = await digestOf("somebody else's text");

    note.change("# edited");
    note.adopt("index.md", "the index note\nreading: epubcfi(/6/4)");
    note.reconcile(other);
    note.open("daily/2026-08-05.md");
    await hashed();
    await idle();

    expect(saveNote).not.toHaveBeenCalled();
    expect(heldText("index.md")).toMatchObject({ content: "# edited", conflicted: true });
    expect(note.status()).toBe("saved");
  });

  it("leaving with an event still being placed does not mark the next note conflicted", async () => {
    const note = renderAutosave("index.md");
    const other = await digestOf("somebody else's text");

    note.change("# edited");
    note.adopt("index.md", "the index note\nreading: epubcfi(/6/4)");
    note.reconcile(other);
    note.open("daily/2026-08-05.md");
    note.change("# daily");
    await hashed();

    expect(note.status()).not.toBe("conflict");
    await idle();
    expect(saveNote).toHaveBeenCalledWith("daily/2026-08-05.md", "# daily");
  });

  it("writes the next note's text only to the next note when a held event settles as ours after the switch", async () => {
    const note = renderAutosave("index.md");
    const bookmark = "the index note\nreading: epubcfi(/6/4)";
    const digest = await digestOf(bookmark);
    const release = holdDigest();

    note.change("# edited");
    note.adopt("index.md", bookmark);
    note.reconcile(digest);
    note.open("daily/2026-08-05.md");
    note.change("# daily");
    await idle();
    expect(saveNote).toHaveBeenCalledWith("daily/2026-08-05.md", "# daily");
    await act(async () => release());
    await hashed();
    note.change("# daily more");
    await idle();
    await hashed();

    expect(saveNote).not.toHaveBeenCalledWith("index.md", expect.anything());
    expect(saveNote).toHaveBeenLastCalledWith(
      "daily/2026-08-05.md",
      "# daily more",
      false,
      await baseOf(written("# daily").content),
    );
  });

  it("neither conflicts nor holds the next note when a held event settles as not ours after the switch", async () => {
    // `:e!` on the way out leaves nothing to hold, so the leave counts no
    // write, and the settle would find the count it was held at unchanged.
    const note = renderAutosave("index.md");
    const other = await digestOf("somebody else's text");
    const release = holdDigest();

    note.change("# edited");
    note.adopt("index.md", "the index note\nreading: epubcfi(/6/4)");
    note.reconcile(other);
    note.revert(true);
    note.open("daily/2026-08-05.md");
    note.change("# daily");
    await idle();
    expect(saveNote).toHaveBeenCalledWith("daily/2026-08-05.md", "# daily");
    note.change("# daily more");
    await act(async () => release());
    await hashed();

    expect(note.status()).toBe("unsaved");
    expect(await note.saveFirst()).toBe(true);
  });

  it("reopens a conflicted note left behind as a conflict, and writes nothing on the quiet period", async () => {
    const note = renderAutosave("index.md");
    note.seed("index.md", "the index note");

    note.change("# mine");
    note.reconcile("0".repeat(64));
    note.open("daily/2026-08-05.md");
    note.open("index.md");
    expect(note.allowReload("the index note")).toBe(false);
    await idle();

    expect(saveNote).not.toHaveBeenCalled();
    expect(note.status()).toBe("conflict");
  });

  it("writes the kept text with :w after a conflicted note is reopened, and drops the held entry", async () => {
    const note = renderAutosave("index.md");
    note.seed("index.md", "the index note");

    note.change("# mine");
    note.reconcile("0".repeat(64));
    note.open("daily/2026-08-05.md");
    note.open("index.md");
    note.allowReload("the index note");
    expect(saveNote).not.toHaveBeenCalled();

    expect(await note.saved()).toBe(true);
    expect(saveNote).toHaveBeenCalledWith("index.md", "# mine");
    expect(heldText("index.md")).toBeUndefined();
    expect(note.status()).toBe("saved");
  });

  it("drops a reopened conflict's held text when the vault's read equals it", async () => {
    // Somebody wrote the kept text into the vault before the reopen: the
    // reopen takes it against the stale cache, and the fresh read settles it.
    const note = renderAutosave("index.md");
    note.seed("index.md", "the index note");

    note.change("# mine");
    note.reconcile("0".repeat(64));
    note.open("daily/2026-08-05.md");
    note.open("index.md");
    expect(note.allowReload("the index note")).toBe(false);
    expect(note.status()).toBe("conflict");

    expect(note.allowReload("# mine")).toBe(true);
    expect(note.status()).toBe("saved");
    expect(heldText("index.md")).toBeUndefined();
    await idle();
    expect(saveNote).not.toHaveBeenCalled();
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
    await hashed();

    expect(saveNote).toHaveBeenLastCalledWith(
      "index.md",
      "# typed after coming back",
      false,
      await baseOf("the index note\nmore"),
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
      await baseOf("the index note"),
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
    await hashed();

    expect(note.restored()).toBe(false);
    expect(saveNote).toHaveBeenLastCalledWith(
      "index.md",
      "the index note!",
      false,
      await baseOf("the index note"),
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

  it("still flags an outside write after a held note is reopened", async () => {
    holdText("index.md", { content: "# held", reason: "failed with 500", conflicted: false });
    const note = renderAutosave("index.md");
    note.allowReload("the index note");

    expect(note.reconcile("0".repeat(64))).toBe(false);
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

  it("calls the note saved once a write in flight at a held hide lands", async () => {
    const note = renderAutosave("index.md");
    const other = await digestOf("somebody else's text");
    // Still being placed when the save's base has hashed and it goes out.
    holdDigest();
    note.change("# edited");
    note.adopt("index.md", "the index note\nreading: epubcfi(/6/4)");
    note.reconcile(other);
    // `:w` while the event is still being placed, which sends regardless.
    const quiet = pendingSave();
    note.startSave();
    await hashed();

    await background();
    expect(heldText("index.md")?.content).toBe("# edited");
    await quiet.finish();

    expect(note.status()).toBe("saved");
    expect(heldText("index.md")).toBeUndefined();
    expect(note.restored()).toBe(false);
    expect(saveNote).toHaveBeenCalledTimes(1);
  });

  it("keeps the text to write again when a write in flight at a held hide fails", async () => {
    const note = renderAutosave("index.md");
    const other = await digestOf("somebody else's text");
    holdDigest();
    note.change("# edited");
    note.adopt("index.md", "the index note\nreading: epubcfi(/6/4)");
    note.reconcile(other);
    const quiet = pendingSave();
    note.startSave();
    await hashed();

    await background();
    await quiet.break();

    expect(note.status()).toBe("error");
    expect(heldText("index.md")?.content).toBe("# edited");
    await note.save();
    expect(saveNote).toHaveBeenLastCalledWith(
      "index.md",
      "# edited",
      false,
      await baseOf("the index note\nreading: epubcfi(/6/4)"),
    );
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
    note.reconcile("0".repeat(64));
    await pagehide();

    expect(saveNote).not.toHaveBeenCalled();
    expect(heldText("index.md")).toEqual({
      content: "# mine",
      reason: "Not yet written when the page was hidden",
      conflicted: true,
    });
  });

  it("holds the text without writing when the page is hidden while an event is held", async () => {
    const note = renderAutosave("index.md");
    const other = await digestOf("somebody else's text");

    note.change("# edited");
    note.adopt("index.md", "the index note\nreading: epubcfi(/6/4)");
    note.reconcile(other);
    await pagehide();

    expect(saveNote).not.toHaveBeenCalled();
    expect(heldText("index.md")?.content).toBe("# edited");
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

  it("stops trusting an adopted text once its digest fails", async () => {
    // Without `crypto.subtle` the entry never gets a digest, so no event ever
    // takes it away, and it would take that text restored for good.
    const note = renderAutosave();
    const bookmark = "the index note\nreading: epubcfi(/6/4)";
    vi.mocked(digestOf).mockRejectedValueOnce(new TypeError("crypto.subtle is undefined"));

    note.change("# edited");
    note.adopt("index.md", bookmark);
    expect(note.allowReload(bookmark)).toBe(false);
    expect(note.status()).toBe("unsaved");
    await hashed();

    expect(note.allowReload(bookmark)).toBe(false);
    expect(note.status()).toBe("conflict");
  });

  it("takes the bookmark through the editor quietly when its digest failed first", async () => {
    // The cache notifies the editor on a zero-delay timer and the rejection is
    // a microtask, so in the route the failure lands before the editor asks.
    const note = renderAutosave();
    const bookmark = "the index note\nreading: epubcfi(/6/4)";
    vi.mocked(digestOf).mockRejectedValueOnce(new TypeError("crypto.subtle is undefined"));

    note.change("# edited");
    note.adopt("index.md", bookmark);
    await hashed();
    expect(note.allowReload(bookmark)).toBe(false);
    expect(note.status()).toBe("unsaved");

    expect(note.allowReload(bookmark)).toBe(false);
    expect(note.status()).toBe("conflict");
  });

  describe("the base a save names", () => {
    it("names the vault's text under the buffer", async () => {
      const note = renderAutosave();
      note.seed("index.md", "the index note");

      note.change("# edited");
      await idle();
      await hashed();

      expect(saveNote).toHaveBeenCalledWith(
        "index.md",
        "# edited",
        false,
        await baseOf("the index note"),
      );
    });

    it("names its own landed text when the typing goes on through a save", async () => {
      const note = renderAutosave();
      note.seed("index.md", "the index note");

      note.change("# edited");
      await idle();
      await hashed();
      note.change("# edited more");
      await idle();
      await hashed();

      expect(saveNote).toHaveBeenLastCalledWith(
        "index.md",
        "# edited more",
        false,
        await baseOf(written("# edited").content),
      );
    });

    it("names another writer's text once a reload took it into a clean buffer", async () => {
      const note = renderAutosave();

      note.change("# edited");
      await idle();
      await hashed();
      expect(note.reconcile(await digestOf("somebody else's text"))).toBe(true);
      expect(note.allowReload("somebody else's text")).toBe(true);
      note.change("somebody else's text, and mine");
      await idle();
      await hashed();

      expect(saveNote).toHaveBeenLastCalledWith(
        "index.md",
        "somebody else's text, and mine",
        false,
        await baseOf("somebody else's text"),
      );
    });

    it("names the vault's text read for :e! once the typing starts again", async () => {
      // The route reads the vault into the cache, then throws the buffer away.
      const note = renderAutosave();

      note.change("# edited");
      await idle();
      await hashed();
      note.change("# edited more");
      note.seed("index.md", "somebody else's text");
      note.revert(true);
      note.change("somebody else's text, and mine");
      await idle();
      await hashed();

      expect(saveNote).toHaveBeenLastCalledWith(
        "index.md",
        "somebody else's text, and mine",
        false,
        await baseOf("somebody else's text"),
      );
    });

    it("names a write the route made into the note once it is adopted", async () => {
      const note = renderAutosave();
      const bookmark = "the index note\nreading: epubcfi(/6/4)";

      note.change("# edited");
      await idle();
      await hashed();
      note.adopt("index.md", bookmark);
      note.change(`${bookmark}\nmine`);
      await idle();
      await hashed();

      expect(saveNote).toHaveBeenLastCalledWith(
        "index.md",
        `${bookmark}\nmine`,
        false,
        await baseOf(bookmark),
      );
    });

    it("names the text in the air when :w goes out during a quiet write", async () => {
      // The quiet write lands first, so that is what `:w` finds on disk.
      const note = renderAutosave();
      note.seed("index.md", "the index note");
      const quiet = pendingSave();

      note.change("# edited");
      await idle();
      await hashed();
      note.change("# edited more");
      note.startSave();
      await hashed();

      expect(saveNote).toHaveBeenLastCalledWith(
        "index.md",
        "# edited more",
        false,
        await baseOf("# edited"),
      );
      await quiet.finish();
      expect(note.status()).toBe("saved");
    });

    it("sends a write behind the one before it to the same note, whichever hash lands first", async () => {
      const note = renderAutosave();
      note.seed("index.md", "the index note");
      const release = holdDigest();

      note.change("# edited");
      await idle();
      note.change("# edited more");
      note.startSave();
      await hashed();
      expect(saveNote).not.toHaveBeenCalled();
      await act(async () => release());
      await hashed();

      expect(saveNote.mock.calls.map((call) => call[1])).toEqual(["# edited", "# edited more"]);
    });

    it("reads a save the vault refused over its base as a conflict, and keeps the text", async () => {
      const note = renderAutosave();
      note.seed("index.md", "the index note");
      saveNote.mockRejectedValueOnce(new ChangedOnDisk());

      note.change("# edited");
      await idle();
      await hashed();

      expect(note.status()).toBe("conflict");
      expect(note.restored()).toBe(true);
      expect(heldText("index.md")).toMatchObject({ content: "# edited", conflicted: true });
      expect(note.cached("index.md")).toBe("the index note");
      expect(await note.saveFirst()).toBe(false);
      // Nothing more goes out on its own, and `:w` sends the kept text over
      // whatever is there, naming no base.
      await idle();
      await hashed();
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
      await hashed();
      expect(note.reconcile(await digestOf("somebody else's text"))).toBe(true);
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
      await hashed();

      expect(heldText("index.md")).toMatchObject({ content: "# edited", conflicted: true });
      note.open("index.md");
      expect(note.allowReload("somebody else's text")).toBe(false);
      expect(note.status()).toBe("conflict");
    });
  });
});
