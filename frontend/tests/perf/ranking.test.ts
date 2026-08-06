/**
 * A guard on what one keystroke in the note prompt pays to rank the folders.
 *
 * `mise run fe:bench` records the number; this file is what turns a regression
 * red. The thresholds are loose enough that a busy runner still passes and
 * tight enough that a change costing an order of magnitude cannot land
 * quietly. It is a regression gate, not the frame budget: `rankFolders` still
 * walks every path in the vault, which is more than a keystroke pays now that
 * the prompt derives its folder set once and ranks the result.
 */

import { folderCandidates, rankCandidates, rankFolders } from "@/lib/fuzzy";
import { syntheticVault } from "../../bench/fixtures";

/** The size the bar is set at. 842 folders, which is what the cost tracks. */
const NOTES = 10000;

/** The query `bench/ranking.bench.ts` records with. The recorded mean belongs
 * to this query and no other: a query matching fewer folders skips more of the
 * sort and the map, so it would quietly measure a different multiple. */
const QUERY = "notes";

// Six times what this gate measures on this machine: six runs of
// `mise run fe:test` put the empty query between 5.196 and 5.491ms, median
// 5.40, and the typed one between 7.647 and 8.268ms, median 7.88. Six is two
// factors. Three carries a real regression, and two carries the runner: the
// gate runs on ubuntu-latest, which CI run 31029223471 timed at about 2.0x
// slower than this machine against the same 15 jsdom files, the ratio landing
// between 1.94 and 2.17 across duration, tests, environment and setup. Three
// times a local median would therefore leave 1.5x of headroom where it
// actually gates, which one noisy minute turns red.
//
// These medians sit above the means `mise run fe:bench` records, which the
// earlier literals came from, because a hot loop amortises garbage collection
// across its iterations and a single call pays for it in full. Neither figure
// dropped when the keystroke got cheaper: `rankFolders` still walks all 10,000
// paths for its 842 folders, and the prompt simply stopped calling it once per
// keystroke. That half is gated below.
const EMPTY_LIMIT_MS = 32;
const TYPED_LIMIT_MS = 47;

// Six times the 0.372ms median this gate measures, the same three for a
// regression and two for ubuntu-latest. The same six runs read 0.365 to 0.407.
const PREFIX_LIMIT_MS = 2.2;

/** Median milliseconds of `runs` timed calls, after `warmup` untimed ones. */
function medianMs(fn: () => unknown, runs: number, warmup: number): number {
  for (let index = 0; index < warmup; index += 1) fn();

  const times: number[] = [];
  for (let index = 0; index < runs; index += 1) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  // A median rather than a mean, because one descheduled run would drag a mean
  // over the line while saying nothing about the code.
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)] ?? 0;
}

describe(`rankFolders at ${NOTES} notes`, () => {
  const { paths } = syntheticVault(NOTES);

  it("ranks an empty query within six times its recorded cost", () => {
    const median = medianMs(() => rankFolders(paths, ""), 25, 5);

    console.log(`rankFolders, empty query: ${median.toFixed(3)}ms median`);
    expect(median).toBeLessThan(EMPTY_LIMIT_MS);
  });

  it("ranks a typed query within six times its recorded cost", () => {
    const median = medianMs(() => rankFolders(paths, QUERY), 25, 5);

    console.log(`rankFolders, typed query: ${median.toFixed(3)}ms median`);
    expect(median).toBeLessThan(TYPED_LIMIT_MS);
  });

  // The prompt derives the prefixes once per vault and ranks them once per
  // keystroke, so this is the half a keystroke actually pays. Gated apart from
  // `rankFolders` above, which still carries the derivation and would hide a
  // regression in either half behind the other.
  it("ranks derived prefixes within six times their recorded cost", () => {
    const folders = folderCandidates(paths);
    const median = medianMs(() => rankCandidates(folders, ""), 25, 5);

    console.log(`rankCandidates over folders, empty query: ${median.toFixed(3)}ms median`);
    expect(median).toBeLessThan(PREFIX_LIMIT_MS);
  });
});
