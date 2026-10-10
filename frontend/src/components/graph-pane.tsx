import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { fetchGraph } from "@/lib/api";
import { isNotePath, PLAIN, TYPE_COLOURS } from "@/lib/graph";
import { drawGraph, type GraphCanvas } from "@/lib/graph-canvas";
import { type EditorCommands, heldModifier, leaderAction, leaderPrefix } from "@/lib/key-bindings";
import { noteName } from "@/lib/note-path";
import { INPUT, LABEL } from "@/lib/overlay-styles";
import { useViewport } from "@/lib/use-viewport";

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

  // The handlers the canvas calls, read through a ref so the canvas is made
  // once and still calls what this render was handed.
  const { coarse } = useViewport();
  const opening = useRef({ onOpen, onFollow, coarse });
  opening.current = { onOpen, onFollow, coarse };

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
        // A note nobody has written is made the way following its link makes
        // it, which is what clicking a link to it in a note would do.
        if (node.missing) opening.current.onFollow(node.path.replace(/\.md$/, ""));
        else opening.current.onOpen(node.path);
      },
      coarse: () => opening.current.coarse,
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
  useEffect(() => {
    if (data) canvas.current?.update(data.nodes, data.edges, around);
  }, [data, around]);

  // A freshly focused pane takes the cursor, the way the person pane does.
  useEffect(() => {
    if (focusSignal) panel.current?.focus();
  }, [focusSignal]);

  function onKeyDown(event: React.KeyboardEvent) {
    // Typing into the filter is not the pane's keys: `q` in it is a letter.
    if (event.target instanceof HTMLInputElement) return;
    const { key } = event;

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
        if (around !== undefined) setDepth((previous) => Math.min(previous + 1, MOST_DEPTH));
        break;
      case "-":
        if (around !== undefined) setDepth((previous) => Math.max(previous - 1, 0));
        break;
      case "f":
        canvas.current?.fit();
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
      className="flex h-full flex-col bg-one-bg font-mono outline-none"
    >
      <header className="flex items-center gap-3 border-b border-one-line px-3 py-1">
        <span className={LABEL}>graph</span>
        {around !== undefined && (
          <span className="shrink-0 text-[13px] text-one-fg" title={around}>
            {noteName(around)} <span className="text-one-muted">depth {depth}</span>
          </span>
        )}
        <input
          ref={filter}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
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
        {data && (
          <span className={LABEL}>
            {data.nodes.length} notes, {data.edges.length} links
          </span>
        )}
      </header>

      {error !== null && (
        <p role="alert" className="border-b border-one-line px-3 py-1 text-[12px] text-one-warn">
          {error}
        </p>
      )}

      <div
        ref={box}
        data-testid="graph-canvas"
        // The canvas takes every gesture. force-graph sets this on the canvas
        // itself, but only where the browser reported a touch screen when the
        // pane was made.
        className="relative min-h-0 flex-1 touch-none"
      />

      {columns.length > 0 && (
        <div className="max-h-[40%] overflow-auto border-t border-one-line">
          <table className="w-full text-left text-[12px]">
            <thead className="sticky top-0 bg-one-panel text-one-muted">
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
                            onClick={() => onOpen(value)}
                            title={value}
                            className="text-one-accent hover:underline"
                          >
                            {noteName(value)}
                          </button>
                        ) : (
                          <span className="text-one-purple">{value}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-3 py-1 text-[11px] text-one-muted">
            {rows.length === 0
              ? "nothing matches"
              : `${rows.length} ${rows.length === 1 ? "row" : "rows"}${data?.truncated ? ", more not shown" : ""}`}
          </p>
        </div>
      )}

      <footer className="flex flex-wrap items-center gap-x-3 border-t border-one-line px-3 py-1 text-[11px] text-one-muted">
        {[...Object.entries(TYPE_COLOURS), ["Note", PLAIN] as const].map(([type, variable]) => (
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
          / filter&ensp;{around !== undefined && "+ - depth "}f fit&ensp;q close
        </span>
      </footer>
    </section>
  );
}
