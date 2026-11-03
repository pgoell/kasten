/**
 * Ranks folders for the prompt and notes for the finder, through one scorer.
 * Only the candidates differ, and whether a letter in the last segment is paid for.
 */

/**
 * A path prepared for ranking. Derived once per vault, not per query, so the call site memoizes it.
 */
export interface Candidate {
  path: string;
  lower: string;
  /** Where the last segment starts. Past the end of `lower` means no name bonus. */
  nameAt: number;
}

/**
 * Every directory prefix of `paths`, deduped, in first-seen order.
 * Left unsorted on purpose: a sorted listing keeps the sort in `rankCandidates` cheap.
 */
export function folderCandidates(paths: string[]): Candidate[] {
  const seen = new Set<string>();
  const folders: Candidate[] = [];

  for (const path of paths) {
    const segments = path.split("/");
    let prefix = "";
    // The last segment is the note, so only the earlier ones are folders.
    for (const segment of segments.slice(0, -1)) {
      prefix += `${segment}/`;
      if (seen.has(prefix)) continue;
      seen.add(prefix);
      const lower = prefix.toLowerCase();
      // Folders get no name bonus: a folder's last segment is not a note's name.
      folders.push({ path: prefix, lower, nameAt: lower.length });
    }
  }
  return folders;
}

/** Every note, prepared for ranking, in the order the listing arrived in. */
export function noteCandidates(paths: string[]): Candidate[] {
  return paths.map((path) => {
    const lower = path.toLowerCase();
    return { path, lower, nameAt: lower.lastIndexOf("/") + 1 };
  });
}

// Counted rather than timed for the perf gates: a clock would measure the machine.
export const work = { candidates: 0, cells: 0 };

export function resetWork(): void {
  work.candidates = 0;
  work.cells = 0;
}

const NONE = Number.NEGATIVE_INFINITY;
const SLASH = "/".charCodeAt(0);

// Reused across candidates and keystrokes; the scorer allocates nothing per query character.
let scratchA = new Float64Array(256);
let scratchB = new Float64Array(256);

/** Both rows, big enough for the longest candidate seen so far. */
function grow(size: number) {
  if (scratchA.length >= size) return;
  scratchA = new Float64Array(size);
  scratchB = new Float64Array(size);
}

/** Whether `query` reads as a subsequence of `lower` at all: the cheap rejection, no row. */
function readsInto(lower: string, query: string): boolean {
  let at = 0;
  for (let i = 0; i < query.length; i += 1) {
    at = lower.indexOf(query.charAt(i), at);
    if (at === -1) return false;
    at += 1;
  }
  return true;
}

/** What landing a query character on `lower[j]` scores, given the best run before it. */
function landing(lower: string, nameAt: number, j: number, carry: number, left: number): number {
  const opens = j === 0 || lower.charCodeAt(j - 1) === SLASH ? 3 : 0;
  const named = j >= nameAt ? 2 : 0;
  return 1 + opens + named + (left > carry ? left : carry);
}

/** `next[j]`: best score of the query so far ending on `lower[j]`, NONE if it cannot end there. */
function fillRow(
  row: Float64Array,
  next: Float64Array,
  { lower, nameAt }: Candidate,
  char: number,
  first: boolean,
) {
  const length = lower.length;
  next.fill(NONE, 0, length);
  let left = first ? 0 : NONE;
  let behind = NONE;

  for (let j = 0; j < length; j += 1) {
    if (lower.charCodeAt(j) === char)
      next[j] = landing(lower, nameAt, j, first ? NONE : behind + 2, left);
    // `?? NONE` only satisfies the index type; a cell is never undefined.
    const cell = row[j] ?? NONE;
    if (!first && cell > left) left = cell;
    behind = cell;
  }
}

function rowBest(row: Float64Array, length: number): number {
  let best = NONE;
  for (let j = 0; j < length; j += 1) {
    const cell = row[j] ?? NONE;
    if (cell > best) best = cell;
  }
  return best;
}

/**
 * How well `query` reads as a subsequence of `candidate`, or `NONE` when it does not.
 * Scored where it lands best, not first, so `arch` finds `kasten/architecture.md`.
 * Count code units on both sides: a mix of characters and code units breaks the match.
 */
function score(candidate: Candidate, query: string): number {
  work.candidates += 1;
  const length = candidate.lower.length;

  // Cheap rejection first: most candidates fail here without allocating a row.
  if (!readsInto(candidate.lower, query)) return NONE;
  work.cells += query.length * length;

  grow(length);
  let row = scratchA;
  let next = scratchB;
  // Seed row for the empty query, which scores nothing, so the first character starts no run.
  row.fill(0, 0, length);

  for (let i = 0; i < query.length; i += 1) {
    fillRow(row, next, candidate, query.charCodeAt(i), i === 0);
    const filled = next;
    next = row;
    row = filled;
  }
  return rowBest(row, length);
}

interface Scored {
  candidate: Candidate;
  /** Where it sat in the array it was ranked from, which is one way back to it. */
  index: number;
  points: number;
}

/** Every candidate `query` reads into, in input order. Shared so both rankings score alike. */
function scoreAll(candidates: Candidate[], query: string): Scored[] {
  const wanted = query.toLowerCase();
  const scored: Scored[] = [];
  let index = 0;

  for (const candidate of candidates) {
    const points = score(candidate, wanted);
    if (points !== NONE) scored.push({ candidate, index, points });
    index += 1;
  }
  return scored;
}

/** Candidates already derived, ranked against `query`, best first. */
export function rankCandidates(candidates: Candidate[], query: string): string[] {
  const ranked = scoreAll(candidates, query);

  // Equal scores fall back to path order, which is where a reader looks.
  ranked.sort((a, b) => b.points - a.points || a.candidate.path.localeCompare(b.candidate.path));
  return ranked.map((entry) => entry.candidate.path);
}

/**
 * The same ranking, answered as positions. Hits can share a line's text, so the position is the way back.
 */
export function rankIndexes(candidates: Candidate[], query: string): number[] {
  const ranked = scoreAll(candidates, query);

  // Ties keep input order (rg's path, then line, for search hits); never sort them by text.
  ranked.sort((a, b) => b.points - a.points || a.index - b.index);
  return ranked.map((entry) => entry.index);
}

/** Lines of prose prepared for ranking. No name bonus: a line has no last segment. */
export function lineCandidates(lines: string[]): Candidate[] {
  return lines.map((line) => {
    const lower = line.toLowerCase();
    return { path: line, lower, nameAt: lower.length };
  });
}

/** Positions of every line in `lines` the query reads into, best first. */
export function rankLines(lines: string[], query: string): number[] {
  return rankIndexes(lineCandidates(lines), query);
}

/** Folder prefixes of `paths`, each ending in "/", ranked against `query`. */
export function rankFolders(paths: string[], query: string): string[] {
  return rankCandidates(folderCandidates(paths), query);
}

/** Every note in `paths`, ranked against `query`. */
export function rankNotes(paths: string[], query: string): string[] {
  return rankCandidates(noteCandidates(paths), query);
}
