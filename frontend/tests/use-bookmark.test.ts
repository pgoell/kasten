/**
 * The scheduler on its own, with no server and no pane.
 *
 * Every rule it holds is provable against a `write` the test supplies, and two
 * drafts of this design got the busy cases wrong in opposite directions, so the
 * overlap, the delivery and the quiet period are three cases rather than one.
 */

import { act, cleanup, renderHook } from "@testing-library/react";
import { useBookmark } from "@/lib/use-bookmark";

/** What the hook waits for, spelled here so a change to it fails loudly. */
const WAIT = 60_000;

const NOTE = "20 Literature/DDIA.md";

function renderBookmark() {
  const write = vi.fn<(note: string, cfi: string) => Promise<boolean>>();
  write.mockResolvedValue(true);
  const { result, unmount } = renderHook(() => useBookmark(write));

  return {
    write,
    moved: (note: string, cfi: string) => act(() => result.current.moved(note, cfi)),
    flush: (note: string) => act(() => result.current.flush(note)),
    cancel: (note: string) => act(() => result.current.cancel(note)),
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
});
