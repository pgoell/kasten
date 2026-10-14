import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { useAutosave } from "@/lib/use-autosave";
import { digestOf } from "@/lib/vault-events";

// crypto finishes a digest off the event loop, which no fake timer reaches, so
// the real timer is kept from before the fakes go in. `hashed` below is what
// the tests wait on for the hash of a write to land.
const realTimeout = globalThis.setTimeout;

const { saveNote } = vi.hoisted(() => ({ saveNote: vi.fn() }));
vi.mock("@/lib/api", () => ({ saveNote }));

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

function renderAutosave(path = "index.md") {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);

  const { result, rerender, unmount } = renderHook(({ open }) => useAutosave(open), {
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

describe("useAutosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    saveNote.mockImplementation(async (_path: string, content: string) => written(content));
  });

  afterEach(() => {
    // By hand and first: unmounting flushes, so the automatic cleanup would
    // otherwise reach a mock that has already been reset.
    cleanup();
    vi.useRealTimers();
    saveNote.mockReset();
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

    expect(saveNote).toHaveBeenLastCalledWith("index.md", "# edited again");
    expect(note.status()).toBe("saved");
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

    await vi.waitFor(async () => {
      await idle();
      expect(saveNote).toHaveBeenCalledWith("index.md", "# edited");
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

  it("says which note lost its text when the flush on the way out fails", async () => {
    // The text is gone, so the bar is the only place the reader learns of it,
    // and the note on screen is not the one that lost anything.
    const note = renderAutosave("index.md");
    saveNote.mockRejectedValueOnce(new Error("failed with 500"));

    note.change("# left behind");
    note.open("daily/2026-08-05.md");
    await act(async () => {});

    expect(note.status()).toBe("lost");
    expect(note.reason()).toContain("index.md");
    expect(note.reason()).toContain("failed with 500");
  });

  it("still says which note lost its text when the next note was reverted meanwhile", async () => {
    // `:e!` on the next note throws away that note's text, not the old one's.
    const note = renderAutosave("index.md");
    const flush = pendingSave();

    note.change("# left behind");
    note.open("daily/2026-08-05.md");
    note.revert(true);
    await flush.break();

    expect(note.status()).toBe("lost");
    expect(note.reason()).toContain("index.md was not saved");
  });

  it("keeps the next note's conflict when the old note's flush fails", async () => {
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
    expect(note.reason()).toContain("index.md was not saved");
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
});
