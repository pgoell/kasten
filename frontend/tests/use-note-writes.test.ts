/**
 * The gate on its own, with no route and no vault.
 *
 * Nothing on screen says two writes serialised, so the interleaving case in
 * `home-route.test.ts` and these four are the only things that can fail when
 * this breaks.
 */

import { act, cleanup, renderHook } from "@testing-library/react";
import { useNoteWrites } from "@/lib/use-note-writes";

const NOTE = "20 Literature/DDIA.md";
const OTHER = "20 Literature/TAOCP.md";

/** A work the test finishes by hand, and a record of whether it ever started. */
function held<T>(answer: T) {
  let settle: ((value: T) => void) | undefined;
  let reject: ((reason: Error) => void) | undefined;
  const work = vi.fn(
    () =>
      new Promise<T>((resolve, refuse) => {
        settle = () => resolve(answer);
        reject = refuse;
      }),
  );

  return {
    work,
    started: () => work.mock.calls.length > 0,
    finish: () => act(async () => settle?.(answer)),
    fail: () => act(async () => reject?.(new Error("the vault refused"))),
  };
}

function renderGate() {
  const { result } = renderHook(() => useNoteWrites());
  return <T>(note: string, work: () => Promise<T>) => result.current(note, work);
}

describe("useNoteWrites", () => {
  afterEach(cleanup);

  it("holds a second write into one note until the first has answered", async () => {
    const write = renderGate();
    const first = held("one");
    const second = held("two");

    void write(NOTE, first.work);
    void write(NOTE, second.work);
    await act(async () => {});
    expect(second.started()).toBe(false);

    await first.finish();

    expect(second.started()).toBe(true);
  });

  it("lets the next write into a note run after one rejected", async () => {
    // A single-arm `then` leaves a rejected promise in the map and everything
    // behind it in that note never runs.
    const write = renderGate();
    const first = held("one");
    const second = held("two");

    // Caught here rather than left to the gate: the caller owns its own
    // failure, and an unhandled rejection fails the run.
    void write(NOTE, first.work).catch(() => {});
    void write(NOTE, second.work);
    await first.fail();

    expect(second.started()).toBe(true);
  });

  it("runs two notes at once", async () => {
    const write = renderGate();
    const first = held("one");
    const other = held("two");

    void write(NOTE, first.work);
    void write(OTHER, other.work);
    await act(async () => {});

    expect(first.started()).toBe(true);
    expect(other.started()).toBe(true);
  });

  it("answers what each work answered", async () => {
    const write = renderGate();

    const first = write(NOTE, () => Promise.resolve("one"));
    const second = write(NOTE, () => Promise.resolve(2));

    await expect(first).resolves.toBe("one");
    await expect(second).resolves.toBe(2);
  });
});
