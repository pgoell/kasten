interface VideoShieldProps {
  /** Whether the player is running, which sets the label and whether the play circle shows. */
  running: boolean;
  /** A press on the shield: play or pause the player, and take the focus back. */
  onPress: () => void;
}

/**
 * The transparent button over the player's frame: a click or tap plays or pauses.
 *
 * A click on the frame itself would take the browser's focus, which the layout
 * never hears about, so the shield covers the frame and a click lands on the
 * pane instead. YouTube's own full-screen button sits under the shield too.
 */
export function VideoShield({ running, onPress }: VideoShieldProps) {
  return (
    <button
      type="button"
      tabIndex={-1}
      data-video-shield
      aria-label={running ? "Pause" : "Play"}
      // The press does not move the focus. The shield is not a control the
      // keyboard reaches, and a focus that moved onto it would take the leader's
      // space with it.
      onPointerDown={(event) => event.preventDefault()}
      onClick={onPress}
      className="group absolute inset-0 cursor-pointer"
    >
      <span
        aria-hidden="true"
        data-paused={running ? "false" : "true"}
        className={`pointer-events-none absolute inset-0 m-auto flex h-16 w-16 items-center justify-center rounded-full bg-k-ink/60 text-k-paper transition-opacity duration-(--k-hover) ease-(--k-ease-out) motion-reduce:transition-none ${
          running ? "opacity-0" : "opacity-100"
        }`}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-7 w-7 translate-x-[2px]">
          <path d="M8 5v14l11-7z" fill="currentColor" />
        </svg>
      </span>
      <span className="pointer-events-none absolute inset-x-0 bottom-2 mx-auto w-max rounded-[var(--k-radius-4)] bg-k-ink/70 px-2 py-1 font-sans text-k-12 text-k-paper opacity-0 transition-opacity duration-(--k-hover) group-hover:opacity-100 group-hover:delay-500 motion-reduce:transition-none pointer-coarse:hidden">
        Click to play or pause, or press k
      </span>
    </button>
  );
}
