import { useQuery } from "@tanstack/react-query";
import { type SearchHit, searchNotes } from "@/lib/api";
import { readClock, shiftDay } from "@/lib/clock";

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

/**
 * The notes written lately, newest first, from the search the home screen runs
 * for its Recent column. The same keys, so a pane that asks shares the answer.
 */
export function useRecentNotes(archive: boolean): { path: string; stamp: string }[] {
  const today = readClock(new Date()).date;
  const month = today.slice(0, 7);
  const lastMonth = shiftDay(`${month}-01`, -1).slice(0, 7);

  const thisMonth = useQuery({
    queryKey: ["search", `${STAMP}${month}`, archive],
    queryFn: () => searchNotes(`${STAMP}${month}`, archive),
  });
  const priorMonth = useQuery({
    queryKey: ["search", `${STAMP}${lastMonth}`, archive],
    queryFn: () => searchNotes(`${STAMP}${lastMonth}`, archive),
  });
  return recentOf([...(thisMonth.data ?? []), ...(priorMonth.data ?? [])]);
}
