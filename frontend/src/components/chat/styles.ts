/** The chat pane's buttons. `min-h-11` under a finger is the 44px the phone's toolbar holds to. */

/** The one action a moment asks for: send, answer. */
export const PRIMARY =
  "inline-flex shrink-0 items-center justify-center gap-1 rounded-lg bg-k-accent px-3 py-1.5 font-medium text-[13px] text-k-paper transition-opacity hover:opacity-90 disabled:opacity-35 pointer-coarse:min-h-11 pointer-coarse:px-4 pointer-coarse:text-sm";

/** Everything else: quiet until hovered. */
export const GHOST =
  "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] text-k-muted transition-colors hover:bg-k-surface hover:text-k-ink disabled:opacity-40 pointer-coarse:min-h-11 pointer-coarse:px-3";

/** A skill to start, as a pill. */
export const CHIP =
  "shrink-0 rounded-full border border-k-rule bg-k-paper px-3 py-1 font-mono text-[12px] text-k-ink-soft transition-colors hover:border-k-accent hover:text-k-accent pointer-coarse:min-h-10 pointer-coarse:px-4";
