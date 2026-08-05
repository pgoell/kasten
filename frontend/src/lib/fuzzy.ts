/**
 * The vault's folders, ranked against what has been typed so far.
 *
 * Only folders, because the prompt completes where a note goes and the note's
 * own name is what the user is there to write.
 */

/** Every directory prefix of `paths`, deduped, each ending in "/". */
function folders(paths: string[]): string[] {
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
 * Matching is greedy from the left, so a query that could land in two places
 * takes the first. The bonuses pay for a run of letters and for a letter that
 * opens a folder name, which is what makes `pk` mean `projects/kasten/` rather
 * than any folder carrying the two letters.
 */
function score(candidate: string, query: string): number | null {
  const haystack = candidate.toLowerCase();
  let total = 0;
  let from = 0;
  // Two before the first index, so the opening match cannot read as a run.
  let previous = -2;

  for (const char of query) {
    const at = haystack.indexOf(char, from);
    if (at === -1) return null;

    total += 1;
    if (at === previous + 1) total += 2;
    if (at === 0 || haystack[at - 1] === "/") total += 3;
    previous = at;
    from = at + 1;
  }
  return total;
}

/** Folder prefixes of `paths`, each ending in "/", ranked against `query`. */
export function rankFolders(paths: string[], query: string): string[] {
  const wanted = query.toLowerCase();
  const ranked: Array<{ folder: string; points: number }> = [];

  for (const folder of folders(paths)) {
    const points = score(folder, wanted);
    if (points !== null) ranked.push({ folder, points });
  }

  // The shorter of two equal folders first, because it is the one the typed
  // letters cover more of.
  ranked.sort(
    (a, b) =>
      b.points - a.points || a.folder.length - b.folder.length || a.folder.localeCompare(b.folder),
  );
  return ranked.map((entry) => entry.folder);
}
