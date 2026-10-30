import { useCallback, useEffect, useRef } from "react";
import { soundsIn } from "@/lib/audio";
import type { Card } from "@/lib/review/srs";

/**
 * Start a sound, letting a refusal go by in silence: a phone refuses an untapped sound, and Replay is there.
 * A file that cannot play never ends, so `skip` moves on as `ended` would. Any other rejection is a fault and goes on up.
 */
function start(player: HTMLAudioElement, skip: () => void): void {
  player.play().catch((error: unknown) => {
    if (!(error instanceof DOMException)) throw error;
    if (error.name === "NotSupportedError") skip();
    else if (error.name !== "NotAllowedError" && error.name !== "AbortError") throw error;
  });
}

/**
 * The sounds of the side of a card on screen, its back once that is turned.
 *
 * A whole note keeps its sounds in the front, its back being empty, so it is
 * the front that plays however the reveal was pressed.
 */
export function soundsShowing(card: Card, revealed: boolean): string[] {
  return soundsIn(revealed && card.back !== "" ? card.back : card.front);
}

/**
 * The sitting's one player, with the card's sides played in order. `play` runs inside the tap or key that turned the card,
 * as a phone refuses a `play()` that does not start synchronously in a gesture.
 */
export function useCardSounds(): {
  play(sources: string[]): void;
  playFirst(card: Card | undefined): void;
} {
  /**
   * One element for the whole sitting, never the preview's.
   * A phone lets an element play untapped once a tap has started it, so the second sound follows the first.
   */
  const player = useRef<HTMLAudioElement | null>(null);
  /** The sounds of the side showing that wait behind the one playing. */
  const waiting = useRef<string[]>([]);
  /** The sound the player is on, or null once a side has run out or stopped. */
  const current = useRef<string | null>(null);
  /** Whether the card the deck read put on screen has been played. */
  const started = useRef(false);

  /**
   * Only from the sound the player is still on. A missing file both rejects `play()` and fires `error`,
   * so the second of those must not skip the sound the first one moved on to.
   */
  const onward = useCallback((from: string | null) => {
    const made = player.current;
    if (made === null || from === null || from !== current.current) return;
    const next = waiting.current.shift() ?? null;
    current.current = next;
    if (next === null) return;
    made.src = next;
    start(made, () => onward(next));
  }, []);

  /**
   * Play a side's sounds in order, stopping what was playing. An empty list is the stop.
   * Called from the tap or key that turned the card, since a phone refuses a `play()` not started in a gesture.
   */
  const play = useCallback(
    (sources: string[]) => {
      // Cleared before the pause, so a sound ending under it plays nothing next.
      waiting.current = sources.slice(1);
      const first = sources[0] ?? null;
      current.current = first;
      player.current?.pause();
      if (first === null) return;
      if (player.current === null) {
        const made = document.createElement("audio");
        made.addEventListener("ended", () => onward(current.current));
        made.addEventListener("error", () => onward(current.current));
        player.current = made;
      }
      player.current.src = first;
      start(player.current, () => onward(first));
    },
    [onward],
  );

  // The first card is the one no tap shows: it lands when the deck read does.
  // A phone refuses it, silently, and Replay is the tap that plays it there.
  // Every card after it is played by the tap that rated or parked the last.
  const playFirst = useCallback(
    (card: Card | undefined) => {
      if (card === undefined || started.current) return;
      started.current = true;
      play(soundsShowing(card, false));
    },
    [play],
  );

  // Off with the sitting, so a sound never runs on over the deck list.
  useEffect(() => () => player.current?.pause(), []);

  return { play, playFirst };
}
