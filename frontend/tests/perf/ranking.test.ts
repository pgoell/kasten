/**
 * A guard on what one keystroke pays to rank, in the prompt and in the finder.
 *
 * The gates count the work ranking does: candidates scored, and table cells
 * filled per query. A clock would measure the box the suite runs on, so no
 * test here asserts a time. Each one prints its median, so a regression
 * still shows in the log.
 */

import {
  type Candidate,
  folderCandidates,
  noteCandidates,
  rankCandidates,
  rankFolders,
  resetWork,
  work,
} from "@/lib/fuzzy";
import { syntheticVault } from "../../bench/fixtures";

/** The size the bar is set at. 842 folders, which is what the cost tracks. */
const NOTES = 10000;

/** The query `bench/ranking.bench.ts` records with. */
const QUERY = "notes";

/** The letter typed first, which is the dearest keystroke the finder answers. */
const WORST_QUERY = "a";

/** Whether `query` reads into `lower` in order, the way the scorer's cheap scan decides it. */
function readsInto(lower: string, query: string): boolean {
  let at = 0;
  for (let i = 0; i < query.length; i += 1) {
    at = lower.indexOf(query.charAt(i), at);
    if (at === -1) return false;
    at += 1;
  }
  return true;
}

/** The table cells a query fills over `candidates`: query length times path length, where it reads in. */
function cellsOracle(candidates: Candidate[], query: string): number {
  let cells = 0;
  for (const { lower } of candidates) {
    if (readsInto(lower, query)) cells += query.length * lower.length;
  }
  return cells;
}

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
  const folders = folderCandidates(paths);

  it("ranks an empty query scoring each folder once and filling no table", () => {
    const median = medianMs(() => rankFolders(paths, ""), 25, 5);
    console.log(`rankFolders, empty query: ${median.toFixed(3)}ms median`);

    resetWork();
    rankFolders(paths, "");
    expect(work.candidates).toBeLessThanOrEqual(folders.length);
    expect(work.cells).toBeLessThanOrEqual(cellsOracle(folders, ""));
  });

  it("ranks a typed query scoring each folder once and filling the table only for folders it reads into", () => {
    const median = medianMs(() => rankFolders(paths, QUERY), 25, 5);
    console.log(`rankFolders, typed query: ${median.toFixed(3)}ms median`);

    // The oracle counts `folders` as folderCandidates gave them, so a folder
    // listed twice would be counted on both sides. Distinct paths catch that.
    expect(new Set(folders.map((folder) => folder.path)).size).toBe(folders.length);

    resetWork();
    rankFolders(paths, QUERY);
    expect(work.candidates).toBeLessThanOrEqual(folders.length);
    expect(work.cells).toBeLessThanOrEqual(cellsOracle(folders, QUERY));
  });

  // The prompt derives the prefixes once per vault and ranks them once per
  // keystroke, so this is the half a keystroke actually pays. Gated apart from
  // `rankFolders` above, which still carries the derivation and would hide a
  // regression in either half behind the other.
  it("ranks derived folders for an empty query scoring each once and filling no table", () => {
    const median = medianMs(() => rankCandidates(folders, ""), 25, 5);
    console.log(`rankCandidates over folders, empty query: ${median.toFixed(3)}ms median`);

    resetWork();
    rankCandidates(folders, "");
    expect(work.candidates).toBeLessThanOrEqual(folders.length);
    expect(work.cells).toBeLessThanOrEqual(cellsOracle(folders, ""));
  });
});

describe(`rankNotes at ${NOTES} notes`, () => {
  const { paths } = syntheticVault(NOTES);
  const notes = noteCandidates(paths);

  it("prepares the vault's notes scoring nothing", () => {
    // Once per vault, not once per keystroke, which is the whole reason the
    // finder splits its two memos the way the prompt does.
    const median = medianMs(() => noteCandidates(paths), 25, 5);
    console.log(`noteCandidates: ${median.toFixed(3)}ms median`);

    resetWork();
    const prepared = noteCandidates(paths);
    expect(work.candidates).toBe(0);
    expect(work.cells).toBe(0);
    expect(prepared).toHaveLength(paths.length);
  });

  it("ranks an empty query scoring each note once and filling no table", () => {
    // What the finder opens with, and the one query that reaches the sort with
    // every note still in it.
    const median = medianMs(() => rankCandidates(notes, ""), 25, 5);
    console.log(`rankCandidates over notes, empty query: ${median.toFixed(3)}ms median`);

    resetWork();
    rankCandidates(notes, "");
    expect(work.candidates).toBeLessThanOrEqual(notes.length);
    expect(work.cells).toBeLessThanOrEqual(cellsOracle(notes, ""));
  });

  it("ranks the first letter typed scoring each note once and filling the table only for notes it reads into", () => {
    // The worst keystroke of the lot. One letter rejects almost nothing, so
    // nearly every note pays for the table, where a longer query throws most of
    // the vault out on the cheap scan.
    const median = medianMs(() => rankCandidates(notes, WORST_QUERY), 25, 5);
    console.log(`rankCandidates over notes, one letter: ${median.toFixed(3)}ms median`);

    resetWork();
    rankCandidates(notes, WORST_QUERY);
    expect(work.candidates).toBeLessThanOrEqual(notes.length);
    expect(work.cells).toBeLessThanOrEqual(cellsOracle(notes, WORST_QUERY));
  });

  it("ranks a typed query scoring each note once and filling the table only for notes it reads into", () => {
    const median = medianMs(() => rankCandidates(notes, QUERY), 25, 5);
    console.log(`rankCandidates over notes, typed query: ${median.toFixed(3)}ms median`);

    resetWork();
    rankCandidates(notes, QUERY);
    expect(work.candidates).toBeLessThanOrEqual(notes.length);
    expect(work.cells).toBeLessThanOrEqual(cellsOracle(notes, QUERY));
  });
});
