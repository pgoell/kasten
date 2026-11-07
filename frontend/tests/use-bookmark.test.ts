/**
 * The scheduler on its own, with no server and no pane.
 *
 * Every rule it holds is provable against a `write` the test supplies, and two
 * drafts of this design got the busy cases wrong in opposite directions, so the
 * overlap, the delivery and the quiet period are three cases rather than one.
 */

import { act, cleanup, renderHook } from "@testing-library/react";
import { type FoliateView, placeOf } from "@/lib/panes/book/foliate-view";
import { useBookmark } from "@/lib/saving/use-bookmark";
import { placed } from "@/lib/saving/use-guarded-writes";

/** What the hook waits for, spelled here so a change to it fails loudly. */
const WAIT = 60_000;

const NOTE = "20 Literature/DDIA.md";

function renderBookmark() {
  const write = vi.fn<(note: string, cfi: string) => Promise<boolean>>();
  write.mockResolvedValue(true);
  // The cfi alone reaches `write`, which is what the wait keys on.
  const { result, unmount } = renderHook(() =>
    useBookmark((note, place) => write(note, place.cfi)),
  );

  return {
    write,
    moved: (note: string, cfi: string) =>
      act(() => result.current.moved(note, { cfi, progress: null, author: undefined })),
    flush: (note: string) =>
      act(() => {
        void result.current.flush(note);
      }),
    cancel: (note: string) => act(() => result.current.cancel(note)),
    // Unwrapped, so a test can watch when the promise settles.
    flushed: (note: string) => result.current.flush(note),
    unmount: () => act(() => unmount()),
  };
}

/** A write the test finishes by hand, so the in-flight state can be looked at. */
function heldWrite(write: ReturnType<typeof renderBookmark>["write"]) {
  let settle: ((took: boolean) => void) | undefined;
  write.mockImplementationOnce(
    () =>
      new Promise<boolean>((resolve) => {
        settle = resolve;
      }),
  );

  return { finish: (took = true) => act(async () => settle?.(took)) };
}

/** Let `ms` of the wait pass, and let whatever it started settle. */
async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("useBookmark", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("writes nothing until the reading has stopped for a minute", async () => {
    const bookmark = renderBookmark();

    bookmark.moved(NOTE, "cfi-a");
    await tick(WAIT - 1);
    expect(bookmark.write).not.toHaveBeenCalled();

    await tick(1);

    expect(bookmark.write).toHaveBeenCalledWith(NOTE, "cfi-a");
  });

  it("starts the wait again on the next page turn", async () => {
    const bookmark = renderBookmark();

    bookmark.moved(NOTE, "cfi-a");
    await tick(WAIT / 2);
    bookmark.moved(NOTE, "cfi-b");
    await tick(WAIT / 2);
    expect(bookmark.write).not.toHaveBeenCalled();

    await tick(WAIT / 2);

    expect(bookmark.write).toHaveBeenCalledOnce();
    expect(bookmark.write).toHaveBeenCalledWith(NOTE, "cfi-b");
  });

  it("writes at once on a flush", async () => {
    const bookmark = renderBookmark();

    bookmark.moved(NOTE, "cfi-a");
    bookmark.flush(NOTE);

    expect(bookmark.write).toHaveBeenCalledWith(NOTE, "cfi-a");
  });

  it("writes nothing on a flush with nothing waiting", async () => {
    const bookmark = renderBookmark();

    bookmark.flush(NOTE);

    expect(bookmark.write).not.toHaveBeenCalled();
  });

  it("does not write a position it has already written", async () => {
    const bookmark = renderBookmark();

    bookmark.moved(NOTE, "cfi-a");
    await tick(WAIT);
    expect(bookmark.write).toHaveBeenCalledOnce();

    bookmark.moved(NOTE, "cfi-a");
    await tick(WAIT);

    expect(bookmark.write).toHaveBeenCalledOnce();
  });

  it("sends nothing second while a write of its own is out", async () => {
    // The overlap. Without the one-at-a-time gate this sends the same position
    // twice, the first write not having emptied what is waiting yet.
    const bookmark = renderBookmark();
    const held = heldWrite(bookmark.write);

    bookmark.moved(NOTE, "cfi-a");
    await tick(WAIT);
    bookmark.flush(NOTE);

    expect(bookmark.write).toHaveBeenCalledOnce();
    await held.finish();
  });

  it("sends nothing second when a timer fires during a write", async () => {
    // The other way into the one-at-a-time gate, and the one the flush's own
    // early return does not cover: a write slow enough that the next turn's
    // whole wait elapses under it.
    const bookmark = renderBookmark();
    const held = heldWrite(bookmark.write);

    bookmark.moved(NOTE, "cfi-a");
    await tick(WAIT);
    bookmark.moved(NOTE, "cfi-b");
    await tick(WAIT);

    expect(bookmark.write).toHaveBeenCalledOnce();
    await held.finish();
  });

  it("delivers a turn the flush found the note too busy for", async () => {
    // The case a flush that clears the timer strands for good: the turn armed a
    // fresh timer, and walking away is what leaves that timer to deliver it.
    const bookmark = renderBookmark();
    const held = heldWrite(bookmark.write);

    bookmark.moved(NOTE, "cfi-a");
    await tick(WAIT);
    bookmark.moved(NOTE, "cfi-b");
    bookmark.flush(NOTE);
    await held.finish();
    expect(bookmark.write).toHaveBeenCalledOnce();

    await tick(WAIT);

    expect(bookmark.write).toHaveBeenCalledTimes(2);
    expect(bookmark.write).toHaveBeenLastCalledWith(NOTE, "cfi-b");
  });

  it("does not skip the wait when a write lands on a turn that came during it", async () => {
    // The other way round from the case above, and the reason the write's own
    // completion sends nothing: it would write at request speed for as long as
    // page turns kept landing during writes.
    const bookmark = renderBookmark();
    const held = heldWrite(bookmark.write);

    bookmark.moved(NOTE, "cfi-a");
    await tick(WAIT);
    bookmark.moved(NOTE, "cfi-b");
    await held.finish();
    expect(bookmark.write).toHaveBeenCalledOnce();

    await tick(WAIT - 1);
    expect(bookmark.write).toHaveBeenCalledOnce();

    await tick(1);

    expect(bookmark.write).toHaveBeenCalledTimes(2);
  });

  it("drops the wait on a cancel and keeps the place for the next flush", async () => {
    const bookmark = renderBookmark();

    bookmark.moved(NOTE, "cfi-a");
    bookmark.cancel(NOTE);
    await tick(WAIT);
    expect(bookmark.write).not.toHaveBeenCalled();

    bookmark.flush(NOTE);

    expect(bookmark.write).toHaveBeenCalledWith(NOTE, "cfi-a");
  });

  it("keeps a position the vault would not take", async () => {
    // Also what fails when the note is left in the one-at-a-time set after a
    // refusal: that note would never be written again.
    const bookmark = renderBookmark();
    bookmark.write.mockResolvedValue(false);

    bookmark.moved(NOTE, "cfi-a");
    await tick(WAIT);
    expect(bookmark.write).toHaveBeenCalledOnce();

    bookmark.flush(NOTE);

    expect(bookmark.write).toHaveBeenCalledTimes(2);
    expect(bookmark.write).toHaveBeenLastCalledWith(NOTE, "cfi-a");
  });

  it("leaves the note writable after a write that threw", async () => {
    // `write` is written not to throw, and this is what that promise being
    // broken costs: one lost position rather than a note gated for the life of
    // the page.
    const bookmark = renderBookmark();
    bookmark.write.mockRejectedValueOnce(new Error("the vault fell over"));

    bookmark.moved(NOTE, "cfi-a");
    await tick(WAIT);
    expect(bookmark.write).toHaveBeenCalledOnce();

    bookmark.flush(NOTE);

    expect(bookmark.write).toHaveBeenCalledTimes(2);
  });

  it("keeps two notes on two timers", async () => {
    const bookmark = renderBookmark();

    bookmark.moved("one.md", "cfi-1");
    await tick(WAIT / 2);
    bookmark.moved("two.md", "cfi-2");
    await tick(WAIT / 2);
    expect(bookmark.write).toHaveBeenCalledOnce();
    expect(bookmark.write).toHaveBeenCalledWith("one.md", "cfi-1");

    await tick(WAIT / 2);

    expect(bookmark.write).toHaveBeenCalledTimes(2);
    expect(bookmark.write).toHaveBeenLastCalledWith("two.md", "cfi-2");
  });

  it("writes nothing once the page has gone", async () => {
    const bookmark = renderBookmark();

    bookmark.moved(NOTE, "cfi-a");
    bookmark.unmount();
    await tick(WAIT);

    expect(bookmark.write).not.toHaveBeenCalled();
  });

  it("settles a flush only once its write, or the one already out, has ended (#1605)", async () => {
    // The pane close waits on this, so the note beside takes the focus after the place lands.
    const bookmark = renderBookmark();
    const held = heldWrite(bookmark.write);
    let settled = 0;

    bookmark.moved(NOTE, "cfi-a");
    void bookmark.flushed(NOTE).then(() => settled++);
    void bookmark.flushed(NOTE).then(() => settled++);
    await act(async () => {});
    expect(settled).toBe(0);

    await held.finish();
    expect(settled).toBe(2);
    expect(bookmark.write).toHaveBeenCalledOnce();
  });
});

describe("what the bookmark writes", () => {
  const AT = { cfi: "epubcfi(/6/4)", progress: 0.4149, author: "Tanya Reilly" };

  it("writes the place, the fraction to two places, the time and the book's author", () => {
    const text = placed("# DDIA\n", AT);

    expect(text).toMatch(/^---\nreading: epubcfi\(\/6\/4\)\nread_at: \S+\nprogress: 0\.41\n/);
    expect(text).toContain('author: "Tanya Reilly"');
    const at = /read_at: (\S+)/.exec(text)?.[1] ?? "";
    expect(at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);
    expect(Math.abs(Date.parse(at) - Date.now())).toBeLessThan(2000);
  });

  it("keeps a hand-set author and an old fraction when the view has no number", () => {
    const text = placed("---\nauthor: Reilly\nprogress: 0.2\n---\n", { ...AT, progress: null });

    expect(text).toContain("author: Reilly\n");
    expect(text).toContain("progress: 0.2\n");
    expect(text).not.toContain("Tanya");
  });

  it("joins an epub's creators and reads a pdf's author string", () => {
    const view = (author: unknown) =>
      ({ book: { metadata: { author } }, lastLocation: { fraction: 0.5 } }) as FoliateView;

    expect(placeOf(view([{ name: { en: "Ann" } }, "Bo "]), "c")).toEqual({
      cfi: "c",
      progress: 0.5,
      author: "Ann, Bo",
    });
    expect(placeOf(view("Cy"), "c").author).toBe("Cy");
    expect(placeOf(view(undefined), "c").author).toBeUndefined();
  });
});
