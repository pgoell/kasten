import { useCallback, useEffect, useRef, useState } from "react";
import { ReviewDecks } from "@/components/review-decks";
import { ReviewParked } from "@/components/review-parked";
import { ReviewSession } from "@/components/review-session";
import { type EditorCommands, LEADER } from "@/lib/key-bindings";
import type { Deck } from "@/lib/review";
import type { Rating } from "@/lib/srs";

interface ReviewPaneProps {
  /** What a leader sequence reaches. The same object every other pane is given. */
  commands: EditorCommands;
  /** Close the pane, which is `q`. */
  onClose: () => void;
  /** Open a note in a pane, the way `ExamPane` is handed the same job. */
  onOpen: (path: string) => void;
  /** Raised when the pane this sits in has been moved to. See `Editor`. */
  focusSignal?: number;
}

/**
 * Which of the three screens is showing.
 *
 * One nullable deck used to answer this, and a third screen reached with a null
 * deck would silently inherit the overview's keys. Naming the screen is what
 * stops `j` walking the decks behind a list that is not the decks.
 */
type Screen = { at: "decks" } | { at: "sitting"; deck: Deck } | { at: "parked" };

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
 * On the overview `j` and `k` walk the decks, `l` starts the sitting and `p`
 * opens the parked list, where `j` and `k` walk the rows instead. `h` goes back
 * to the decks from either of the other two screens. None of these is needed on
 * the phone, where a thumb taps the row and the `← Decks` button.
 *
 * `q` closes and `Escape` is deliberately not bound, which is the one place
 * this diverges from the other panes. The keys here are an accelerator over
 * buttons that are always there, and a binding that only works on hardware the
 * phone lacks is a binding the phone must never need.
 */
export function ReviewPane({ commands, onClose, onOpen, focusSignal }: ReviewPaneProps) {
  const [screen, setScreen] = useState<Screen>({ at: "decks" });
  const [pending, setPending] = useState("");
  const controls = useRef<{
    reveal: () => void;
    rate: (rating: Rating) => void;
    suspend: () => void;
    capture: () => void;
  } | null>(null);
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

    // A field has the keyboard, so the pane stands down: `1` is a digit in a
    // question and `space` is a space in one, not a rating and not the reveal.
    // The leader above still runs, which is the one thing that has to.
    const target = event.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

    // The overview is showing. The browser moves the focus between buttons on
    // Tab and nothing else, so `j` and `k` do it here, and `l` presses the one
    // focused the way Enter on a focused button already does.
    if (screen.at === "decks" && (key === "j" || key === "k" || key === "l")) {
      walk(panel.current, "button[data-deck]:not(:disabled)", key);
      event.preventDefault();
      return;
    }

    // The same walk over a different selector. `data-parked` and not
    // `data-deck`, so neither screen's keys can reach the other's rows.
    if (screen.at === "parked" && (key === "j" || key === "k")) {
      walk(panel.current, "button[data-parked]", key);
      event.preventDefault();
      return;
    }

    // The focused row's own controls, pressed rather than reimplemented, the
    // way `l` presses the focused deck. `u` reaches the put-back button beside
    // the row, which an unanswered row does not draw.
    if (screen.at === "parked" && (key === "u" || key === "o")) {
      const row = document.activeElement as HTMLButtonElement | null;
      if (row?.dataset.parked !== undefined) {
        if (key === "o") row.click();
        else {
          row.closest("li")?.querySelector<HTMLButtonElement>("button[data-unpark]")?.click();
          // The row goes with the card, taking the focus to the body with it,
          // and every key after this one would reach nothing.
          panel.current?.focus();
        }
      }
      event.preventDefault();
      return;
    }

    if (screen.at === "decks" && key === "p") {
      setScreen({ at: "parked" });
      event.preventDefault();
      return;
    }

    // Back to the decks, which is the `← Decks` button, the way out of one deck
    // into another and the way off the parked list. `q` closes the pane from
    // any screen, so leaving a sitting and leaving the review are two keys.
    if (screen.at !== "decks" && key === "h") {
      setScreen({ at: "decks" });
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
    // Before the reveal as well as after it, because a card you want out of the
    // deck is one you have recognised from its question alone.
    else if (key === "s") controls.current?.suspend();
    else if (key === "n") controls.current?.capture();
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
      {screen.at === "decks" ? (
        <ReviewDecks
          onPick={(deck) => setScreen({ at: "sitting", deck })}
          onParked={() => setScreen({ at: "parked" })}
        />
      ) : screen.at === "parked" ? (
        <ReviewParked onLeave={() => setScreen({ at: "decks" })} onOpen={onOpen} />
      ) : (
        <ReviewSession
          deck={screen.deck}
          onLeave={() => setScreen({ at: "decks" })}
          onControls={onControls}
        />
      )}
    </section>
  );
}

/**
 * Move the focus between the rows a selector names, or press the one focused.
 *
 * Two screens draw a list of buttons and neither is in the tab order, so the
 * walk is the same and only the selector differs. Neither wraps: the first and
 * the last are where the list ends, which is what tells you so without looking.
 */
function walk(panel: HTMLElement | null, selector: string, key: string): void {
  const rows = [...(panel?.querySelectorAll<HTMLButtonElement>(selector) ?? [])];
  const at = rows.indexOf(document.activeElement as HTMLButtonElement);
  if (key === "l") {
    rows[at]?.click();
    // The row it pressed goes with the overview, taking the focus to the body
    // with it, and no key of the sitting would reach the pane after that.
    panel?.focus();
    return;
  }
  const by = key === "j" ? 1 : -1;
  rows[at === -1 ? 0 : Math.min(Math.max(at + by, 0), rows.length - 1)]?.focus();
}
