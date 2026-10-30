/**
 * How long the vault graph takes to settle, and the longest frame while it does
 * (A7), on the dev vault and on the generated 2000-note vault. Skipped unless
 * VITE_KASTEN_TIMING=1, and run on the branch and on main back to back.
 *
 * On the branch the engine's `onSettle` says when it has stopped. Main has no such
 * call, so there the stop is read from the pixels: ten frames with no change, and
 * a cap of 20 s either way. Each draw is a fresh canvas in a 1000 by 700 box.
 */

import type { Graph } from "@/lib/graph/graph-api";
import { drawGraph, type GraphCanvas } from "@/lib/graph/graph-canvas";
import { need } from "../reader-fixture";
import {
  boxOf,
  DEV_ANSWER,
  LARGE,
  registerVaultFixture,
  signatureOf,
} from "../vault-graph-fixture";

registerVaultFixture();

const RUNS = 5;
const BOX = { width: 1000, height: 700 };
const CAP_MS = 20_000;
const STILL_FRAMES = 10;

interface Draw {
  settle: number;
  longest: number;
  stopped: boolean;
}

/** One draw from the update to the stop, with the longest frame while it ran. */
async function timed(answer: Graph): Promise<Draw> {
  const element = boxOf(BOX.width, BOX.height);
  let finish: () => void = () => {};
  const stopped = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let stopAt = -1;
  const stop = () => {
    if (stopAt < 0) stopAt = performance.now();
    finish();
  };
  const made: GraphCanvas = drawGraph(element, {
    onOpen: () => {},
    onBlank: () => {},
    coarse: () => false,
    onSettle: stop,
  });
  const branch = typeof made.cluster === "function";
  const canvas = need(element.querySelector<HTMLCanvasElement>("canvas"), "canvas");

  const start = performance.now();
  made.update(structuredClone(answer.nodes), structuredClone(answer.edges));
  made.cluster?.("folders");

  let last = start;
  let longest = 0;
  let previous = Number.NaN;
  let still = 0;
  let running = true;
  const watch = (now: number) => {
    if (!running) return;
    if (stopAt < 0) longest = Math.max(longest, now - last);
    last = now;
    if (!branch && stopAt < 0) {
      const signature = signatureOf(canvas);
      still = signature === previous ? still + 1 : 0;
      previous = signature;
      if (still >= STILL_FRAMES) stop();
    }
    requestAnimationFrame(watch);
  };
  requestAnimationFrame(watch);

  await Promise.race([stopped, new Promise<void>((resolve) => setTimeout(resolve, CAP_MS))]);
  running = false;
  const end = stopAt < 0 ? performance.now() : stopAt;
  made.destroy();
  element.remove();
  return { settle: end - start, longest, stopped: stopAt >= 0 };
}

/** The middle of a sorted list, averaged over the two middles of an even one. */
function median(sorted: number[]): number {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

it.skipIf(!import.meta.env.VITE_KASTEN_TIMING)(
  "A7 the time to settle and the longest frame, the dev vault and 2000 notes",
  async () => {
    for (const [name, answer] of [
      ["dev vault", DEV_ANSWER],
      ["2000 notes", LARGE],
    ] as const) {
      const draws: Draw[] = [];
      for (let run = 0; run < RUNS; run++) draws.push(await timed(answer));
      const settles = draws.map((draw) => draw.settle).sort((a, b) => a - b);
      const longests = draws.map((draw) => draw.longest).sort((a, b) => a - b);
      const at = (sorted: number[]) => sorted[sorted.length - 1] ?? 0;
      const stopped = draws.filter((draw) => draw.stopped).length;
      // The browser's log level is not shown by this runner, and error is.
      console.error(
        `${name}: ${answer.nodes.length} notes, ${answer.edges.length} links, settle median ${median(settles).toFixed(0)} ms max ${at(settles).toFixed(0)} ms, longest frame median ${median(longests).toFixed(1)} ms max ${at(longests).toFixed(1)} ms, ${stopped} of ${RUNS} runs stopped inside ${CAP_MS} ms`,
      );
    }
  },
  600_000,
);
