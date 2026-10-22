import { useQuery } from "@tanstack/react-query";
import { fetchGraph } from "@/lib/graph-api";
import type { Outline as OutlineState } from "@/lib/note-head";

/**
 * The note's headings, the current one marked, a click puts the cursor there.
 *
 * Indented by level from the shallowest heading, so a note that starts at
 * `##` does not begin with a gap.
 */
export function Outline({ outline }: { outline?: OutlineState }) {
  if (outline === undefined || outline.headings.length === 0) return null;

  const shallowest = Math.min(...outline.headings.map((heading) => heading.level));

  return (
    <nav aria-label="Outline" className="flex flex-col gap-1">
      <p className="text-[13px] tracking-[var(--k-track-label)] text-k-muted">On this page</p>
      {outline.headings.map((heading, index) => {
        const current = index === outline.current;
        return (
          <button
            key={heading.from}
            type="button"
            aria-current={current ? "location" : undefined}
            onClick={() => outline.jump(index)}
            // The base 8 px keeps the text off the 2 px rule at the shallowest level.
            style={{
              paddingLeft: `calc(var(--k-space-8) + ${12 * (heading.level - shallowest)}px)`,
            }}
            // The 2 px rule is there for every row, so the current one
            // turns on its colour and nothing else moves.
            className={`k-margin-row border-l-2 py-1 pr-2 text-left text-[13px] ${
              current ? "border-k-accent text-k-accent" : "border-transparent text-k-muted"
            }`}
          >
            {heading.text}
          </button>
        );
      })}
    </nav>
  );
}

/**
 * The notes this one links to and the notes that link to it, read from the
 * local graph.
 *
 * A failed read shows the same plain lines as an empty one: the margin is
 * beside the note, and a graph that will not load should not put an error in
 * the reader's way.
 */
export function Links({
  path,
  archive,
  onOpen,
}: {
  path: string;
  archive: boolean;
  onOpen: (path: string, line?: number) => void;
}) {
  const answer = useQuery({
    queryKey: ["graph", "margin", path, archive],
    queryFn: () => fetchGraph({ query: "", around: path, depth: 1, archive }),
    retry: false,
  });

  const graph = answer.data;
  const names = new Map(graph?.nodes.map((node) => [node.path, node.name]));
  const edges = graph?.edges.filter((edge) => edge.source !== edge.target) ?? [];

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

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-1">
        <p className="text-[13px] tracking-[var(--k-track-label)] text-k-muted">Links</p>
        {links.length === 0 && <p className="text-[13px] text-k-muted">No links.</p>}
        {links.map((target) => (
          <button
            key={target}
            type="button"
            onClick={() => onOpen(target)}
            className="k-margin-note truncate text-left text-[15px] text-k-ink"
          >
            {names.get(target) ?? target}
          </button>
        ))}
      </section>
      <section className="flex flex-col gap-1">
        <p className="text-[13px] tracking-[var(--k-track-label)] text-k-muted">Backlinks</p>
        {backlinks.length === 0 && <p className="text-[13px] text-k-muted">No backlinks.</p>}
        {backlinks.map((each) => (
          <button
            key={each.path}
            type="button"
            onClick={() => onOpen(each.path, each.line)}
            className="k-margin-note truncate text-left text-[15px] text-k-ink"
          >
            {names.get(each.path) ?? each.path}
          </button>
        ))}
      </section>
    </div>
  );
}
