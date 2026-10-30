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

/** The backend's line cap (`MOST_HITS` in `search.py`); an answer this long is cut. */
const MOST_HITS = 2000;

/**
 * How long typing holds still before the vault is scanned. Every query here scans the whole vault,
 * so a keystroke firing its own would waste a scan.
 */
const SETTLE_MS = 120;

/** The relation name to group a backlink hit under, or null for the untyped group. */
function relationOf(text: string, viewing: string, paths: string[]): string | null {
  const relation = readRelation(text);
  // The relation must point here. A line shows here on any link in it, so `depends-on:: [[A]]
  // because [[B]]` is in B's panel too, and must not be grouped as a dependency there.
  if (relation === null || wikiLinkPath(relation.target, paths) !== viewing) return null;
  return relation.name;
}

/** Heading for mentions that name the note unlinked. Its space keeps it from any relation. */
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

/** One group per note, in order of each note's best-ranked line. */
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

/** The ranked rows in draw order: each relation name once, then untyped, then unlinked mentions. */
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

  // Map order is first appearance in the ranking, so each group follows its best row.
  const groups: Group[] = [...named].map(([name, under]) => ({ name, rows: under }));
  if (untyped.length > 0) groups.push({ name: null, rows: untyped });
  if (unlinked.length > 0) groups.push({ name: UNLINKED, rows: unlinked });
  return groups;
}

/** What the vault said about the typed query, ranked against it and grouped for backlinks. */
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
  /** Search only: lines the query has in the archive, counted even when it is filtered out. */
  archived: number | undefined;
  /** Search only: whether the answer hit the backend's cap. */
  capped: boolean;
} {
  /** What a typed query settled on, which trails what has been typed. */
  const [settled, setSettled] = useState("");

  // Backlinks ask once, for the note's name: every link to a note carries it, so none can escape.
  const name = backlinksOf === undefined ? undefined : noteName(backlinksOf);
  const asked = name ?? settled;

  useEffect(() => {
    // A fixed query needs no settling; a timer would only ask the same question again.
    if (mode !== "search") return;
    const timer = setTimeout(() => setSettled(typed), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [typed, mode]);

  // A todo is a search hit, so one query answers either without a union confusing the types.
  const search = useQuery<SearchHit[]>({
    // The todo list shares its key with the pane, so the two read one answer.
    ...(mode === "todos"
      ? { queryKey: ["todos", archive], queryFn: () => fetchTodos(archive) }
      : {
          queryKey: ["search", asked, archive],
          queryFn: asked === "" ? skipToken : () => searchNotes(asked, archive),
        }),
    // Keeps the last answer on screen while the next loads, so there is something to narrow.
    // A cleared query keeps nothing, or the old answer would stay under an empty field.
    placeholderData: mode === "search" && asked === "" ? undefined : keepPreviousData,
    // A scan nobody asked to repeat is not worth three attempts and a backoff.
    retry: false,
  });

  // Search only: the same question with the archive in, so the filter counts the archive before
  // it is on. With the archive in, this shares the answer's key and costs nothing.
  const withArchive = useQuery<SearchHit[]>({
    queryKey: ["search", asked, true],
    queryFn: mode !== "search" || asked === "" ? skipToken : () => searchNotes(asked, true),
    placeholderData: asked === "" ? undefined : keepPreviousData,
    retry: false,
  });

  // Backlinks only: the lines naming the note in plain words. rg cannot find titles and aliases,
  // so the backend reads these itself.
  const mentions = useQuery({
    queryKey: ["mentions", backlinksOf, archive],
    queryFn: backlinksOf === undefined ? skipToken : () => fetchMentions(backlinksOf, archive),
    placeholderData: keepPreviousData,
    retry: false,
  });

  // Backlinks keep only real links, since rg also finds the name in prose. Resolving each target
  // keeps `[[borges]]` and `[[reading/borges]]`, but not another folder's note of that name.
  // The todo endpoint matches any checkbox, so the same parse keeps only open todos.
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
  // Derived from the answer, not the query, so each keystroke ranks a set prepared once.
  const candidates = useMemo(() => lineCandidates(found.map((hit) => hit.text)), [found]);
  // Ranked against what is typed now, so the list narrows while the next scan is out. Ranked whole
  // and cut after, so the rows are the best of the answer. Mentions are cut on their own.
  const hits = useMemo(() => {
    const ranked = rankIndexes(candidates, typed);
    // Filter before the cut, so the rows are the best of what is shown.
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
  // Backlinks group under their relation, search under the note. Todos form one unnamed group,
  // so rows keep their rank order and nothing moves on screen.
  const groups = useMemo(() => {
    if (mode === "search") return groupByPath(hits, found);
    return mode === "backlinks" && backlinksOf !== undefined
      ? groupHits(hits, found, backlinksOf, paths ?? [])
      : [{ name: null, rows: hits }];
  }, [mode, backlinksOf, hits, found, paths]);
  // The draw order. The highlight, preview and Enter all index it, so grouping at render alone
  // would point them at another line.
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
