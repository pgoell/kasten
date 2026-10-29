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
 * Which of the three screens is showing.
 *
 * One nullable deck used to answer this, and a third screen reached with a null
 * deck would silently inherit the overview's keys. Naming the screen is what
 * stops `j` walking the decks behind a list that is not the decks.
 */
type Screen = { at: "decks" } | { at: "sitting"; deck: Deck } | { at: "parked" };

/** `1` to `4`, in the order the buttons are drawn. */
const KEYED: Record<string, Rating> = { "1": "again", "2": "hard", "3": "good", "4": "easy" };

/** What `ReviewSession` hands up for the keys to press. */
interface Controls {
  showing: boolean;
  shown: boolean;
  revealed: boolean;
  reveal: () => void;
  rate: (rating: Rating) => void;
  suspend: () => void;
  capture: () => void;
  replay: () => void;
  undo: () => void;
}

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
  const controls = useRef<Controls | null>(null);
  const panel = useRef<HTMLElement>(null);
  // A ref and not the leader's `pending`: `za` handed to `leaderAction` would
  // run whatever `<leader>a` is.
  const zee = useRef(false);

  const onControls = useCallback((given: typeof controls.current) => {
    controls.current = given;
  }, []);

  // A freshly split pane is created focused and its first render is the only
  // chance it gets to say so. An unfocused pane is handed 0 and stays put.
  useEffect(() => {
    if (focusSignal) panel.current?.focus();
  }, [focusSignal]);

  // A clicked deck row or Start button goes with the screen it was on, taking
  // the focus to the body, and no key would reach the pane until a second click
  // on the card. `l` puts it back itself; this covers the mouse.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on each new screen
  useEffect(() => {
    if (document.activeElement === document.body) panel.current?.focus();
  }, [screen]);

  function onLeaderKey(event: React.KeyboardEvent) {
    const sequence = pending + event.key;
    const wanted = sequence.slice(1);
    const run = leaderAction(wanted, commands);
    // A leader key can be more than one letter, so a sequence that still
    // prefixes one waits for the rest instead of being dropped.
    setPending(!run && leaderPrefix(wanted) ? sequence : "");
    if (!run) return;
    event.preventDefault();
    run();
  }

  /** Runs `key` on the screen showing. True where the pane took it. */
  function onPaneKey(key: string): boolean {
    // `za` folds, the way it folds in vim. A `z` followed by anything else is
    // dropped and the key after it runs as itself, so a stray `z` costs no `j`.
    const zed = zee.current;
    zee.current = screen.at === "decks" && key === "z";
    if (screen.at === "decks" && decksKey(key, zed, panel.current, setScreen)) return true;
    if (screen.at === "parked" && parkedKey(key, panel.current)) return true;

    // Back to the decks, which is the `← Decks` button, the way out of one deck
    // into another and the way off the parked list. `q` closes the pane from
    // any screen, so leaving a sitting and leaving the review are two keys.
    if (screen.at !== "decks" && key === "h") {
      setScreen({ at: "decks" });
      return true;
    }

    // The leader on every screen, a card on it or not, so the other panes stay
    // one Space away mid-sitting. Enter is the review's own key.
    if (key === " ") {
      if (!beginLeader(paneOpener(commands))) setPending(key);
      return true;
    }
    return cardKey(key, controls.current, panel.current, onClose);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const { key } = event;

    // A modifier holds itself down before the key it is held for arrives, and
    // a pending sequence that read it as a key would drop the sequence there.
    if (heldModifier(key)) return;

    // The leader still works inside the pane, the way it does inside the exam,
    // so the other panes stay reachable mid-session.
    if (pending) {
      onLeaderKey(event);
      return;
    }

    if (event.ctrlKey || event.altKey || event.metaKey) return;

    // A field has the keyboard, so the pane stands down: `1` is a digit in a
    // question and `space` is a space in one, not a rating and not the reveal.
    // The leader above still runs, which is the one thing that has to.
    const target = event.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

    // A held key repeats, and each repeat would answer the card again. The first
    // press did the work, so the repeats of the answering keys do nothing,
    // whatever the focus is on.
    const answers = key === " " || key === "Enter" || KEYED[key] !== undefined;
    if ((event.repeat && answers) || onPaneKey(key)) event.preventDefault();
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
          onOpen={onOpen}
        />
      )}
    </section>
  );
}

/** The overview's keys, `zed` being whether a `z` came before. True where `key` is one. */
function decksKey(
  key: string,
  zed: boolean,
  panel: HTMLElement | null,
  setScreen: (screen: Screen) => void,
): boolean {
  if (zed && key === "a") fold(panel);
  else if (key === "z") return true;
  // The browser moves the focus between buttons on Tab and nothing else, so `j`
  // and `k` do it here, and `l` presses the one focused the way Enter on a
  // focused button already does.
  else if (key === "j" || key === "k" || key === "l") walk(panel, deckStops(panel), key);
  else if (key === "p") setScreen({ at: "parked" });
  // Enter on a focused row presses it, as `l` does. Left to the sitting's Enter,
  // the key is stopped there and the browser's click on the row with it.
  else if (key === "Enter" && focusedButton()?.dataset.deck !== undefined) {
    walk(panel, deckStops(panel), "l");
  } else return false;
  return true;
}

/** The parked list's keys. True where `key` is one. */
function parkedKey(key: string, panel: HTMLElement | null): boolean {
  // The same walk over a different selector. `data-parked` and not
  // `data-deck`, so neither screen's keys can reach the other's rows.
  if (key === "j" || key === "k") {
    walk(
      panel,
      [...(panel?.querySelectorAll<HTMLButtonElement>("button[data-parked]") ?? [])],
      key,
    );
    return true;
  }
  const row = focusedButton();
  const onRow = row?.dataset.parked !== undefined;
  // The focused row's own controls, pressed rather than reimplemented, the way
  // `l` presses the focused deck. `u` reaches the put-back button beside the
  // row, which an unanswered row does not draw.
  if (key === "u" && onRow) {
    row?.closest("li")?.querySelector<HTMLButtonElement>("button[data-unpark]")?.click();
    // The row goes with the card, taking the focus to the body with it, and
    // every key after this one would reach nothing.
    panel?.focus();
  } else if ((key === "o" || key === "Enter") && onRow) row?.click();
  // Taken with no row too, so the sitting's `u` never runs here.
  return key === "u" || key === "o" || (key === "Enter" && onRow);
}

/** A sitting's keys. True where the pane takes `key`. */
function cardKey(
  key: string,
  controls: Controls | null,
  panel: HTMLElement | null,
  onClose: () => void,
): boolean {
  const rating = KEYED[key];
  if (rating !== undefined) controls?.rate(rating);
  else if (key === "Enter") return enterOnCard(controls, panel);
  // Before the reveal as well as after it, because a card you want out of the
  // deck is one you have recognised from its question alone.
  else if (key === "s") controls?.suspend();
  else if (key === "n") controls?.capture();
  // The side showing, so the front before the reveal and the back after it.
  else if (key === "r") controls?.replay();
  else if (key === "u") controls?.undo();
  else if (key === "q") onClose();
  else return false;
  return true;
}

/**
 * Enter in a sitting reveals, and once the answer is revealed grades it Good. A
 * whole note shows with nothing to reveal, so its Enter does nothing, and a
 * focused button or link answers its own Enter. False where the key goes through.
 */
function enterOnCard(controls: Controls | null, panel: HTMLElement | null): boolean {
  const focused = document.activeElement;
  const inPane = focused instanceof HTMLElement && panel?.contains(focused) === true;
  // Try again is the one button a sitting draws with no card up, and its own
  // Enter presses it, so the pane lets that key through for it alone.
  if (inPane && focused.dataset.reread !== undefined && !controls?.showing) return false;
  const onControl =
    inPane && (focused instanceof HTMLButtonElement || focused instanceof HTMLAnchorElement);
  if (controls?.revealed) {
    if (!onControl) controls.rate("good");
  } else if (!controls?.shown) controls?.reveal();
  return true;
}

function focusedButton(): HTMLButtonElement | null {
  return document.activeElement as HTMLButtonElement | null;
}

/**
 * Where `j` and `k` stop on the overview: every row that can be sat, and the
 * fold toggle of a row that cannot.
 *
 * A daily limit can leave a parent with nothing to offer above a subdeck that
 * has cards, and a walk over enabled rows alone would never reach the toggle
 * that shows that subdeck. In the order drawn, so the toggle sits where its row
 * does.
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
 * Move the focus between rows, or press the one focused.
 *
 * Two screens draw a list of buttons and neither is in the tab order, so the
 * walk is the same and only the rows differ. Neither wraps: the first and the
 * last are where the list ends, which is what tells you so without looking.
 */
function walk(panel: HTMLElement | null, rows: HTMLButtonElement[], key: string): void {
  const at = rows.indexOf(document.activeElement as HTMLButtonElement);
  if (key === "l") {
    rows[at]?.click();
    // A fold toggle stays where it is, and so does the cursor on it.
    if (rows[at]?.dataset.fold !== undefined) return;
    // The row it pressed goes with the overview, taking the focus to the body
    // with it, and no key of the sitting would reach the pane after that.
    panel?.focus();
    return;
  }
  const by = key === "j" ? 1 : -1;
  rows[at === -1 ? 0 : Math.min(Math.max(at + by, 0), rows.length - 1)]?.focus();
}

/**
 * Fold or unfold the deck under the cursor by pressing its toggle.
 *
 * On a deck with nothing under it, the deck above is folded instead, the way
 * vim's `za` inside a fold closes the fold around it. The row the cursor was on
 * goes with that fold, so the cursor moves up to the parent's row, or to the
 * parent's toggle where a row with nothing to offer cannot take the focus.
 */
function fold(panel: HTMLElement | null): void {
  const focused = document.activeElement as HTMLElement | null;
  const name = focused?.dataset.deck ?? focused?.dataset.fold;
  if (panel === null || name === undefined) return;
  // By the attribute's value rather than a selector built from it, which a
  // deck name holding a quote would break.
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
