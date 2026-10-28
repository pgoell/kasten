import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { GraphPanel, type PanelCard } from "@/components/graph-panel";
import { GraphTouchRow } from "@/components/graph-touch-row";
import { isNotePath, PLAIN, TYPE_COLOURS } from "@/lib/graph/graph";
import { fetchGraph } from "@/lib/graph/graph-api";
import { drawGraph, type GraphCanvas } from "@/lib/graph/graph-canvas";
import { type GraphMode, readGraphMode, writeGraphMode } from "@/lib/graph/graph-mode";
import { tagCounts, withoutTags } from "@/lib/graph/graph-tags";
import type { EditorCommands } from "@/lib/key-bindings";
import { heldModifier, leaderAction, leaderPrefix } from "@/lib/leader-keys";
import { noteName } from "@/lib/note-path";
import { INPUT, LABEL } from "@/lib/overlay-styles";
import { useViewport } from "@/lib/use-viewport";
import { beginLeader, paneOpener } from "@/lib/which-key";

interface GraphPaneProps {
  /** The note a local graph is drawn around, absent for the whole vault. */
  around?: string;
  /** What a leader sequence reaches. The same object every other pane is given. */
  commands: EditorCommands;
  /** Whether the archive is in the answer, which the route holds and one key flips. */
  archive?: boolean;
  /** Raised when the pane this sits in has been moved to. See `Editor`. */
  focusSignal?: number;
  /** Called with a note to open, and the line to open it on when there is one. */
  onOpen: (path: string, line?: number) => void;
  /** Called with a link's name when the note it names has not been written. */
  onFollow: (target: string) => void;
}

/**
 * How long typing has to stop before the query is asked.
 *
 * The backend reads the whole vault per answer, which is tens of milliseconds,
 * and a half-typed pattern is usually one it cannot read. Asking per keystroke
 * would draw an error under every letter of `?paper`.
 */
const SETTLE = 250;

/** How far a local graph reaches when it opens: the note and its neighbours. */
const DEPTH = 1;
const MOST_DEPTH = 5;

/** How soon a second tap on the background has to follow the first to fit, as a double tap. */
const DOUBLE_TAP_MS = 300;

/**
 * The notes as a graph, in a pane.
 *
 * A filter line at the top, which is the query language the backend reads, and
 * the canvas under it. A pattern answers in rows as well, drawn as a table under
 * the canvas, each note in it a click away. Around a note it is the local graph,
 * and `+` and `-` reach further out or pull back in.
 */
export function GraphPane({
  around,
  commands,
  archive = false,
  focusSignal,
  onOpen,
  onFollow,
}: GraphPaneProps) {
  const panel = useRef<HTMLElement>(null);
  const filter = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<GraphCanvas | null>(null);
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  const [depth, setDepth] = useState(DEPTH);
  /** The keys of an unfinished leader sequence, starting with the space. */
  const [pending, setPending] = useState("");
  /** The unwritten note a finger tapped, waiting to hear whether it is wanted. */
  const [asked, setAsked] = useState<string | null>(null);
  /** The vault graph's grouping, kept per device. Only the vault graph has one. */
  const [mode, setMode] = useState<GraphMode>(readGraphMode);
  /** The tags a reader hid from the drawing, by their lowercased keys. */
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  /** The note the pointer is over, and the one a finger picked, for the card. */
  const [hovered, setHovered] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  // The canvas reads the pick through this ref, so a second tap sees the first
  // at once, before the render that the state change asks for.
  const pick = useRef<string | null>(null);
  /** The zoom as a whole percent, shown in the touch row. React skips an unchanged one. */
  const [zoom, setZoom] = useState<number | null>(null);
  /** When a finger last tapped the background, for the double tap that fits. */
  const blankTap = useRef(Number.NEGATIVE_INFINITY);
  const vault = around === undefined;

  // The handlers the canvas calls, read through a ref so the canvas is made
  // once and still calls what this render was handed.
  const { coarse } = useViewport();
  const opening = useRef({ onOpen, onFollow, coarse, vault });
  opening.current = { onOpen, onFollow, coarse, vault };

  useEffect(() => {
    const wait = setTimeout(() => setQuery(typed), SETTLE);
    return () => clearTimeout(wait);
  }, [typed]);

  const answer = useQuery({
    queryKey: ["graph", query, around, around === undefined ? undefined : depth, archive],
    queryFn: () =>
      fetchGraph({ query, around, depth: around === undefined ? undefined : depth, archive }),
    // The last drawing stays up while the next is asked, so narrowing a filter
    // moves dots rather than blanking the pane between two answers.
    placeholderData: keepPreviousData,
    retry: false,
  });

  useEffect(() => {
    const element = box.current;
    if (!element) return;

    const made = drawGraph(element, {
      onOpen: (node) => {
        const name = node.path.replace(/\.md$/, "");
        // A finger's hit area is wider than the ring, so a tap meant for the
        // background can land on one, and what it would write has no undo.
        // The tap asks, and a mouse, which has to be on the ring, does not.
        const ask = node.missing && opening.current.coarse;
        setAsked(ask ? name : null);
        if (ask) return;
        // In the vault graph a finger's tap picks a written note into the card,
        // and a second tap on it opens it. A mouse click still opens at once.
        if (opening.current.vault && opening.current.coarse && !node.missing) {
          if (pick.current !== node.path) {
            pick.current = node.path;
            setPicked(node.path);
            return;
          }
        }
        // A note nobody has written is made the way following its link makes
        // it, which is what clicking a link to it in a note would do.
        if (node.missing) opening.current.onFollow(name);
        else opening.current.onOpen(node.path);
      },
      onBlank: () => {
        // A double tap on a note would be its pick and its open, so only the
        // background takes one, and a finger's alone: a mouse has the f key.
        if (opening.current.coarse) {
          const now = performance.now();
          if (now - blankTap.current < DOUBLE_TAP_MS) {
            blankTap.current = Number.NEGATIVE_INFINITY;
            canvas.current?.fit();
          } else blankTap.current = now;
        }
        setAsked(null);
        setHovered(null);
        pick.current = null;
        setPicked(null);
      },
      coarse: () => opening.current.coarse,
      onHover: (hover) => {
        if (opening.current.vault) setHovered(hover?.node.path ?? null);
      },
      // Only the touch row shows it, and a render per zoom frame costs a mouse for nothing.
      onZoom: (scale) => {
        if (opening.current.coarse) setZoom(Math.round(scale * 100));
      },
    });
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
  // Memoised, so the canvas is updated when the answer or the hidden tags move,
  // and not on every render.
  const drawn = useMemo(() => data && withoutTags(data.nodes, data.edges, hidden), [data, hidden]);
  useEffect(() => {
    if (!drawn) return;
    canvas.current?.update(drawn.nodes, drawn.edges, around);
    // A picked note the drawing has lost is not picked any more, so the next
    // tap on it picks it again rather than opening it.
    if (pick.current !== null && !drawn.nodes.some((node) => node.path === pick.current)) {
      pick.current = null;
      setPicked(null);
    }
  }, [drawn, around]);

  // The same canvas changes its grouping, so the notes move to their new spots
  // without a second drawing. Only the vault graph is grouped.
  useEffect(() => {
    if (vault) canvas.current?.cluster(mode);
  }, [mode, vault]);

  function switchMode(next: GraphMode) {
    setMode(next);
    writeGraphMode(next);
  }

  function toggleTag(key: string) {
    setHidden((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // The card reads the drawing, so a note the drawing has lost leaves the card.
  // Its tags are the answer's, hidden ones included, so the card shows what it has.
  const cardPath = vault ? (hovered ?? picked) : null;
  const drawnNow = drawn?.nodes.some((node) => node.path === cardPath) ?? false;
  const cardNode = drawnNow ? data?.nodes.find((node) => node.path === cardPath) : undefined;
  const card: PanelCard | null =
    cardNode && drawn
      ? {
          path: cardNode.path,
          name: cardNode.name,
          missing: cardNode.missing,
          tags: cardNode.tags,
          links: drawn.edges.filter(
            (edge) => edge.source === cardNode.path || edge.target === cardNode.path,
          ).length,
        }
      : null;

  function openCard() {
    if (card === null) return;
    // Same as a tap on the canvas: a note nobody wrote is made, a written one opens.
    const name = card.path.replace(/\.md$/, "");
    if (card.missing) onFollow(name);
    else onOpen(card.path);
  }

  // A freshly focused pane takes the cursor, the way the person pane does.
  useEffect(() => {
    if (focusSignal) panel.current?.focus();
  }, [focusSignal]);

  /** `+` and `-`, named because a tap on the touch row asks for the same two. */
  const deeper = (by: 1 | -1) =>
    setDepth((previous) => Math.min(Math.max(previous + by, 0), MOST_DEPTH));

  function onKeyDown(event: React.KeyboardEvent) {
    // Typing into the filter is not the pane's keys: `q` in it is a letter.
    if (event.target instanceof HTMLInputElement) return;
    const { key } = event;
    // Any focused button in the pane (the panel's, the rows table's, the touch row's,
    // the Create question's) takes its own Space and Enter, so the browser presses
    // it rather than a leader sequence starting.
    const onButton = event.target instanceof HTMLButtonElement;
    if (onButton && (key === " " || key === "Enter")) return;

    if (heldModifier(key)) return;

    if (pending) {
      const sequence = pending + key;
      const wanted = sequence.slice(1);
      const run = leaderAction(wanted, commands);
      setPending(!run && leaderPrefix(wanted) ? sequence : "");

      if (run) {
        event.preventDefault();
        run();
      }
      return;
    }

    if (event.ctrlKey || event.altKey || event.metaKey) return;

    switch (key) {
      case " ":
        if (beginLeader(paneOpener(commands))) {
          event.preventDefault();
          return;
        }
        setPending(key);
        break;
      // What vim spells a narrowing, as it is in the todo pane.
      case "/":
        filter.current?.focus();
        break;
      // Reach one link further out, or pull one link back in. A graph of the
      // whole vault has no centre to reach out from, so the keys do nothing.
      case "+":
      case "=":
        if (around !== undefined) deeper(1);
        break;
      case "-":
        if (around !== undefined) deeper(-1);
        break;
      case "f":
        canvas.current?.fit();
        break;
      case "m":
        if (!vault) return;
        switchMode(mode === "folders" ? "tags" : "folders");
        break;
      case "q":
        commands.closeNote();
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  const error = answer.error instanceof Error ? answer.error.message : null;
  const rows = data?.rows ?? [];
  const columns = data?.columns ?? [];

  return (
    <section
      ref={panel}
      data-graph-pane
      // Focusable but out of the tab order, the way every other pane holds the
      // cursor.
      tabIndex={-1}
      onKeyDown={onKeyDown}
      aria-label="graph"
      className="@container flex h-full flex-col bg-k-bg font-mono outline-none"
    >
      <header className="flex items-center gap-3 border-b border-k-rule px-3 py-1">
        <span className={LABEL}>graph</span>
        {around !== undefined && (
          <span className="shrink-0 text-[13px] text-k-ink" title={around}>
            {noteName(around)} <span className="text-k-muted">depth {depth}</span>
          </span>
        )}
        <input
          ref={filter}
          value={typed}
          onChange={(event) => {
            setTyped(event.target.value);
            // Another query is another drawing, and the ring may not be in it.
            setAsked(null);
          }}
          // Both ways out of the input, and both leave the query applied.
          // Enter asks at once rather than after the pause.
          onKeyDown={(event) => {
            if (event.key !== "Escape" && event.key !== "Enter") return;
            event.preventDefault();
            if (event.key === "Enter") setQuery(typed);
            panel.current?.focus();
          }}
          placeholder="type:Concept  tag:#ai  rel:depends-on  ?a supports [[note]]"
          aria-label="graph query"
          autoComplete="off"
          spellCheck={false}
          className={INPUT}
        />
        {drawn && (
          <span className={LABEL}>
            {drawn.nodes.length} notes, {drawn.edges.length} links
          </span>
        )}
      </header>

      {coarse && (
        <GraphTouchRow
          zoom={zoom}
          onFit={() => canvas.current?.fit()}
          onDeeper={around === undefined ? undefined : deeper}
        />
      )}

      {error !== null && (
        <p role="alert" className="border-b border-k-rule px-3 py-1 text-[12px] text-k-danger">
          {error}
        </p>
      )}

      {asked !== null && (
        <p className="flex items-center gap-3 border-b border-k-rule px-3 text-[12px] text-k-ink">
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

      {/* In the vault graph the panel sits beside the canvas, and under it in a
          pane narrower than 640 px. Around a note there is no panel, one column.
          On a touch screen under 640 px the canvas keeps a fixed height and the column
          scrolls as one, since a canvas that shares the height with the panel is squeezed
          to nothing. A mouse pane of that width keeps the panel capped beside the canvas,
          so the pointer, not the width alone, picks the layout. */}
      <div
        className={`flex min-h-0 flex-1 flex-col ${vault ? "@[640px]:flex-row pointer-coarse:@max-[640px]:overflow-y-auto" : ""}`}
      >
        <div
          className={`flex min-h-0 min-w-0 flex-1 flex-col ${vault ? "pointer-coarse:@max-[640px]:flex-none" : ""}`}
        >
          <div
            ref={box}
            data-testid="graph-canvas"
            // The canvas takes every gesture. force-graph sets this on the canvas
            // itself, but only where the browser reported a touch screen when the
            // pane was made.
            className={`relative min-h-0 flex-1 touch-none ${vault ? "pointer-coarse:@max-[640px]:h-[min(118vw,70dvh)] pointer-coarse:@max-[640px]:flex-none" : ""}`}
          />

          {columns.length > 0 && (
            <div className="max-h-[40%] overflow-auto border-t border-k-rule">
              <table className="w-full text-left text-[12px]">
                <thead className="sticky top-0 bg-k-paper text-k-muted">
                  <tr>
                    {columns.map((column) => (
                      <th key={column} className="px-3 py-1 font-normal">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={columns.map((column) => row[column]).join("\0")}>
                      {columns.map((column) => {
                        const value = row[column] ?? "";
                        return (
                          <td key={column} className="px-3 py-0.5">
                            {isNotePath(value) ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setAsked(null);
                                  onOpen(value);
                                }}
                                title={value}
                                className="text-k-accent hover:underline"
                              >
                                {noteName(value)}
                              </button>
                            ) : (
                              <span className="text-tg-4">{value}</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-3 py-1 text-[11px] text-k-muted">
                {rows.length === 0
                  ? "nothing matches"
                  : `${rows.length} ${rows.length === 1 ? "row" : "rows"}${data?.truncated ? ", more not shown" : ""}`}
              </p>
            </div>
          )}
        </div>

        {vault && (
          <GraphPanel
            notes={drawn?.nodes.length ?? 0}
            links={drawn?.edges.length ?? 0}
            archive={archive}
            mode={mode}
            onMode={switchMode}
            tags={data ? tagCounts(data.nodes) : []}
            hidden={hidden}
            onToggleTag={toggleTag}
            card={card}
            onOpen={openCard}
          />
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-x-3 border-t border-k-rule px-3 py-1 text-[11px] text-k-muted">
        {!vault &&
          [...Object.entries(TYPE_COLOURS), ["Note", PLAIN] as const].map(([type, variable]) => (
            <span key={type} className="flex items-center gap-1">
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: `var(${variable})` }}
              />
              {type}
            </span>
          ))}
        <span className="ml-auto">
          / filter&ensp;{vault ? "m mode " : "+ - depth "}f fit&ensp;q close
        </span>
      </footer>
    </section>
  );
}
