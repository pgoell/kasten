import { AsyncLocalStorage } from "node:async_hooks";
import { act as rtlAct } from "@testing-library/react";

/**
 * The test a body belongs to, carried through its awaits.
 *
 * vitest fails a test that runs out of time but cannot stop it, so the body
 * goes on while the next test runs. A module variable set in `beforeEach`
 * names the test running now, not the one that called, so an orphan woken
 * later read the next test's signal and went into `act` beside it (#1337).
 * The store follows the body itself, timed out or not.
 */
const scope = new AsyncLocalStorage<{ signal: AbortSignal; ended: boolean }>();

/** Wrap each test, its hooks included, in a scope of its own. */
export function scopeEachTest() {
  aroundEach(async (runTest, context) => {
    const own = { signal: context.signal, ended: false };
    await scope.run(own, runTest);
    own.ended = true;
  });
}

/**
 * `act`, let go of when the test it was called in times out.
 *
 * React counts how deep in `act` it is in one place for the whole file, and
 * while an orphan sits inside one, every later `render` is queued for an outer
 * `act` that never ends: one timeout became 119 failures over an empty
 * container. Rejecting on the abort takes the orphan out of its `act`, and a
 * body whose test has ended may not start one. A signal already aborted while
 * the test has not ended is a hook after the timeout, which has to run as it is.
 * Outside a scope, as in a file that does not ask for one, it is plain `act`.
 */
export function act(callback: () => void): void;
export function act(callback: () => Promise<void>): Promise<void>;
export function act(callback: () => void | Promise<void>): void | Promise<void> {
  const own = scope.getStore();
  if (own?.ended) throw new Error("This test has ended; its body stops here");
  return rtlAct(() => {
    const result = callback();
    // A synchronous callback cannot outlive its test, and stays synchronous
    // here so React flushes it before `act` returns, as the call sites expect.
    if (!own || !(result instanceof Promise) || own.signal.aborted) return result;
    let stop = () => {};
    const aborted = new Promise<never>((_, reject) => {
      stop = () => reject(own.signal.reason);
      own.signal.addEventListener("abort", stop, { once: true });
    });
    // Taken off once `act` ends, or every call would leave one on the signal.
    return Promise.race([result, aborted]).finally(() =>
      own.signal.removeEventListener("abort", stop),
    );
  });
}

/**
 * Wait for every `crypto.subtle` digest asked for so far, and what they start.
 *
 * crypto finishes a digest off the event loop, on a thread pool no fake timer
 * reaches. A fixed number of real ticks is enough on an idle machine and not
 * on a loaded CI runner, where a save that names a base then goes out inside
 * the next test, or after the assertion. So the digests are counted as they
 * are asked for, and this waits until none is left: a landed write asks for
 * one of its own, which the loop waits for too.
 */
const digests = new Set<Promise<ArrayBuffer>>();
const digest = crypto.subtle.digest.bind(crypto.subtle);
crypto.subtle.digest = ((...args: Parameters<SubtleCrypto["digest"]>) => {
  const asked = digest(...args);
  digests.add(asked);
  const forget = () => digests.delete(asked);
  asked.then(forget, forget);
  return asked;
}) as SubtleCrypto["digest"];

// Kept before any test fakes the timers: the tick below must be a real one.
const realTimeout = globalThis.setTimeout;

export async function hashed(): Promise<void> {
  do {
    await act(async () => {
      await Promise.allSettled([...digests]);
      // One real tick, which runs every microtask a digest's answer queued:
      // the hash on to `saveNote`, and the answer on to the next digest.
      await new Promise((resolve) => realTimeout(resolve, 0));
    });
  } while (digests.size > 0);
}
