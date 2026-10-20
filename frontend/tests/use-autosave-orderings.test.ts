import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { ChangedOnDisk } from "@/lib/api";
import { resetHeld } from "@/lib/held-text";
import { noteBase } from "@/lib/note-base";
import { forgetQueues, useAutosave } from "@/lib/use-autosave";

// The orderings of docs/reference/save-path-orderings/ (the pages of the table,
// each row numbered as in save-path-orderings.md) that no test in
// use-autosave.test.ts held. Its fixtures are module-local there, so the ones
// these tests need are copied here.

const { saveNote, fetchNote } = vi.hoisted(() => ({ saveNote: vi.fn(), fetchNote: vi.fn() }));
// The real refusal, which the hook tells apart from every other failure.
vi.mock("@/lib/api", async (importOriginal) => ({
  saveNote,
  fetchNote,
  ChangedOnDisk: (await importOriginal<typeof import("@/lib/api")>()).ChangedOnDisk,
}));

/** The note as the vault holds it once `content` has been written to it. */
function written(content: string) {
  return { path: "index.md", content: `${content}\nmodified: now` };
}

/** A note with a real stamp, which `landedAs` can read, unlike `written`'s. */
function stamped(content: string) {
  return `---\nmodified: now\n---\n${content}`;
}

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

/** A save the test cuts off by hand, with no HTTP status. */
function lostLater() {
  let lose: (() => void) | undefined;
  saveNote.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        lose = () => reject(new TypeError("Failed to fetch"));
      }),
  );
  return () => act(async () => lose?.());
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

async function idle() {
  await act(async () => {
    vi.advanceTimersByTime(800);
  });
}

/** The hook following `index.md` in pane `a`, with an editor opened on `seed`. */
function withEditor(seed: string) {
  let doc = seed;
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  let props = { open: "index.md", pane: "a" };
  const { result, rerender } = renderHook(({ open, pane }) => useAutosave(open, () => doc, pane), {
    initialProps: props,
    wrapper,
  });
  queryClient.setQueryData(["note", "index.md"], seed);

  return {
    type: (text: string) => {
      doc = text;
      act(() => result.current.change(text));
    },
    /** `:w` during a quiet write, left in flight. */
    startSave: () => {
      act(() => {
        void result.current.save();
      });
    },
    askSaveFirst: () => {
      let asked: Promise<boolean> = Promise.resolve(false);
      act(() => {
        asked = result.current.saveFirst();
      });
      return asked;
    },
    /** Another read of the note reaching the editor through the cache. */
    outside: (text: string) => {
      queryClient.setQueryData(["note", "index.md"], text);
      let allowed = false;
      act(() => {
        allowed = result.current.allowReload(text);
      });
      if (allowed) doc = text;
      return allowed;
    },
    /** Open `next`, an editor on it showing `text`. */
    open: (next: string, text: string) => {
      queryClient.setQueryData(["note", next], text);
      doc = text;
      props = { ...props, open: next };
      act(() => rerender(props));
    },
    /** `:e!` in the note open now: the route reads the vault, then asks. */
    discard: () => {
      act(() => {
        result.current.revert(true);
      });
    },
    status: () => result.current.status,
    cached: (of: string) => queryClient.getQueryData(["note", of]),
    shown: () => doc,
  };
}

describe("save path orderings", () => {
  beforeEach(() => {
    // The write queue is the page's, and each test is a page of its own.
    forgetQueues();
    vi.useFakeTimers();
    saveNote.mockImplementation(async (_path: string, content: string) => written(content));
  });

  afterEach(async () => {
    cleanup();
    await settled();
    vi.useRealTimers();
    saveNote.mockReset();
    fetchNote.mockReset();
    localStorage.removeItem("kasten.held");
    localStorage.removeItem("kasten.held.2");
    resetHeld();
    Reflect.deleteProperty(document, "visibilityState");
  });

  it("names the old base when the read after a network failure fails too", async () => {
    const { type } = withEditor("start");
    fetchNote.mockRejectedValue(new TypeError("Failed to fetch"));

    type("T1");
    saveNote.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await idle();
    await settled();
    type("T1, T2");
    await idle();
    await settled();

    expect(fetchNote).toHaveBeenCalledWith("index.md");
    expect(saveNote).toHaveBeenLastCalledWith("index.md", "T1, T2", false, noteBase("start"));
  });

  it("names the read text on a write queued behind a network failure", async () => {
    const { type, startSave } = withEditor("start");
    // The server wrote T1 and the answer was lost on the way back.
    fetchNote.mockResolvedValue(stamped("T1"));
    const lose = lostLater();

    type("T1");
    await idle();
    type("T1, T2");
    startSave();
    await lose();
    await settled();

    expect(saveNote).toHaveBeenLastCalledWith("index.md", "T1, T2", false, noteBase(stamped("T1")));
  });

  it("takes a read of the text in the air and names the write's answer behind it", async () => {
    const { type, outside, shown } = withEditor("start");
    const first = pendingSave();

    type("T1");
    await idle();
    // The vault's event for W1 is read before W1's own answer comes back.
    expect(outside(stamped("T1"))).toBe(true);
    type(`${shown()}, T2`);
    await idle();
    await first.finish();
    await settled();

    expect(saveNote).toHaveBeenLastCalledWith(
      "index.md",
      `${stamped("T1")}, T2`,
      false,
      noteBase(written("T1").content),
    );
  });

  it("declines a read of the first write's answer while the second is in the air", async () => {
    const { type, outside, shown } = withEditor("start");
    const first = pendingSave();
    pendingSave();

    type("T1");
    await idle();
    type("T2");
    await idle();
    await first.finish();
    await settled();

    // W2 is out with T2, which the screen shows: W1's answer is a step behind.
    expect(outside(written("T1").content)).toBe(false);
    expect(shown()).toBe("T2");
  });

  it("queues the flush on leaving behind the write in the air and names its answer", async () => {
    const { type, open, cached } = withEditor("start");
    const first = pendingSave();

    type("T1");
    await idle();
    type("T2");
    open("b.md", "b");
    expect(cached("index.md")).toBe("T2");
    await first.finish();
    await settled();

    expect(saveNote).toHaveBeenLastCalledWith(
      "index.md",
      "T2",
      false,
      noteBase(written("T1").content),
    );
  });

  it("lets a rename go once the write in the air lands", async () => {
    const { type, askSaveFirst } = withEditor("start");
    const first = pendingSave();

    type("T1");
    await idle();
    let outcome: boolean | undefined;
    void askSaveFirst().then((answer) => {
      outcome = answer;
    });
    await settled();
    expect(outcome).toBeUndefined();

    await first.finish();
    await settled();
    expect(outcome).toBe(true);
  });

  it("refuses a rename when the write in the air is refused", async () => {
    const { type, askSaveFirst, status } = withEditor("start");
    const refuse = refusedLater();

    type("T1");
    await idle();
    let outcome: boolean | undefined;
    void askSaveFirst().then((answer) => {
      outcome = answer;
    });
    await refuse();
    await settled();

    expect(outcome).toBe(false);
    expect(status()).toBe("conflict");
  });

  it("still sends a left note's queued flush after :e! in the next note", async () => {
    const { type, open, discard } = withEditor("start");
    const first = pendingSave();

    type("T1");
    await idle();
    type("T2");
    // The flush of T2 waits behind W1.
    open("b.md", "b");
    discard();
    await first.finish();
    await settled();

    expect(saveNote.mock.calls.map((call) => [call[0], call[1]])).toEqual([
      ["index.md", "T1"],
      ["index.md", "T2"],
    ]);
  });
});
