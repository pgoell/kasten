import { useEffect, useState } from "react";

/** How long a tapped state button keeps asking before it takes the question back. */
const ARMED_MS = 4000;

/**
 * The question a tapped state button asks: one row at a time, taken back by a
 * tap elsewhere, by a scroll, or by a timeout.
 */
export function useArmed() {
  /**
   * The row whose state button was tapped once, by its key and its text. The text catches a write that moved
   * another todo onto that line. A cycle writes with no way back, so the first tap asks and the second writes.
   */
  const [armed, setArmed] = useState<string | null>(null);

  // A question nobody answers is taken back, or a tap minutes later would land
  // as the second of a pair. The cleanup covers a pane that has closed.
  useEffect(() => {
    if (armed === null) return;
    const timer = setTimeout(() => setArmed(null), ARMED_MS);
    return () => clearTimeout(timer);
  }, [armed]);

  return {
    armed,
    arm(key: string | null) {
      setArmed(key);
    },
    // A tap anywhere but on the armed button itself takes the question back,
    // before the tap does whatever it was for.
    disarmElsewhere(event: React.PointerEvent) {
      if (armed !== null && !(event.target as Element).closest("[data-armed]")) setArmed(null);
    },
  };
}
