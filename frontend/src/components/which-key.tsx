import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { trapTab } from "@/lib/ui/focus-trap";
import { heldModifier, TAB_KEYS } from "@/lib/ui/keys/leader-keys";
import { contextAt, type LeaderContext, type PanelRow, panelRows } from "@/lib/ui/keys/leader-view";
import { hostLeader, type LeaderOpener } from "@/lib/ui/keys/which-key";
import { SPRINGS, Spring } from "@/lib/ui/motion/spring";
import { LABEL } from "@/lib/ui/overlay-styles";

/**
 * The which-key panel: what Space leads to in the pane it was pressed in, a row
 * per group until a key opens one. It owns the keyboard while it is open.
 */

type Phase = "open" | "leaving" | "gone";

/**
 * What the key listener reads. Written in the same task as each change of state,
 * since React only commits later, and a key sent in that gap must already see it.
 */
interface Live {
  opener: LeaderOpener | null;
  typed: string;
  phase: Phase;
}

const KEY = "font-mono tracking-k-kbd";
const CHIP = `${KEY} rounded-[var(--k-radius-4)] bg-k-surface px-1.5 py-0.5`;
// A row's key sits in a fixed track, so every label starts at the same x. The tab row
// prints `1 … 0`, the widest key, so its track is wider than a two-key row needs.
const ENTRY_TRACK = "grid grid-cols-[2.25rem_1fr] items-baseline gap-x-2";
const TAB_TRACK = "grid grid-cols-[3rem_1fr] items-baseline gap-x-2";
const TAB_LABEL = "Go to a tab by number";
// Before a key each group sits in its own column, all short now; an open group
// flows its rows into as many columns as the pane is wide.
const COLUMNS = "grid grid-cols-[repeat(auto-fit,minmax(10.5rem,1fr))] gap-x-4 px-2 pb-3";
const FLOW = "columns-[13rem] gap-x-4 px-2 pb-3";

/** The keys as the panel prints them: `cf` reads as two presses, `c f`. */
function spaced(keys: string): string {
  return [...keys].join(" ");
}

/**
 * The foot of the pane the leader was pressed in, so a split shows which pane is
 * taking the keys. Without a pane (the file tree), the foot of the window.
 */
function placeFor(from: Element | null): CSSProperties {
  const pane = from?.closest("[data-pane]");
  if (!pane) return { left: 0, width: "100%", bottom: 0 };
  const rect = pane.getBoundingClientRect();
  return {
    left: rect.left,
    width: rect.width,
    bottom: window.innerHeight - rect.bottom,
    maxHeight: rect.height,
  };
}

const PANEL = '[role="dialog"][aria-label="Leader keys"]';

/**
 * Whether a target sits in the panel, asked of the DOM so a listener that
 * outlives every render needs no ref.
 */
function insidePanel(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(PANEL) !== null;
}

/** Enter on a focused row is that row's click, so the button gets it. */
function rowPress({ key, target }: KeyboardEvent): boolean {
  return key === "Enter" && target instanceof HTMLButtonElement && insidePanel(target);
}

/** Escape, Space again, or a key held with ctrl, alt or meta: the panel goes and nothing runs. */
function closesPanel({ key, ctrlKey, altKey, metaKey }: KeyboardEvent): boolean {
  return key === "Escape" || key === " " || ctrlKey || altKey || metaKey;
}

/**
 * Hands the focus back to what held it when Space was pressed. Synchronous and
 * without a scroll, so the panel's leave never moves the page.
 */
function focusBack(opener: LeaderOpener) {
  const from = opener.from;
  if (from instanceof HTMLElement && from.isConnected) from.focus({ preventScroll: true });
}

/** Each press as a chip. After a key a click on the Space chip goes back to the groups, as Backspace does. */
function Pressed({ typed, onBack }: { typed: string; onBack: () => void }) {
  return (
    <section
      aria-label="Keys pressed"
      className="flex flex-wrap items-center gap-1.5 px-4 pt-3 pb-2 text-[13px] text-k-ink"
    >
      {typed === "" ? (
        <kbd className={CHIP}>Space</kbd>
      ) : (
        <button type="button" aria-label="Back to the groups" onClick={onBack}>
          <kbd className={`${CHIP} cursor-pointer hover:text-k-accent`}>Space</kbd>
        </button>
      )}
      {/* Keyed by the prefix typed so far, which is unique for each press. */}
      {[...typed].map((key, index) => (
        <kbd key={typed.slice(0, index + 1)} className={CHIP}>
          {key}
        </kbd>
      ))}
    </section>
  );
}

function Entry({
  shown,
  label,
  group = false,
  onPress,
}: {
  shown: string;
  label: string;
  /** A row that opens a group of keys rather than running one. */
  group?: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      className={`group k-row w-full cursor-pointer break-inside-avoid px-3 py-[2px] text-left text-[13px] pointer-coarse:min-h-11 ${ENTRY_TRACK}`}
    >
      <kbd className={`${KEY} whitespace-nowrap text-k-accent`}>{spaced(shown)}</kbd>
      <span
        className={`leading-[1.3] group-hover:text-k-ink group-focus-visible:text-k-ink ${group ? "text-k-ink-soft" : "text-k-muted"}`}
      >
        {group ? `${label} …` : label}
      </span>
    </button>
  );
}

/** One move four ways, such as `h j k l`: each key its own button, read out by its own label. */
function FourRow({
  keys,
  label,
  onRun,
}: {
  keys: readonly { key: string; label: string }[];
  label: string;
  onRun: (key: string) => void;
}) {
  return (
    <div className={`break-inside-avoid px-3 py-[2px] text-[13px] ${TAB_TRACK}`}>
      <span className="flex gap-1">
        {keys.map((each) => (
          <button
            key={each.key}
            type="button"
            aria-label={each.label}
            onClick={() => onRun(each.key)}
            className={`${KEY} cursor-pointer text-k-accent hover:text-k-ink pointer-coarse:min-h-11`}
          >
            {each.key}
          </button>
        ))}
      </span>
      <span className="leading-[1.3] text-k-muted">{label}</span>
    </div>
  );
}

/** The ten tab digits in one row: a number is typed, not clicked. */
function TabRow() {
  return (
    <div className={`break-inside-avoid px-3 py-[3px] text-[13px] ${TAB_TRACK}`}>
      <kbd className={`${KEY} whitespace-nowrap text-k-accent`}>
        {`${TAB_KEYS[0]} … ${TAB_KEYS[TAB_KEYS.length - 1]}`}
      </kbd>
      <span className="text-k-muted">{TAB_LABEL}</span>
    </div>
  );
}

function PanelEntry({
  row,
  onRun,
  onNarrow,
}: {
  row: PanelRow;
  onRun: (key: string) => void;
  onNarrow: (typed: string) => void;
}) {
  if (row.kind === "digits") return <TabRow />;
  if (row.kind === "four") return <FourRow keys={row.keys} label={row.label} onRun={onRun} />;
  if (row.kind === "group") {
    return <Entry shown={row.shown} label={row.label} group onPress={() => onNarrow(row.key)} />;
  }
  return <Entry shown={row.shown} label={row.label} onPress={() => onRun(row.key)} />;
}

/**
 * The rows `typed` leads to, under the titles of the columns they sit in, so
 * `ct` sits under Tabs. A line at the foot says when keys were left out.
 */
function Body({
  context,
  edits,
  typed,
  onRun,
  onNarrow,
}: {
  context: LeaderContext;
  edits?: LeaderOpener["edits"];
  typed: string;
  onRun: (key: string) => void;
  onNarrow: (typed: string) => void;
}) {
  const { columns, hidden } = useMemo(
    () => panelRows(typed, context, edits),
    [typed, context, edits],
  );
  return (
    <>
      <div className={typed === "" ? COLUMNS : FLOW}>
        {columns.map((column) => (
          <section key={column.title} className="mb-3 min-w-0">
            <h3 className={`${LABEL} mb-1 break-after-avoid px-3`}>{column.title}</h3>
            {column.rows.map((row) => (
              <PanelEntry
                key={row.kind === "four" ? row.label : row.kind === "digits" ? "digits" : row.key}
                row={row}
                onRun={onRun}
                onNarrow={onNarrow}
              />
            ))}
          </section>
        ))}
      </div>
      {hidden && (
        <p className="px-5 pb-3 text-[12px] text-k-muted">
          Keys with nothing to do here are left out. Space ? lists them all.
        </p>
      )}
    </>
  );
}

/** Mounted on a desktop only: a phone has no leader key to show. */
export function WhichKey() {
  const [opener, setOpener] = useState<LeaderOpener | null>(null);
  const [typed, setTyped] = useState("");
  const [phase, setPhase] = useState<Phase>("gone");
  const [place, setPlace] = useState<CSSProperties>({});
  const panel = useRef<HTMLDivElement>(null);
  const live = useRef<Live>({ opener: null, typed: "", phase: "gone" });

  // The fade. Its frames write the opacity straight to the element, so
  // a narrowing key never re-renders the fade and the panel is never remounted.
  const [spring] = useState(
    () =>
      new Spring(1, (value) => {
        if (panel.current) panel.current.style.opacity = String(value);
      }),
  );
  useEffect(() => () => spring.stop(), [spring]);

  // Read once as the panel opens: the pane behind it does not change while it is up.
  const [context, setContext] = useState<LeaderContext>({ tab: [] });

  const open = useCallback(
    (next: LeaderOpener) => {
      live.current = { opener: next, typed: "", phase: "open" };
      setOpener(next);
      setContext(contextAt(next.from, next.note));
      setTyped("");
      setPlace(placeFor(next.from));
      setPhase("open");
      // A fade still running is caught where it is. A panel already gone starts
      // fully shown, with no fade in.
      if (spring.moving) void spring.to(1, SPRINGS.sheetOpen);
      else spring.set(1);
    },
    [spring],
  );
  useEffect(() => hostLeader(open), [open]);

  const leave = useCallback(() => {
    // Already on its way out, so a second close (the focus moving, then the key that
    // moved it) changes nothing and starts no second fade.
    if (live.current.phase !== "open") return;
    live.current = { ...live.current, phase: "leaving" };
    setPhase("leaving");
    // Gone once the fade has landed.
    void spring.to(0, SPRINGS.sheetClose).then((done) => {
      if (!done) return;
      live.current = { ...live.current, phase: "gone" };
      setPhase("gone");
    });
  }, [spring]);

  // The focus goes back first, so a command that moves it (a finder's input)
  // keeps it: the command runs after the focus is back, not before.
  const fire = useCallback(
    (from: LeaderOpener, run: () => void) => {
      focusBack(from);
      leave();
      run();
    },
    [leave],
  );

  const narrow = useCallback((next: string) => {
    if (live.current.phase !== "open") return;
    live.current = { ...live.current, typed: next };
    setTyped(next);
  }, []);
  const back = () => narrow(live.current.typed.slice(0, -1));

  const runRow = (key: string) => {
    // A panel on its way out takes no click: its rows are still drawn for the fade.
    if (live.current.phase !== "open" || opener === null) return;
    const run = opener.resolve(key);
    if (run) fire(opener, run);
  };

  // Capture on the document, so the panel sees each key before anything behind
  // it. Stopping it here is what keeps vim's `y` from yanking under the panel.
  useEffect(() => {
    const close = (opener: LeaderOpener) => {
      focusBack(opener);
      leave();
    };
    const typeKey = (opener: LeaderOpener, next: string) => {
      const run = opener.resolve(next);
      if (run) fire(opener, run);
      else if (opener.prefix(next)) narrow(next);
      else close(opener);
    };
    // Back up a level; with nothing typed there is nothing to undo, so it closes.
    const backUp = (current: Live, opener: LeaderOpener) => {
      if (current.typed === "") close(opener);
      else narrow(current.typed.slice(0, -1));
    };
    const trapInPanel = (event: KeyboardEvent) => {
      if (panel.current) trapTab(event, panel.current);
    };
    const actOn = (event: KeyboardEvent, current: Live, opener: LeaderOpener) => {
      if (event.key === "Tab") {
        trapInPanel(event);
        return;
      }

      event.preventDefault();
      if (closesPanel(event)) close(opener);
      else if (event.key === "Backspace") backUp(current, opener);
      else typeKey(opener, current.typed + event.key);
    };
    const onKey = (event: KeyboardEvent) => {
      const current = live.current;
      const opener = current.opener;
      if (current.phase !== "open" || opener === null) return;
      const { key } = event;
      // Shift and the rest are presses on their way to the key they are held
      // for: `Space E` is Shift then E, so the panel keeps waiting.
      if (heldModifier(key)) return;
      if (rowPress(event)) return;
      event.stopPropagation();
      actOn(event, current, opener);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [leave, fire, narrow]);

  // A press or a focus outside the panel is the reader going elsewhere: the panel
  // gives way at once, so the next key goes where that put the focus. Nothing is
  // stopped here, so the press and the focus still reach their targets.
  useEffect(() => {
    const away = (event: Event) => {
      if (live.current.phase !== "open" || insidePanel(event.target)) return;
      leave();
    };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("focusin", away, true);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("focusin", away, true);
    };
  }, [leave]);

  // Taken when the panel opens, not on each narrowing, so a key does not pull the focus.
  useEffect(() => {
    if (phase === "open") panel.current?.focus({ preventScroll: true });
  }, [phase]);

  if (phase === "gone") return null;

  return (
    <div
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-label="Leader keys"
      tabIndex={-1}
      // Out of the accessibility tree and off the pointer while it fades, so a
      // row the fade still draws is not a target any more.
      inert={phase === "leaving" || undefined}
      aria-hidden={phase === "leaving" ? "true" : undefined}
      style={place}
      className="fixed z-30 flex max-h-[85vh] flex-col border-t border-k-rule bg-k-paper shadow-[var(--k-shadow)] outline-none"
    >
      <Pressed typed={typed} onBack={back} />
      <div className="min-h-0 overflow-y-auto overscroll-contain">
        <Body
          context={context}
          edits={opener?.edits}
          typed={typed}
          onRun={runRow}
          onNarrow={narrow}
        />
      </div>
    </div>
  );
}
