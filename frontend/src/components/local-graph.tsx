import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { INSET, LABEL } from "@/components/note-margins";
import { fetchMentions, fetchSimilar, type SimilarAnswer } from "@/lib/api";
import type { DrawnNode } from "@/lib/graph/graph";
import { fetchGraph } from "@/lib/graph/graph-api";
import { drawGraph, type GraphCanvas } from "@/lib/graph/graph-canvas";
import { noteName } from "@/lib/note-path";
import { useViewport } from "@/lib/use-viewport";

interface LocalGraphProps {
  /** The note in the middle of the drawing, and the one the lists are about. */
  path: string;
  archive: boolean;
  /** A node, a link, a backlink or a mention row: opens its note, at a line when it names one. */
  onOpen: (path: string, line?: number) => void;
  /** An unwritten node, by its name without `.md`, which following its link makes. */
  onFollow: (target: string) => void;
}

/**
 * How far the graph reaches: the note's own links, or the links of those too.
 * The lists below stay the note's own links and backlinks at either depth.
 */
const DEPTHS = [
  { depth: 1, label: "Direct" },
  { depth: 2, label: "Two steps" },
] as const;

/**
 * A list's row: a full-width button that takes the row press, a tint instead of the
 * button's scale (`k-row`), and a 44 px target under a finger.
 */
const ROW = `k-margin-note k-row flex items-center ${INSET} rounded-[var(--k-radius-4)] pointer-coarse:min-h-11 text-left text-k-15 text-k-ink`;

/** The line the notes-like-this-one list shows in place of rows, once its answer is in. */
function alikeEmptyLine(answer: SimilarAnswer | undefined, failed: boolean): string | null {
  if (failed) return "No notes like this one.";
  if (!answer) return null;
  if (!answer.read) return "Not in the index yet.";
  if (answer.hits.length > 0) return null;
  return answer.indexed < answer.notes ? "No notes like this one yet." : "No notes like this one.";
}

/**
 * The note's local graph and its four lists. A failed read shows the same plain
 * lines as an empty one: the margin sits beside the note.
 */
export function LocalGraph({ path, archive, onOpen, onFollow }: LocalGraphProps) {
  const [depth, setDepth] = useState<1 | 2>(1);
  /** The unwritten note a finger tapped, waiting to hear whether it is wanted. */
  const [asked, setAsked] = useState<string | null>(null);
  /** The node under the pointer, and where it is in the canvas box. */
  const [tip, setTip] = useState<{ name: string; x: number; y: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<GraphCanvas | null>(null);

  // Read through a ref so the canvas, made once, calls what this render was given.
  const { coarse } = useViewport();
  const opening = useRef({ onOpen, onFollow, coarse });
  opening.current = { onOpen, onFollow, coarse };

  const answer = useQuery({
    queryKey: ["graph", "margin", path, depth, archive],
    queryFn: () => fetchGraph({ query: "", around: path, depth, archive }),
    // The last drawing stays up while the next depth of the same note is asked, so
    // the switch moves dots rather than blanking the margin. Another note's answer
    // is never kept: it would be drawn around this note and counted in its lists.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === path ? previous : undefined,
    retry: false,
  });

  // The key is the one `use-search-hits.ts` uses, so a save that refreshes that
  // search refreshes this list too.
  const mentions = useQuery({
    queryKey: ["mentions", path, archive],
    queryFn: () => fetchMentions(path, archive),
    retry: false,
  });

  useEffect(() => {
    const element = box.current;
    if (!element) return;

    const made = drawGraph(
      element,
      {
        onOpen: (node: DrawnNode) => {
          const name = node.path.replace(/\.md$/, "");
          // A finger's hit area is wider than the ring, so a tap meant for the
          // background can land on one, and what it would write has no undo.
          // The tap asks, and a mouse, which has to be on the ring, does not.
          const ask = node.missing && opening.current.coarse;
          setAsked(ask ? name : null);
          if (ask) return;
          if (node.missing) opening.current.onFollow(name);
          else opening.current.onOpen(node.path);
        },
        onBlank: () => setAsked(null),
        coarse: () => opening.current.coarse,
        onHover: (hovered) =>
          setTip(hovered === null ? null : { name: hovered.node.name, x: hovered.x, y: hovered.y }),
      },
      { radial: true },
    );
    canvas.current = made;

    const watch = new ResizeObserver(([entry]) => {
      if (entry) made.resize(entry.contentRect.width, entry.contentRect.height);
    });
    watch.observe(element);

    return () => {
      watch.disconnect();
      made.destroy();
      canvas.current = null;
    };
  }, []);

  const data = answer.data;
  // The same canvas redraws around the note it is given, so moving to another note
  // moves the drawing rather than making a second one.
  useEffect(() => {
    if (data) canvas.current?.update(data.nodes, data.edges, path);
  }, [data, path]);

  const names = new Map(data?.nodes.map((node) => [node.path, node.name]));
  const edges = data?.edges.filter((edge) => edge.source !== edge.target) ?? [];

  // One row per note, however many times the two write their link. The
  // backlink keeps the line it is written on in the note that links here.
  const links = [
    ...new Map(
      edges.filter((edge) => edge.source === path).map((edge) => [edge.target, edge.target]),
    ).values(),
  ];
  const backlinks = [
    ...new Map(
      edges
        .filter((edge) => edge.target === path)
        .map((edge) => [edge.source, { path: edge.source, line: edge.line }]),
    ).values(),
  ];
  const mentioned = mentions.data ?? [];
  const graphReady = !answer.isPending;
  const mentionsReady = !mentions.isPending;

  const similar = useQuery({
    queryKey: ["similar", path, archive],
    queryFn: () => fetchSimilar(path, archive),
    retry: false,
  });
  const alike = similar.data?.hits ?? [];
  const similarReady = !similar.isPending;
  const alikeEmpty = similarReady ? alikeEmptyLine(similar.data, similar.isError) : null;

  return (
    <div className="flex flex-col gap-4">
      <fieldset
        aria-label="Depth"
        // A margin, not the rows' padding: padding would sit inside the border.
        className={`ml-[calc(var(--k-space-8)+2px)] flex self-start overflow-hidden rounded-[var(--k-radius-6)] border border-k-rule text-k-13`}
      >
        {DEPTHS.map(({ depth: value, label }) => (
          <button
            key={value}
            type="button"
            aria-pressed={depth === value}
            onClick={() => setDepth(value)}
            className={`k-depth px-3 py-1 pointer-coarse:min-h-11 ${depth === value ? "bg-k-surface text-k-ink" : "text-k-muted"}`}
          >
            {label}
          </button>
        ))}
      </fieldset>

      <div
        ref={box}
        data-testid="local-graph-canvas"
        // force-graph sizes its own canvas past the box's square, so the box clips
        // it. Its radial layout has no pan, zoom or drag, so a finger scrolls the
        // sheet over it and only the vertical pan is given to the browser.
        className="relative aspect-square max-h-80 w-full min-h-0 touch-pan-y overflow-hidden"
      >
        {tip !== null && (
          <span
            role="tooltip"
            style={{ left: tip.x, top: tip.y + 10 }}
            className="pointer-events-none absolute -translate-x-1/2 max-w-[240px] truncate rounded-[var(--k-radius-6)] border border-k-rule bg-k-paper px-1.5 text-k-13 text-k-ink"
          >
            {tip.name}
          </span>
        )}
      </div>

      {asked !== null && (
        <p className={`${INSET} flex items-center gap-3 text-k-13 text-k-ink`}>
          <span className="min-w-0 flex-1 truncate">Create {asked}?</span>
          <button
            type="button"
            onClick={() => {
              setAsked(null);
              onFollow(asked);
            }}
            className="min-h-11 shrink-0 px-2 text-k-accent"
          >
            Create
          </button>
          <button
            type="button"
            onClick={() => setAsked(null)}
            className="min-h-11 shrink-0 px-2 text-k-muted"
          >
            Cancel
          </button>
        </p>
      )}

      {/* A count and an empty line are drawn only once the answer is in: until then
          the list is nothing, not a zero that the answer then corrects. A failed read
          is in, so its plain lines show. */}
      <section className="flex flex-col gap-1">
        <p className={LABEL}>
          Links{graphReady && <span className="tabular-nums"> {links.length}</span>}
        </p>
        {graphReady && links.length === 0 && (
          <p className={`${INSET} text-k-13 text-k-muted`}>No links.</p>
        )}
        {links.map((target) => (
          <button key={target} type="button" onClick={() => onOpen(target)} className={ROW}>
            <span className="min-w-0 truncate">{names.get(target) ?? target}</span>
          </button>
        ))}
      </section>

      <section className="flex flex-col gap-1">
        <p className={LABEL}>
          Backlinks{graphReady && <span className="tabular-nums"> {backlinks.length}</span>}
        </p>
        {graphReady && backlinks.length === 0 && (
          <p className={`${INSET} text-k-13 text-k-muted`}>No backlinks.</p>
        )}
        {backlinks.map((each) => (
          <button
            key={each.path}
            type="button"
            onClick={() => onOpen(each.path, each.line)}
            className={ROW}
          >
            <span className="min-w-0 truncate">{names.get(each.path) ?? each.path}</span>
          </button>
        ))}
      </section>

      <section className="flex flex-col gap-1">
        <p className={LABEL}>
          Unlinked mentions
          {mentionsReady && <span className="tabular-nums"> {mentioned.length}</span>}
        </p>
        {mentionsReady && mentioned.length === 0 && (
          <p className={`${INSET} text-k-13 text-k-muted`}>No unlinked mentions.</p>
        )}
        {mentioned.map((mention) => (
          <button
            key={`${mention.path}:${mention.line}`}
            type="button"
            onClick={() => onOpen(mention.path, mention.line)}
            className={ROW}
          >
            <span className="min-w-0 truncate">{noteName(mention.path)}</span>
          </button>
        ))}
      </section>

      <section className="flex flex-col gap-1">
        <p className={LABEL}>
          Notes like this one
          {similarReady && <span className="tabular-nums"> {alike.length}</span>}
        </p>
        {alikeEmpty !== null && <p className={`${INSET} text-k-13 text-k-muted`}>{alikeEmpty}</p>}
        {alike.map((hit) => (
          <button key={hit.path} type="button" onClick={() => onOpen(hit.path)} className={ROW}>
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{noteName(hit.path)}</span>
              {hit.heading && (
                <span className="truncate text-k-13 text-k-muted">{hit.heading}</span>
              )}
            </span>
          </button>
        ))}
        {similar.data && similar.data.indexed < similar.data.notes && (
          <p className={`${INSET} text-k-13 text-k-muted`}>
            Index filling: {similar.data.indexed} of {similar.data.notes} notes.
          </p>
        )}
      </section>
    </div>
  );
}
