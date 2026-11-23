/** The todo view's line icons, 16 by 16 and drawn in the current colour. */

const PATHS = {
  flag: "M3.5 14V2.5M3.5 3h8l-1.8 2.75L11.5 8.5h-8",
  tag: "M6 2.5 3.5 13.5M12.5 2.5 10 13.5M2.5 6h11.5M2 10h11.5",
  repeat: "M3 7V6a2 2 0 0 1 2-2h7M10 2l2 2-2 2M13 9v1a2 2 0 0 1-2 2H4M6 14l-2-2 2-2",
  sun: "M8 5.2a2.8 2.8 0 1 0 0 5.6a2.8 2.8 0 1 0 0-5.6M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1",
  board:
    "M3.5 2.5h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1M7.5 2.5h1a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1M11.5 2.5h1a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1",
  plus: "M8 3v10M3 8h10",
  more: "M3.5 8h.01M8 8h.01M12.5 8h.01",
  clock: "M8 2.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 1 0 0-11M8 5v3l2 1.5",
  hour: "M4.5 2.5h7M4.5 13.5h7M5 2.5c0 3 3 3.5 3 5.5s-3 2.5-3 5.5M11 2.5c0 3-3 3.5-3 5.5s3 2.5 3 5.5",
  down: "m4.5 6.5 3.5 3.5 3.5-3.5",
  check: "m3.5 8.5 3 3 6-7",
  parts: "M6.5 4.5h7M6.5 8h7M6.5 11.5h7M3 4.5h.01M3 8h.01M3 11.5h.01",
  x: "m4 4 8 8M12 4l-8 8",
  filter: "M2.5 4h11M4.5 8h7M6.5 12h3",
  play: "M5 3.5v9l7-4.5z",
  block: "M8 2.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 1 0 0-11M4.2 4.2l7.6 7.6",
  doc: "M4 2.5h5.5L12 5v8.5H4zM9.5 2.5V5H12",
  link: "M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2-2a2.6 2.6 0 0 0-3.7-3.7l-.8.8M9.2 6.8a2.6 2.6 0 0 0-3.7 0l-2 2a2.6 2.6 0 0 0 3.7 3.7l.8-.8",
  open: "M6.5 3.5h-3v9h9v-3M9 3.5h3.5V7M12.5 3.5 7.5 8.5",
  text: "M3 4.5h10M3 8h10M3 11.5h6",
  bars: "M3.5 13v-3M8 13V7M12.5 13V3",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "more" ? 2.4 : 1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

const BAR_HEIGHT: Record<string, number> = { highest: 3, high: 3, medium: 2, low: 1, lowest: 1 };

/** Priority as three bars, as many filled as it is high; a dash for none. */
export function PriorityBars({ priority }: { priority: string | null }) {
  if (priority === null)
    return <span aria-hidden="true" className="block h-px w-3 bg-k-rule-strong" />;
  const filled = BAR_HEIGHT[priority] ?? 0;
  const tone =
    priority === "highest"
      ? "text-k-danger"
      : priority === "high"
        ? "text-k-warn"
        : priority === "medium"
          ? "text-k-info"
          : "text-k-muted";
  return (
    <svg
      role="img"
      aria-label={`priority ${priority}`}
      viewBox="0 0 16 16"
      width="16"
      height="16"
      className={tone}
    >
      {[3.5, 8, 12.5].map((x, at) => (
        <path
          key={x}
          d={`M${x} 13V${13 - 3 - at * 3}`}
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          opacity={at < filled ? 1 : 0.25}
        />
      ))}
    </svg>
  );
}
