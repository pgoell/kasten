/** The week review's training section: the week's sessions, sets, cardio and records. */

import { useQuery } from "@tanstack/react-query";
import { Failed, Reading, Section, Words } from "@/components/review/review-parts";
import { shiftDay } from "@/lib/core/clock";
import { grouped } from "@/lib/log/log-words";
import { fetchTraining } from "@/lib/log/training/exercises";
import { recordWords, weekTally } from "@/lib/log/training/progress";
import { plural } from "@/lib/overview/overview-words";

export function WeekTraining({ monday, sunday }: { monday: string; sunday: string }) {
  // A year back, so a record is set against the days before the week.
  const from = shiftDay(monday, -364);
  const training = useQuery({
    queryKey: ["log", "training", from, sunday],
    queryFn: () => fetchTraining(from, sunday),
  });
  if (training.error && training.data === undefined) {
    const message = training.error instanceof Error ? training.error.message : "";
    return (
      <Section heading="Training">
        <Failed message={`The training could not be read. ${message}`} />
      </Section>
    );
  }
  if (training.data === undefined) {
    return (
      <Section heading="Training">
        <Reading />
      </Section>
    );
  }
  const week = weekTally(training.data, monday);
  return (
    <Section heading="Training">
      {week.sessions === 0 ? (
        <Words>No training this week.</Words>
      ) : (
        <Words>
          {`${plural(week.sessions, "session")}, ${plural(week.sets, "set")}, ${grouped(week.minutes)} min cardio`}
        </Words>
      )}
      {week.records.length === 0 ? null : (
        <Words>{`Records: ${week.records.map((r) => recordWords(r, grouped)).join(", ")}`}</Words>
      )}
    </Section>
  );
}
