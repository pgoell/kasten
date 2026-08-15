import { useCallback, useEffect, useRef, useState } from "react";
import { ReviewDecks } from "@/components/review-decks";
import { ReviewSession } from "@/components/review-session";
import { type EditorCommands, LEADER } from "@/lib/key-bindings";
import type { Deck } from "@/lib/review";
import type { Rating } from "@/lib/srs";

interface ReviewPaneProps {
  /** What a leader sequence reaches. The same object every other pane is given. */
  commands: EditorCommands;
  /** Close the pane, which is `q`. */
  onClose: () => void;
  /** Raised when the pane this sits in has been moved to. See `Editor`. */
  focusSignal?: number;
}

/** `1` to `4`, in the order the buttons are drawn. */
const KEYED: Record<string, Rating> = { "1": "again", "2": "hard", "3": "good", "4": "easy" };

/**
 * The review at a desk, with the keys a keyboard expects.
 *
 * Every rule about cards, scheduling and writing lives in `ReviewSession`, and
 * this adds keys over the callbacks that component already exposes. That is the
 * whole of the pane: the phone route renders the same two components with no
 * keys at all, so a rule cannot be true at a desk and false on a phone.
 *
 * On the overview `j` and `k` walk the decks and `l` starts the sitting, which
 * is the one thing here the phone has no need of: a thumb taps the row.
 *
 * `q` closes and `Escape` is deliberately not bound, which is the one place
 * this diverges from the other panes. The keys here are an accelerator over
 * buttons that are always there, and a binding that only works on hardware the
 * phone lacks is a binding the phone must never need.
 */
export function ReviewPane({ commands, onClose, focusSignal }: ReviewPaneProps) {
  const [deck, setDeck] = useState<Deck | null>(null);
  const [pending, setPending] = useState("");
  const controls = useRef<{ reveal: () => void; rate: (rating: Rating) => void } | null>(null);
  const panel = useRef<HTMLElement>(null);

  const onControls = useCallback((given: typeof controls.current) => {
    controls.current = given;
  }, []);

  // A freshly split pane is created focused and its first render is the only
  // chance it gets to say so. An unfocused pane is handed 0 and stays put.
  useEffect(() => {
    if (focusSignal) panel.current?.focus();
  }, [focusSignal]);

  function onKeyDown(event: React.KeyboardEvent) {
    const { key } = event;

    // The leader still works inside the pane, the way it does inside the exam,
    // so the other panes stay reachable mid-session.
    if (pending) {
      const sequence = pending + key;
      const wanted = sequence.slice(1);
      const binding = LEADER.find((entry) => entry.key === wanted);
      const partial = !binding && LEADER.some((entry) => entry.key.startsWith(wanted));
      setPending(partial ? sequence : "");

      if (binding) {
        event.preventDefault();
        commands[binding.command]();
      }
      return;
    }

    if (event.ctrlKey || event.altKey || event.metaKey) return;

    // The overview is showing: the session is what registers controls, and it
    // has not. The browser moves the focus between buttons on Tab and nothing
    // else, so `j` and `k` do it here, and `l` presses the one focused the way
    // Enter on a focused button already does.
    if (controls.current === null && (key === "j" || key === "k" || key === "l")) {
      const decks = [
        ...(panel.current?.querySelectorAll<HTMLButtonElement>(
          "button[data-deck]:not(:disabled)",
        ) ?? []),
      ];
      const at = decks.indexOf(document.activeElement as HTMLButtonElement);
      if (key === "l") decks[at]?.click();
      else {
        const by = key === "j" ? 1 : -1;
        decks[at === -1 ? 0 : Math.min(Math.max(at + by, 0), decks.length - 1)]?.focus();
      }
      event.preventDefault();
      return;
    }

    if (key === " " && controls.current === null) {
      setPending(key);
      event.preventDefault();
      return;
    }

    const rating = KEYED[key];
    if (rating !== undefined) controls.current?.rate(rating);
    else if (key === " " || key === "Enter") controls.current?.reveal();
    else if (key === "q") onClose();
    else return;

    event.preventDefault();
  }

  return (
    <section
      ref={panel}
      data-review-pane
      // Focusable but out of the tab order, the way the todo pane and the exam
      // pane take the cursor.
      tabIndex={-1}
      onKeyDown={onKeyDown}
      aria-label="review"
      className="h-full outline-none"
    >
      {deck === null ? (
        <ReviewDecks onPick={setDeck} />
      ) : (
        <ReviewSession deck={deck} onLeave={() => setDeck(null)} onControls={onControls} />
      )}
    </section>
  );
}
