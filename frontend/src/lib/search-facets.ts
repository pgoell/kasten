/**
 * The folders and tags a search result can be narrowed by, and the narrowing.
 *
 * Counts are lines, because a hit is one line: a note with three matching lines
 * under `#reading` is three in that tag's count, the way the list shows them.
 */

import type { SearchHit } from "@/lib/api";

/** The top folder a path sits in, "" for a note at the vault's root. */
export function topFolder(path: string): string {
  const slash = path.indexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

export interface Facet {
  name: string;
  /** Matching lines. */
  count: number;
}

function busiestFirst(counts: Map<string, number>): Facet[] {
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Lines per top folder and per tag, busiest first, then by name. */
export function facets(hits: SearchHit[]): { folders: Facet[]; tags: Facet[] } {
  const folders = new Map<string, number>();
  const tags = new Map<string, number>();
  for (const hit of hits) {
    const folder = topFolder(hit.path);
    folders.set(folder, (folders.get(folder) ?? 0) + 1);
    // A line naming a tag twice is still one line under it.
    for (const tag of new Set(hit.tags ?? [])) {
      tags.set(tag, (tags.get(tag) ?? 0) + 1);
    }
  }
  return { folders: busiestFirst(folders), tags: busiestFirst(tags) };
}

export interface Filters {
  folder: string | null;
  tag: string | null;
}

/** The hits inside the chosen folder and carrying the chosen tag; null lets all through. */
export function filterHits(hits: SearchHit[], filters: Filters): SearchHit[] {
  return hits.filter(
    (hit) =>
      (filters.folder === null || topFolder(hit.path) === filters.folder) &&
      (filters.tag === null || (hit.tags ?? []).includes(filters.tag)),
  );
}

/**
 * `text` cut into runs, each saying whether it is the term.
 *
 * The term is matched as text, the way the backend's search matches it
 * (`rg --fixed-strings --ignore-case`), so a `.` in it is a dot. The match runs
 * on the text's own UTF-16 offsets, which a case-folded copy of the text would
 * not keep: lowercasing can change a string's length, and then the runs would
 * drift off the words they mark.
 */
export function termRuns(text: string, term: string): { text: string; term: boolean }[] {
  if (term.trim() === "") return [{ text, term: false }];

  const literal = term.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  const runs: { text: string; term: boolean }[] = [];
  let last = 0;
  for (const match of text.matchAll(new RegExp(literal, "giu"))) {
    const at = match.index ?? 0;
    if (at > last) runs.push({ text: text.slice(last, at), term: false });
    runs.push({ text: match[0], term: true });
    last = at + match[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), term: false });
  return runs;
}
