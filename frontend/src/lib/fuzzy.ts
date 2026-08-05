/**
 * The vault's folders, ranked against what has been typed so far.
 *
 * Only folders, because the prompt completes where a note goes and the note's
 * own name is what the user is there to write.
 */

/**
 * Every directory prefix of `paths`, deduped, each ending in "/", in first-seen
 * order.
 *
 * Split out from the ranking because it depends on the vault and not on the
 * query, and it is the larger half: at 10,000 notes it walks every path to find
 * 842 folders, which profiling put at 3.8ms of a 16.8ms keystroke. Derived once
 * per listing it costs nothing per keystroke.
 *
 * Unsorted on purpose. A listing arrives sorted, ranking decides what the
 * prompt shows, and the sort in `rankFolderPrefixes` is cheap only because
 * these already arrive in order.
 */
export function folderPrefixes(paths: string[]): string[] {
  const seen = new Set<string>();

  for (const path of paths) {
    const segments = path.split("/");
    let prefix = "";
    // The last segment names the note, so every earlier one is a folder, and a
    // nested path names one at each level.
    for (const segment of segments.slice(0, -1)) {
      prefix += `${segment}/`;
      seen.add(prefix);
    }
  }
  return [...seen];
}

/**
 * How well `query` reads as a subsequence of `candidate`, or null when it does
 * not read as one at all.
 *
 * A query that could land in two places is scored where it lands best, not
 * where it lands first. The bonuses pay for a run of letters and for a letter
 * that opens a folder name, which is what makes `pk` mean `projects/kasten/`
 * rather than any folder carrying the two letters.
 */
function score(candidate: string, query: string): number | null {
  // The loop below walks the query by character, so the candidate is held as
  // characters too. Indexing the string walks code units instead, and a
  // character written in two of them, an emoji opening a folder name, then
  // matches neither half of itself.
  const haystack = Array.from(candidate.toLowerCase());
  const NONE = Number.NEGATIVE_INFINITY;
  // `row[j]` is the best score of the query read so far ending on
  // `haystack[j]`, and NONE where it cannot end there. One pass over the
  // haystack takes one more query character, so every alignment is weighed and
  // the best cell of the last row is the answer. Folders are short and few, so
  // the cost of weighing them all is beneath notice.
  let row = new Array<number>(haystack.length).fill(0);
  // The seed row stands for the empty query, which reads into anything and pays
  // nothing. It ends nowhere, so the first character can start no run off it.
  let first = true;

  for (const char of query) {
    const next = new Array<number>(haystack.length).fill(NONE);
    // The best cell left of `j`, which is what a match starting no run pays.
    let left = first ? 0 : NONE;
    // The cell at `j - 1`, which is where a run of letters carries on from.
    let behind = NONE;

    for (const [j, cell] of row.entries()) {
      if (haystack[j] === char) {
        const opens = j === 0 || haystack[j - 1] === "/" ? 3 : 0;
        next[j] = 1 + opens + Math.max(left, first ? NONE : behind + 2);
      }
      if (!first) left = Math.max(left, cell);
      behind = cell;
    }
    row = next;
    first = false;
  }

  const best = Math.max(...row);
  return best === NONE ? null : best;
}

/** Prefixes already derived, ranked against `query`. */
export function rankFolderPrefixes(prefixes: string[], query: string): string[] {
  const wanted = query.toLowerCase();
  const ranked: Array<{ folder: string; points: number }> = [];

  for (const folder of prefixes) {
    const points = score(folder, wanted);
    if (points !== null) ranked.push({ folder, points });
  }

  // Two equal folders go in name order, which is where a reader looks for one.
  // A folder sorts before the folders inside it anyway, being their prefix.
  ranked.sort((a, b) => b.points - a.points || a.folder.localeCompare(b.folder));
  return ranked.map((entry) => entry.folder);
}

/** Folder prefixes of `paths`, each ending in "/", ranked against `query`. */
export function rankFolders(paths: string[], query: string): string[] {
  return rankFolderPrefixes(folderPrefixes(paths), query);
}
