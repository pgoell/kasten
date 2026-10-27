import { useEffect, useState } from "react";

/** How long a tapped state button keeps asking before it takes the question back. */
const ARMED_MS = 4000;

/**
 * The question a tapped state button asks: one row at a time, taken back by a
 * tap elsewhere, by a scroll, or by a timeout.
 */
export function useArmed() {
  /**
   * The row whose state button has been tapped once, by its key and its text.
   *
   * The text as well, because the key is a path and a line: a write from
   * elsewhere can put another todo on that line while the question stands, and
   * the second tap would then cycle a todo nobody asked about.
   *
   * A finger slips where a key does not, and a cycle writes to the vault with
   * no way back, so the first tap asks and the second is the one that writes.
   * One row at a time: arming another takes the question off this one.
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
