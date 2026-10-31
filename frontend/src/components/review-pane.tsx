import { useCallback, useEffect, useRef, useState } from "react";
import { ReviewDecks } from "@/components/review-decks";
import { ReviewParked } from "@/components/review-parked";
import { ReviewSession } from "@/components/review-session";
import type { EditorCommands } from "@/lib/key-bindings";
import { heldModifier, leaderAction, leaderPrefix } from "@/lib/leader-keys";
import type { Deck } from "@/lib/review/review";
import type { Rating } from "@/lib/review/srs";
import { beginLeader, paneOpener } from "@/lib/which-key";

interface ReviewPaneProps {
  /** What a leader sequence reaches. The same object every other pane is given. */
  commands: EditorCommands;
  /** Close the pane, which is `q`. */
  onClose: () => void;
  /** Open a note in a pane, at a line when the card has one. The way `ExamPane` is handed the same job. */
  onOpen: (path: string, line?: number) => void;
  /** Raised when the pane this sits in has been moved to. See `Editor`. */
  focusSignal?: number;
}

/**
 * Which of the three screens is showing. Naming it stops `j` walking the decks behind a list that is not the decks.
 */
type Screen = { at: "decks" } | { at: "sitting"; deck: Deck } | { at: "parked" };

/** `1` to `4`, in the order the buttons are drawn. */
const KEYED: Record<string, Rating> = { "1": "again", "2": "hard", "3": "good", "4": "easy" };

/**
 * The review at a desk, with the keys a keyboard expects. Every rule lives in `ReviewSession`;
 * this only adds keys over its callbacks, so a rule cannot be true at a desk and false on a phone.
 * `q` closes, and `Escape` is deliberately not bound: the keys are an accelerator over buttons that are always there.
 */
export function ReviewPane({ commands, onClose, onOpen, focusSignal }: ReviewPaneProps) {
  const [screen, setScreen] = useState<Screen>({ at: "decks" });
  const [pending, setPending] = useState("");
  const controls = useRef<{
    showing: boolean;
    shown: boolean;
    revealed: boolean;
    reveal: () => void;
    rate: (rating: Rating) => void;
    suspend: () => void;
    capture: () => void;
    replay: () => void;
    undo: () => void;
  } | null>(null);
  const panel = useRef<HTMLElement>(null);
  // A ref, not the leader's `pending`: `za` handed to `leaderAction` would run whatever `<leader>a` is.
  const zee = useRef(false);

  const onControls = useCallback((given: typeof controls.current) => {
    controls.current = given;
  }, []);

  // A new pane is created focused, and its first render is the only chance to say so.
  useEffect(() => {
    if (focusSignal) panel.current?.focus();
  }, [focusSignal]);

  // A clicked row takes the focus to the body, and no key reaches the pane until a second click.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on each new screen
  useEffect(() => {
    if (document.activeElement === document.body) panel.current?.focus();
  }, [screen]);

  function onKeyDown(event: React.KeyboardEvent) {
    const { key } = event;

    // A held modifier would drop a pending sequence, so it is ignored.
    if (heldModifier(key)) return;

    // The leader still works inside the pane, so the other panes stay reachable.
    if (pending) {
      leaderKey(event);
      return;
    }

    if (standsDown(event)) return;

    // A held key repeats, and a repeat must not answer the card again.
    if (event.repeat && (key === " " || key === "Enter" || KEYED[key] !== undefined)) {
      event.preventDefault();
      return;
    }

    if (screenKey(key) || sittingKey(key)) event.preventDefault();
  }

  function leaderKey(event: React.KeyboardEvent) {
    const sequence = pending + event.key;
    const wanted = sequence.slice(1);
    const run = leaderAction(wanted, commands);
    // A leader key can be more than one letter, so a prefix waits for the rest.
    setPending(!run && leaderPrefix(wanted) ? sequence : "");

    if (run) {
      event.preventDefault();
      run();
    }
  }

  /** The keys of the screen showing, true where one ran. */
  function screenKey(key: string): boolean {
    // `za` folds, the way vim does. Any other key after a `z` runs as itself.
    const folding = zee.current;
    zee.current = false;
    if (screen.at === "decks") return deckKey(key, folding);
    if (screen.at === "parked" && parkedKey(key)) return true;
    // `←Decks` is the way out of one deck into another and off the parked list. `q` closes the pane.
    if (key !== "h") return false;
    setScreen({ at: "decks" });
    return true;
  }

  function deckKey(key: string, folding: boolean): boolean {
    if (folding && key === "a") {
      fold(panel.current);
      return true;
    }
    if (key === "z") {
      zee.current = true;
      return true;
    }
    // On the overview `j` and `k` move the focus, since the browser moves it on Tab only.
    // Enter on a focused row presses it. Left to the Enter below, the browser's click is cancelled.
    const pressed = key === "Enter" && focusedRow()?.dataset.deck !== undefined;
    if (key === "j" || key === "k" || key === "l" || pressed) {
      walk(panel.current, deckStops(panel.current), pressed ? "l" : key);
      return true;
    }
    if (key !== "p") return false;
    setScreen({ at: "parked" });
    return true;
  }

  function parkedKey(key: string): boolean {
    const row = focusedRow();
    // `data-parked`, not `data-deck`, so neither screen's keys reach the other's rows.
    if (key === "j" || key === "k") {
      walk(
        panel.current,
        [...(panel.current?.querySelectorAll<HTMLButtonElement>("button[data-parked]") ?? [])],
        key,
      );
      return true;
    }
    // Enter on a focused row presses it. Left to the Enter below, the browser's click is cancelled.
    if (key === "Enter") {
      if (row?.dataset.parked === undefined) return false;
      row.click();
      return true;
    }
    if (key !== "u" && key !== "o") return false;
    // Presses the focused row's own controls, so `u` reaches the put-back button.
    if (row?.dataset.parked !== undefined) pressParked(panel.current, row, key);
    return true;
  }

  /** The keys of a sitting, and the leader, true where one ran. */
  function sittingKey(key: string): boolean {
    // The leader works on every screen, so the other panes stay one Space away mid-sitting.
    if (key === " ") {
      if (!beginLeader(paneOpener(commands))) setPending(key);
      return true;
    }

    const rating = KEYED[key];
    if (rating !== undefined) {
      controls.current?.rate(rating);
      return true;
    }
    return key === "Enter" ? enterKey() : controlKey(key);
  }

  function controlKey(key: string): boolean {
    // Parking is allowed before the reveal too, since a card is often recognised from its question.
    if (key === "s") controls.current?.suspend();
    else if (key === "n") controls.current?.capture();
    // The side showing, so the front before the reveal and the back after it.
    else if (key === "r") controls.current?.replay();
    // The parked screen's `u` returned above, so this one is the sitting's.
    else if (key === "u") controls.current?.undo();
    else if (key === "q") onClose();
    else return false;
    return true;
  }

  /**
   * Once the answer is revealed, Enter grades Good, the default button.
   * A focused button or link takes its own Enter, so the pane grades nothing then.
   */
  function enterKey(): boolean {
    const focused = document.activeElement;
    const inPane = panel.current?.contains(focused) === true;
    const onControl =
      (focused instanceof HTMLButtonElement || focused instanceof HTMLAnchorElement) && inPane;
    // Try again is the one button drawn with no card up, so its Enter presses it.
    if (
      focused instanceof HTMLElement &&
      focused.dataset.reread !== undefined &&
      !controls.current?.showing &&
      inPane
    ) {
      return false;
    }
    if (controls.current?.revealed) {
      if (!onControl) controls.current.rate("good");
    } else if (!controls.current?.shown) controls.current?.reveal();
    return true;
  }

  return (
    <section
      ref={panel}
      data-review-pane
      // Focusable but out of the tab order, the way the todo and exam panes take the cursor.
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
          onOpen={onOpen}
        />
      )}
    </section>
  );
}

/** A modifier is held or a field has the keyboard, so the pane stands down. The leader still runs. */
function standsDown(event: React.KeyboardEvent): boolean {
  if (event.ctrlKey || event.altKey || event.metaKey) return true;
  const target = event.target as HTMLElement;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA";
}

/** `o` opens the parked card's note, `u` puts it back. */
function pressParked(panel: HTMLElement | null, row: HTMLButtonElement, key: string): void {
  if (key === "o") {
    row.click();
    return;
  }
  row.closest("li")?.querySelector<HTMLButtonElement>("button[data-unpark]")?.click();
  // The row goes with the card, so the keys after this one would reach nothing.
  panel?.focus();
}

function focusedRow(): HTMLButtonElement | null {
  return document.activeElement as HTMLButtonElement | null;
}

/**
 * Where `j` and `k` stop on the overview: every row that can be sat, and the fold toggle of a row that cannot.
 * A daily limit can leave a parent with nothing to offer, so its toggle must stay reachable.
 */
function deckStops(panel: HTMLElement | null): HTMLButtonElement[] {
  const buttons = panel?.querySelectorAll<HTMLButtonElement>(
    "button[data-deck], button[data-fold]",
  );
  return [...(buttons ?? [])].filter((button) =>
    button.dataset.fold === undefined
      ? !button.disabled
      : button.closest("li")?.querySelector<HTMLButtonElement>("button[data-deck]")?.disabled ===
        true,
  );
}

/**
 * Move the focus between rows, or press the one focused. Neither list wraps:
 * the first and last are where the list ends.
 */
function walk(panel: HTMLElement | null, rows: HTMLButtonElement[], key: string): void {
  const at = rows.indexOf(document.activeElement as HTMLButtonElement);
  if (key === "l") {
    rows[at]?.click();
    // A fold toggle stays where it is, and so does the cursor on it.
    if (rows[at]?.dataset.fold !== undefined) return;
    // The row it pressed goes with the overview, so no key of the sitting reaches the pane.
    panel?.focus();
    return;
  }
  const by = key === "j" ? 1 : -1;
  rows[at === -1 ? 0 : Math.min(Math.max(at + by, 0), rows.length - 1)]?.focus();
}

/**
 * Fold or unfold the deck under the cursor by pressing its toggle. With nothing under the cursor,
 * the deck above is folded instead, as vim's `za` does.
 */
function fold(panel: HTMLElement | null): void {
  const focused = document.activeElement as HTMLElement | null;
  const name = focused?.dataset.deck ?? focused?.dataset.fold;
  if (panel === null || name === undefined) return;
  // By the attribute's value, not a selector built from it, which a quote in the name would break.
  const find = (attribute: "deck" | "fold", wanted: string) =>
    [...panel.querySelectorAll<HTMLButtonElement>(`button[data-${attribute}]`)].find(
      (button) => button.dataset[attribute] === wanted,
    );

  const own = find("fold", name);
  if (own !== undefined) {
    own.click();
    return;
  }
  const parent = name.slice(0, name.lastIndexOf("/"));
  const toggle = name.includes("/") ? find("fold", parent) : undefined;
  if (toggle === undefined) return;
  toggle.click();
  const row = find("deck", parent);
  (row === undefined || row.disabled ? toggle : row).focus();
}
