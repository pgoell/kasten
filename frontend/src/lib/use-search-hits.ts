import { keepPreviousData, skipToken, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { fetchMentions, fetchTodos, type Mention, type SearchHit, searchNotes } from "@/lib/api";
import { inArchive } from "@/lib/archive";
import { lineCandidates, rankIndexes } from "@/lib/fuzzy";
import { noteName } from "@/lib/note-path";
import { readRelation } from "@/lib/relation";
import { isOpen, parseTodo } from "@/lib/todo/todo";
import { wikiLinkPath, wikiLinkTargets } from "@/lib/wikilink";

/** Which of the three lists the panel is drawing, and where its lines come from. */
export type SearchMode = "search" | "backlinks" | "todos";

/** Rows the list will mount. Beyond this, another letter narrows faster than a scroll. */
const VISIBLE_HITS = 20;

/**
 * The most lines the backend answers with, `MOST_HITS` in `search.py`. An
 * answer this long is cut, so its counts are of the first lines only.
 */
const MOST_HITS = 2000;

/**
 * How long typing holds still before the vault is read.
 *
 * Unlike the finder, every query here is a scan of the whole vault, so a
 * keystroke that fired its own would be ten scans for a word nobody finished
 * typing. Short enough that finishing a word and finding it read as one thing.
 */
const SETTLE_MS = 120;

/** The relation name to group a backlink hit under, or null for the untyped group. */
function relationOf(text: string, viewing: string, paths: string[]): string | null {
  const relation = readRelation(text);
  // A line shows in the panel when any wikilink on it resolves here, so
  // `depends-on:: [[A]] because [[B]]` is in B's panel too. Grouping that by
  // the name alone would tell B it is a dependency when the line says A is.
  if (relation === null || wikiLinkPath(relation.target, paths) !== viewing) return null;
  return relation.name;
}

/**
 * The heading over the lines naming the note without linking it, Obsidian's
 * words. It has a space in it, so no relation name can spell it.
 */
const UNLINKED = "unlinked mentions";

/** Whether a row of the list is an unlinked mention rather than a line of links. */
export function isMention(hit: SearchHit | Mention): hit is Mention {
  return "start" in hit;
}

/** One heading and the ranked rows under it. A null name is the untyped group. */
export interface Group {
  name: string | null;
  rows: number[];
}

/**
 * The search page's groups: one per note, in the order each note's best-ranked
 * line came in, so the first row of the first group is the best line of all.
 */
function groupByPath(rows: number[], found: (SearchHit | Mention)[]): Group[] {
  const byPath = new Map<string, number[]>();
  for (const row of rows) {
    const hit = found[row];
    if (hit === undefined) continue;
    const under = byPath.get(hit.path);
    if (under === undefined) byPath.set(hit.path, [row]);
    else under.push(row);
  }
  return [...byPath].map(([name, under]) => ({ name, rows: under }));
}

/**
 * The ranked rows in the order they are drawn: each name once, untyped next,
 * and the unlinked mentions last, being the lines that do not link here yet.
 */
function groupHits(
  rows: number[],
  found: (SearchHit | Mention)[],
  viewing: string,
  paths: string[],
): Group[] {
  const named = new Map<string, number[]>();
  const untyped: number[] = [];
  const unlinked: number[] = [];

  for (const row of rows) {
    const hit = found[row];
    if (hit !== undefined && isMention(hit)) {
      unlinked.push(row);
      continue;
    }
    const name = hit === undefined ? null : relationOf(hit.text, viewing, paths);
    if (name === null) {
      untyped.push(row);
      continue;
    }
    const under = named.get(name);
    if (under === undefined) named.set(name, [row]);
    else under.push(row);
  }

  // A map keeps insertion order, which here is first appearance in the ranking,
  // and the rows inside each name keep the rank order they arrived in.
  const groups: Group[] = [...named].map(([name, under]) => ({ name, rows: under }));
  if (untyped.length > 0) groups.push({ name: null, rows: untyped });
  if (unlinked.length > 0) groups.push({ name: UNLINKED, rows: unlinked });
  return groups;
}

/**
 * The answer for the panel: what the vault said about what was typed, ranked
 * against it, and grouped where backlinks ask for it.
 */
export function useSearchHits({
  mode,
  typed,
  backlinksOf,
  paths,
  archive,
  keep,
  visible = VISIBLE_HITS,
}: {
  mode: SearchMode;
  typed: string;
  backlinksOf?: string;
  paths?: string[];
  archive: boolean;
  /** Search only: the lines allowed into the ranking. Callers pass a memoised one. */
  keep?: (hit: SearchHit) => boolean;
  /** Search only: how many rows the list keeps. */
  visible?: number;
}): {
  found: (SearchHit | Mention)[];
  groups: Group[];
  ordered: number[];
  pending: boolean;
  /** Search only: the lines the query has in the archive, counted whether the archive is in or out. */
  archived: number | undefined;
  /** Search only: whether the answer hit the backend's cap. */
  capped: boolean;
} {
  /** What a typed query settled on, which trails what has been typed. */
  const [settled, setSettled] = useState("");

  // What the vault is asked for. Backlinks ask for the note's name, and ask
  // once: every link to a note carries its name, whether it spelled the path
  // out or not, so the name is the one query no link to it can escape.
  const name = backlinksOf === undefined ? undefined : noteName(backlinksOf);
  const asked = name ?? settled;

  useEffect(() => {
    // Nothing to settle where the query is fixed, and a timer over it would
    // only be a second answer to a question already asked.
    if (mode !== "search") return;
    const timer = setTimeout(() => setSettled(typed), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [typed, mode]);

  // Typed as the search's answer: a todo is a search hit with no date or tags,
  // so the one query can answer either without the union confusing the types.
  const search = useQuery<SearchHit[]>({
    // The todo list shares its key with the pane, so the two read one answer.
    ...(mode === "todos"
      ? { queryKey: ["todos", archive], queryFn: () => fetchTodos(archive) }
      : {
          queryKey: ["search", asked, archive],
          queryFn: asked === "" ? skipToken : () => searchNotes(asked, archive),
        }),
    // What keeps the last answer on screen while the next one is fetched, and
    // so what there is to narrow in the meantime. A cleared query keeps nothing:
    // the last answer would otherwise stay under an empty field.
    placeholderData: mode === "search" && asked === "" ? undefined : keepPreviousData,
    // A scan nobody asked to repeat is not worth three attempts and a backoff.
    retry: false,
  });

  // Search only: the same question with the archive in. With the archive in
  // this is the answer above under the same key, so it costs nothing; with it
  // out, it is the one extra ask that lets the filter column count the archive
  // before anyone turns it on.
  const withArchive = useQuery<SearchHit[]>({
    queryKey: ["search", asked, true],
    queryFn: mode !== "search" || asked === "" ? skipToken : () => searchNotes(asked, true),
    placeholderData: asked === "" ? undefined : keepPreviousData,
    retry: false,
  });

  // The lines naming the note in plain words, asked beside the links and only
  // for backlinks. The backend reads these itself, titles and aliases being
  // something rg on the name alone cannot find.
  const mentions = useQuery({
    queryKey: ["mentions", backlinksOf, archive],
    queryFn: backlinksOf === undefined ? skipToken : () => fetchMentions(backlinksOf, archive),
    placeholderData: keepPreviousData,
    retry: false,
  });

  // Every line the vault answered with, cut to the ones that really are links
  // where backlinks were asked for. rg finds the note's name in prose as
  // readily as in a link, and only reading the line as the editor parses it
  // tells the two apart. Resolving each target against the listing is what
  // keeps `[[borges]]` and `[[reading/borges]]` both counting, and a link to
  // another note of the same name in another folder not counting at all.
  //
  // The todo endpoint matches the shape of a checkbox and nothing else, so the
  // same reading cuts its answer down: a session line is not a todo and a
  // finished one is not work.
  //
  // The unlinked mentions go on the end of the same array, so the ranking, the
  // highlight and Enter count them the way they count every other row.
  const found: (SearchHit | Mention)[] = useMemo(() => {
    const hits = search.data ?? [];
    if (mode === "todos") {
      return hits.filter((hit) => {
        const todo = parseTodo(hit.text);
        return todo !== null && isOpen(todo);
      });
    }
    if (backlinksOf === undefined) return hits;
    const linked = hits.filter((hit) =>
      wikiLinkTargets(hit.text).some((target) => wikiLinkPath(target, paths ?? []) === backlinksOf),
    );
    return [...linked, ...(mentions.data ?? [])];
  }, [search.data, mentions.data, mode, backlinksOf, paths]);
  // Derived from the answer and not from the query, so every keystroke between
  // two answers ranks a set that was prepared once.
  const candidates = useMemo(() => lineCandidates(found.map((hit) => hit.text)), [found]);
  // Ranked against what is typed now rather than what was asked for, which is
  // what narrows the list while the next scan is still out. Ranked whole and
  // cut afterwards, so the rows are the best of the answer and not its head.
  //
  // The mentions are cut on their own, so a note with more links than the list
  // holds still shows the best of its mentions rather than none of them.
  const hits = useMemo(() => {
    const ranked = rankIndexes(candidates, typed);
    // Search keeps the lines its filters allow before the cut, so the rows are
    // the best of what is shown and not the best of everything then filtered.
    if (mode === "search") {
      const allowed = ranked.filter((index) => {
        const hit = found[index];
        return hit !== undefined && !isMention(hit) && (keep?.(hit) ?? true);
      });
      return allowed.slice(0, visible);
    }
    const linked: number[] = [];
    const unlinked: number[] = [];
    for (const index of ranked) {
      const hit = found[index];
      (hit !== undefined && isMention(hit) ? unlinked : linked).push(index);
    }
    return [...linked.slice(0, VISIBLE_HITS), ...unlinked.slice(0, VISIBLE_HITS)];
  }, [candidates, typed, found, mode, keep, visible]);
  // Backlinks gather under the relation name pointing here; search gathers
  // under the note; the todo list is one group with no name, so its rows come
  // out in the order they were ranked in and nothing on screen moves.
  const groups = useMemo(() => {
    if (mode === "search") return groupByPath(hits, found);
    return mode === "backlinks" && backlinksOf !== undefined
      ? groupHits(hits, found, backlinksOf, paths ?? [])
      : [{ name: null, rows: hits }];
  }, [mode, backlinksOf, hits, found, paths]);
  // The order the rows are drawn in, which is the order everything downstream
  // counts in. The highlight, the preview and Enter all index this one array,
  // so grouping at render alone would point all three at another line.
  const ordered = useMemo(() => groups.flatMap((group) => group.rows), [groups]);

  const archived = useMemo(
    () =>
      mode === "search" && withArchive.data !== undefined
        ? withArchive.data.filter((hit) => inArchive(hit.path)).length
        : undefined,
    [mode, withArchive.data],
  );

  return {
    found,
    groups,
    ordered,
    pending: search.isFetching || mentions.isFetching,
    archived,
    capped: mode === "search" && (search.data?.length ?? 0) >= MOST_HITS,
  };
}
