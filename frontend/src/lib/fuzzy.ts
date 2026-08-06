/**
 * The vault ranked against what has been typed, for the prompt and the finder.
 *
 * Two surfaces rank two different things through one recurrence. The prompt
 * ranks folders, because it completes where a note goes and the note's own name
 * is what the user is there to write. The finder ranks notes, because the note
 * is the thing it opens. Only the candidates differ, and whether a letter
 * landing in the last segment is paid for.
 */

/**
 * A path prepared for ranking, derived once per vault.
 *
 * Everything here depends on the vault and not on the query, which is what
 * earns it a memo of its own at the call site. At 10,000 notes deriving this
 * costs 0.8ms once; doing it per keystroke instead was most of what ranking
 * used to cost.
 */
export interface Candidate {
  /** The path as the vault spells it, which is what a caller gets back. */
  path: string;
  /** The same path lowercased once, which is what the scorer reads. */
  lower: string;
  /** Where the last segment starts. Past the end of `lower` means no name bonus. */
  nameAt: number;
}

/**
 * Every directory prefix of `paths`, deduped, each ending in "/", in first-seen
 * order.
 *
 * Unsorted on purpose. A listing arrives sorted, ranking decides what the
 * prompt shows, and the sort in `rankCandidates` is cheap only because these
 * already arrive in order.
 */
export function folderCandidates(paths: string[]): Candidate[] {
  const seen = new Set<string>();
  const folders: Candidate[] = [];

  for (const path of paths) {
    const segments = path.split("/");
    let prefix = "";
    // The last segment names the note, so every earlier one is a folder, and a
    // nested path names one at each level.
    for (const segment of segments.slice(0, -1)) {
      prefix += `${segment}/`;
      if (seen.has(prefix)) continue;
      seen.add(prefix);
      const lower = prefix.toLowerCase();
      // A folder opts out of the name bonus by naming a start no character can
      // reach. Its own name is where the notes underneath begin, not a segment
      // to be weighed against the rest of the path.
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

const NONE = Number.NEGATIVE_INFINITY;
const SLASH = "/".charCodeAt(0);

// Two rows, reused by every candidate and every keystroke. The table below
// needs the row behind it and the row it is filling, and nothing else, so two
// buffers swapped in place do the work that a fresh array per query character
// used to. Ten thousand notes and a four letter query is 40,000 allocations
// saved, which is where the old scorer spent most of a keystroke.
let scratchA = new Float64Array(256);
let scratchB = new Float64Array(256);

/** Both rows, big enough for the longest candidate seen so far. */
function grow(size: number) {
  if (scratchA.length >= size) return;
  scratchA = new Float64Array(size);
  scratchB = new Float64Array(size);
}

/**
 * How well `query` reads as a subsequence of `candidate`, or `NONE` when it does
 * not read as one at all.
 *
 * A query that could land in two places is scored where it lands best, not
 * where it lands first. The bonuses pay for a run of letters, for a letter that
 * opens a segment, and for a letter inside the candidate's own name. That is
 * what makes `pk` mean `projects/kasten/` rather than any folder carrying the
 * two letters, and `arch` mean `kasten/architecture.md` rather than
 * `archive/march.md`, which reads just as well everywhere else.
 *
 * Both sides are counted in code units rather than characters. They only have
 * to agree: a character written in two of them, an emoji opening a folder name,
 * then matches as two units in a row and collects the run bonus between them,
 * so it still reads as the one thing it looks like. Counting one side in
 * characters and the other in code units is the arrangement that breaks, and
 * `Array.from` on every candidate is too dear to be the way out of it.
 */
function score(candidate: Candidate, query: string): number {
  const { lower, nameAt } = candidate;
  const length = lower.length;

  // Cheap rejection first. Unless the query reads into the candidate at all
  // there is nothing for the table below to find, and `indexOf` settles that in
  // one native pass with no allocation. Most of a vault leaves here on most
  // queries, which is what keeps the cost with the matches rather than with the
  // notes.
  let at = 0;
  for (let i = 0; i < query.length; i += 1) {
    at = lower.indexOf(query.charAt(i), at);
    if (at === -1) return NONE;
    at += 1;
  }

  grow(length);
  let row = scratchA;
  let next = scratchB;
  // The seed row stands for the empty query, which reads into anything and pays
  // nothing. It ends nowhere, so the first character can start no run off it.
  row.fill(0, 0, length);
  let first = true;

  for (let i = 0; i < query.length; i += 1) {
    const char = query.charCodeAt(i);
    // `next[j]` is the best score of the query read so far ending on `lower[j]`,
    // and NONE where it cannot end there. One pass takes one more query
    // character, so every alignment is weighed and the best cell of the last
    // row is the answer.
    next.fill(NONE, 0, length);
    // The best cell left of `j`, which is what a match starting no run pays.
    let left = first ? 0 : NONE;
    // The cell at `j - 1`, which is where a run of letters carries on from.
    let behind = NONE;

    for (let j = 0; j < length; j += 1) {
      if (lower.charCodeAt(j) === char) {
        const opens = j === 0 || lower.charCodeAt(j - 1) === SLASH ? 3 : 0;
        const named = j >= nameAt ? 2 : 0;
        const carry = first ? NONE : behind + 2;
        next[j] = 1 + opens + named + (left > carry ? left : carry);
      }
      // `?? NONE` only for the index signature: `j` is inside the row by the
      // loop's own bound, and a cell never holds undefined.
      const cell = row[j] ?? NONE;
      if (!first && cell > left) left = cell;
      behind = cell;
    }

    const filled = next;
    next = row;
    row = filled;
    first = false;
  }

  let best = NONE;
  for (let j = 0; j < length; j += 1) {
    const cell = row[j] ?? NONE;
    if (cell > best) best = cell;
  }
  return best;
}

interface Scored {
  candidate: Candidate;
  /** Where it sat in the array it was ranked from, which is one way back to it. */
  index: number;
  points: number;
}

/**
 * Every candidate `query` reads into, still in the order they were given.
 *
 * The two rankings below differ only in how they break a tie and what they
 * hand back, so the scoring itself lives here once.
 */
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

  // Two equal paths go in name order, which is where a reader looks for one. A
  // folder sorts before the folders inside it anyway, being their prefix.
  ranked.sort((a, b) => b.points - a.points || a.candidate.path.localeCompare(b.candidate.path));
  return ranked.map((entry) => entry.candidate.path);
}

/**
 * The same ranking, answered as positions rather than as paths.
 *
 * What a search hit needs. Two hits can carry the very same line, on different
 * notes or on two lines of one, so the text cannot be the way back to the hit
 * it came from and the position has to be.
 */
export function rankIndexes(candidates: Candidate[], query: string): number[] {
  const ranked = scoreAll(candidates, query);

  // Ties keep the order they arrived in, which for search hits is rg's: path
  // order, then line order inside a note. That is the order a reader expects,
  // and sorting equal lines by their text would scramble it for nothing.
  ranked.sort((a, b) => b.points - a.points || a.index - b.index);
  return ranked.map((entry) => entry.index);
}

/**
 * Lines of prose prepared for ranking.
 *
 * No name bonus, the way a folder opts out of one: a line has no last segment,
 * and nothing in it is more the line's own name than the rest.
 */
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
