import { act } from "@testing-library/react";

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
