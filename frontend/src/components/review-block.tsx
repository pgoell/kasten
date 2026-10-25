import { QueryClientProvider } from "@tanstack/react-query";
import { createRoot, type Root } from "react-dom/client";
import { WeekReview } from "@/components/week-review";
import { YearReview } from "@/components/year-review";
import { weeklyWeek, yearlyYear } from "@/lib/periodic";
import type { ReviewSource } from "@/lib/periodic-review";

/** Which review a note's path asks for, or nothing for a path neither names. */
function ReviewFor({ path, open }: { path: string; open: ReviewSource["open"] }) {
  const year = yearlyYear(path);
  if (year !== null) return <YearReview year={year} />;
  const week = weeklyWeek(path);
  if (week !== null) return <WeekReview week={week} open={open} />;
  return null;
}

/**
 * Mounts one review into the element the editor drew for it. The provider is the app's
 * own, so the review's reads are the same queries the panes read and a write elsewhere
 * reaches them.
 */
export function mountReview(host: HTMLElement, path: string, source: ReviewSource): Root {
  const root = createRoot(host);
  root.render(
    <QueryClientProvider client={source.client}>
      <ReviewFor path={path} open={source.open} />
    </QueryClientProvider>,
  );
  return root;
}
