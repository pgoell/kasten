import type { ReactNode } from "react";
import type { PaneKind } from "@/lib/panes/layout/pane-kinds";

export { paneKind, panePath } from "@/lib/panes/layout/pane-kinds";

const LABELS: Record<PaneKind, string> = {
  page: "Note",
  pdf: "PDF",
  book: "Book",
  review: "Review",
  graph: "Graph",
  video: "Video",
  todos: "Todos",
  timers: "Timers",
  log: "Log",
  finance: "Finance",
  overview: "Overview",
  library: "Library",
  chat: "Chat",
  terminal: "Terminal",
};

export function kindLabel(kind: PaneKind): string {
  return LABELS[kind];
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
      <rect x="8" y="14.5" width="8" height="4" rx="0.5" fill="currentColor" stroke="none" />
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
      <circle cx="6" cy="6" r="3" />
      <circle cx="18" cy="7" r="3" />
      <circle cx="12" cy="18" r="3" />
      <path d="M10.2 6.35 13.8 6.65M7.9 9.8 10.1 14.2M16 10.7 14 14.3" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="M10 9.5v5l4.5-2.5z" />
    </>
  ),
  todos: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </>
  ),
  timers: (
    <>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 2.5M10 2h4" />
    </>
  ),
  log: <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />,
  finance: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M15 8.5a3.5 3.5 0 1 0 0 7M7.5 11h5M7.5 13.5h5" />
    </>
  ),
  overview: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  library: <path d="M5 4v16M10 4v16M15 5l4 14.5" />,
  chat: (
    <path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 3.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
  ),
  terminal: (
    <>
      <path d="m5 8 4 4-4 4" />
      <path d="M12 17h7" />
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
