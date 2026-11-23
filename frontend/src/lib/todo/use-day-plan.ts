import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { fetchPlan, type PlanBlock } from "@/lib/core/api";
import { readClock } from "@/lib/core/clock";

/** The block that holds `time` (`HH:MM`), if one does, and the first block after it. */
export function blocksAt(
  blocks: PlanBlock[],
  time: string,
): { now: PlanBlock | undefined; next: PlanBlock | undefined } {
  return {
    now: blocks.find((block) => block.starts.slice(0, 5) <= time && time < block.ends.slice(0, 5)),
    next: blocks.find((block) => block.starts.slice(0, 5) > time),
  };
}

export const planKey = (day: string) => ["plan", day];

/** Today's plan at the present minute. A refetch with the same plan redraws nothing, so a tick moves the blocks on. */
export function useDayPlan(): ReturnType<typeof blocksAt> {
  const [at, setAt] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setAt(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const clock = readClock(at);
  const plan = useQuery({
    queryKey: planKey(clock.date),
    queryFn: () => fetchPlan(clock.date),
    refetchInterval: 60_000,
  });
  return blocksAt(plan.data?.blocks ?? [], clock.time);
}
