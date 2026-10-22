import { useEffect, useState } from "react";
import { type Clock as ClockReading, readClock } from "@/lib/clock";

const MINUTE_MS = 60_000;

/**
 * The date and time at the foot of the window.
 *
 * The tick is lined up with the wall clock rather than set going a minute at a
 * time from mount, so the minute changes on screen when it changes on the
 * clock instead of up to a minute later. One re-render a minute, not sixty.
 */
export function Clock({ crowded }: { crowded: boolean }) {
  const [now, setNow] = useState<ClockReading>(() => readClock(new Date()));

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    function tick() {
      timer = setTimeout(
        () => {
          setNow(readClock(new Date()));
          tick();
        },
        MINUTE_MS - (Date.now() % MINUTE_MS),
      );
    }

    tick();
    return () => clearTimeout(timer);
  }, []);

  return (
    // Spaced apart rather than punctuated: the gap separates the four readings
    // without spending characters on a bar the eye has to step over.
    <div
      // Gone below `md` while there is a notice: a phone's bar holds one
      // sentence or the time, and the sentence is the one that will not keep.
      className={`flex items-center gap-3 text-[11px] whitespace-nowrap text-k-muted tabular-nums ${
        crowded ? "max-md:hidden" : ""
      }`}
    >
      {/* The weekday and the week go below `md`: a phone has room for the date
          and the time, and its own lock screen says the rest. */}
      <span className="max-md:hidden">{now.weekday}</span>
      <time dateTime={now.date}>{now.date}</time>
      <span className="max-md:hidden">CW {now.week}</span>
      <time dateTime={`${now.date}T${now.time}`}>{now.time}</time>
    </div>
  );
}
