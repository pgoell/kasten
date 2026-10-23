import { type MouseEvent, useState } from "react";
import { type WeekKey, weekNumber } from "@/lib/search-weeks";

interface SearchHistogramProps {
  /** The weeks drawn, oldest first, the current week last. */
  weeks: WeekKey[];
  /** Lines per week, in the same order as `weeks`. */
  counts: number[];
  /** The week the results are narrowed to, if any. */
  week: WeekKey | undefined;
  onPick: (week: WeekKey) => void;
}

/** Tapping does not take the focus from the input: the keys have to keep working after it. */
const keepFocus = (event: MouseEvent) => event.preventDefault();

/** One bar per week, scaled from the busiest, with the week's count on hover. */
export function SearchHistogram({ weeks, counts, week, onPick }: SearchHistogramProps) {
  // The bar under the pointer, which is the only place a count is drawn. Kept as
  // state and not left to CSS, so the count is in the markup a test can read.
  const [hovered, setHovered] = useState<WeekKey>();
  const current = weeks[weeks.length - 1];
  const busiest = Math.max(0, ...counts);

  return (
    <fieldset aria-label="Lines per week" className="flex min-w-0">
      {weeks.map((key, at) => {
        const count = counts[at] ?? 0;
        // An empty week has no height at all, and the busiest is the full bar.
        const height = busiest === 0 ? 0 : (count / busiest) * 100;
        const chosen = key === week;
        const fill = chosen
          ? "bg-k-accent"
          : week !== undefined
            ? "bg-k-ink/10 group-hover:bg-k-ink/35"
            : key === current
              ? "bg-k-accent/50 group-hover:bg-k-ink/35"
              : "bg-k-ink/20 group-hover:bg-k-ink/35";
        const label = `Week ${weekNumber(key)}, ${count} ${count === 1 ? "line" : "lines"}`;
        return (
          <button
            key={key}
            type="button"
            aria-label={label}
            aria-pressed={chosen}
            onMouseDown={keepFocus}
            onClick={() => onPick(key)}
            onMouseEnter={() => setHovered(key)}
            onMouseLeave={() => setHovered(undefined)}
            // Not TAP: its items-center under a finger shrinks the bar area to nothing.
            className="group pointer-coarse:min-h-11 relative flex min-w-0 flex-1 cursor-pointer flex-col"
          >
            {/* The bar's own area, with the baseline under it. The area is the
                height the bars are scaled against, so it has to be fixed. */}
            <span className="relative mx-0.5 block h-16 border-b border-k-rule md:h-24">
              {hovered === key && (
                <span
                  className="pointer-events-none absolute inset-x-0 text-center text-k-12 text-k-ink"
                  style={{ bottom: `calc(${height}% + 2px)` }}
                >
                  {count}
                </span>
              )}
              <span
                aria-hidden="true"
                className={`absolute inset-x-0 bottom-0 rounded-t-sm ${fill}`}
                style={{ height: `${height}%` }}
              />
            </span>
            <span
              className={`pt-1 text-center text-k-12 ${key === current ? "font-bold text-k-accent" : "text-k-muted"}`}
            >
              {/* Below md the fourteen labels would run together, so the W goes. */}
              <span className="max-md:hidden">W</span>
              {String(weekNumber(key)).padStart(2, "0")}
            </span>
            {/* The current week is marked twice, by its label and by a dot, so the
                mark does not rest on colour alone. */}
            {key === current && (
              <span className="mx-auto mt-0.5 h-1 w-1 rounded-full bg-k-accent" />
            )}
          </button>
        );
      })}
    </fieldset>
  );
}
