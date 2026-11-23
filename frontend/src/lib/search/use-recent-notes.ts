import { type QueryClient, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { type SearchHit, searchNotes } from "@/lib/core/api";
import { readClock, shiftDay } from "@/lib/core/clock";

/** How many notes the middle column lists. */
const RECENT = 8;

/** The frontmatter's own lines: a `modified:` further down is someone's text. */
const FRONTMATTER_LINES = 20;

const STAMP = "modified: ";

/** The newest `modified:` stamp of each note, newest first, at most `RECENT`. */
export function recentOf(hits: SearchHit[]): { path: string; stamp: string }[] {
  const newest = new Map<string, string>();
  for (const hit of hits) {
    const line = hit.text.trim();
    if (hit.line > FRONTMATTER_LINES || !line.startsWith(STAMP)) continue;
    const stamp = line.slice(STAMP.length);
    if (stamp > (newest.get(hit.path) ?? "")) newest.set(hit.path, stamp);
  }
  return [...newest]
    .map(([path, stamp]) => ({ path, stamp }))
    .sort((a, b) => b.stamp.localeCompare(a.stamp))
    .slice(0, RECENT);
}

/** The keys of the two searches the Recent column reads: this month's stamps and last month's. */
type RecentKey = [string, string, boolean];
export function recentKeys(archive: boolean, today: string): [RecentKey, RecentKey] {
  const month = today.slice(0, 7);
  const lastMonth = shiftDay(`${month}-01`, -1).slice(0, 7);
  return [
    ["search", `${STAMP}${month}`, archive],
    ["search", `${STAMP}${lastMonth}`, archive],
  ];
}

function useRecentSearches(archive: boolean) {
  const [thisKey, priorKey] = recentKeys(archive, readClock(new Date()).date);
  const thisMonth = useQuery({
    queryKey: thisKey,
    queryFn: () => searchNotes(thisKey[1], archive),
  });
  const priorMonth = useQuery({
    queryKey: priorKey,
    queryFn: () => searchNotes(priorKey[1], archive),
  });
  return [thisMonth, priorMonth];
}

/**
 * The notes written lately, newest first, from the search the home screen runs
 * for its Recent column. The same keys, so a pane that asks shares the answer.
 */
export function useRecentNotes(archive: boolean): { path: string; stamp: string }[] {
  return recentOf(useRecentSearches(archive).flatMap((search) => search.data ?? []));
}

/**
 * As `useRecentNotes`, but undefined until both searches have answered or failed since the
 * caller mounted, so a stale answer never draws before the fresh one (#2301). Once drawn it stays.
 */
export function useRecentList(archive: boolean): { path: string; stamp: string }[] | undefined {
  const searches = useRecentSearches(archive);
  const settled = searches.every(
    (search) => !search.isFetching && (search.data !== undefined || search.isError),
  );
  const [drawn, setDrawn] = useState(false);
  if (settled && !drawn) setDrawn(true);
  return drawn || settled ? recentOf(searches.flatMap((search) => search.data ?? [])) : undefined;
}

/** Marks the Recent searches stale after a write, so the next list shows the note it wrote (#1971). */
export function refreshRecent(client: QueryClient): void {
  const today = readClock(new Date()).date;
  for (const archive of [false, true]) {
    for (const queryKey of recentKeys(archive, today)) {
      void client.invalidateQueries({ queryKey, exact: true });
    }
  }
}
