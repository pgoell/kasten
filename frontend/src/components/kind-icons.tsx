import type { ReactNode } from "react";
import type { Pane } from "@/lib/panes";

export type PaneKind = "page" | "pdf" | "book" | "review" | "graph" | "video";

const LABELS: Record<PaneKind, string> = {
  page: "Note",
  pdf: "PDF",
  book: "Book",
  review: "Review",
  graph: "Graph",
  video: "Video",
};

/** What a pane shows, by the field that says so. Anything else is a page: a note, an image or an empty pane. */
export function paneKind(pane: Pane): PaneKind {
  if (pane.pdf !== undefined) return "pdf";
  if (pane.book !== undefined) return "book";
  if (pane.review === true || pane.exam !== undefined) return "review";
  if (pane.graph !== undefined) return "graph";
  if (pane.video !== undefined) return "video";
  return "page";
}

export function kindLabel(kind: PaneKind): string {
  return LABELS[kind];
}

/** The vault path of what the pane shows, in the order a pane can hold it. A pane holds one of these at most. */
export function panePath(pane: Pane): string | undefined {
  return (
    pane.path ??
    pane.pdf?.path ??
    pane.book ??
    pane.video ??
    pane.image ??
    pane.html ??
    pane.exam ??
    pane.person ??
    pane.history ??
    pane.graph?.around
  );
}

const STROKE = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const SHAPES: Record<PaneKind, ReactNode> = {
  page: (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
    </>
  ),
  pdf: (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
      <path d="M8.5 17.5h7" />
    </>
  ),
  book: (
    <>
      <path d="M12 6.5C10.5 5 8 4.5 4 4.5v13c4 0 6.5.5 8 2 1.5-1.5 4-2 8-2v-13c-4 0-6.5.5-8 2z" />
      <path d="M12 6.5v13" />
    </>
  ),
  review: (
    <>
      <rect x="3" y="7" width="12" height="13" rx="2" />
      <path d="M7 7V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-2" />
    </>
  ),
  graph: (
    <>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="7" r="2.5" />
      <circle cx="12" cy="18" r="2.5" />
      <path d="M8.2 7.2 15.8 7.6M7.4 8.2l3.9 7.8M16.6 9.2l-3.2 6.6" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="M10 9.5v5l4.5-2.5z" />
    </>
  ),
};

/** The kind's shape in a 14 px box, in the colour of the text around it. */
export function KindIcon({
  kind,
  className = "size-3.5 shrink-0",
}: {
  kind: PaneKind;
  className?: string;
}) {
  return (
    <svg {...STROKE} data-kind={kind} aria-hidden="true" className={className}>
      {SHAPES[kind]}
    </svg>
  );
}
