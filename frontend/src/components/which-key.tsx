import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sheet } from "@/components/sheet";
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
// Before a key the desktop sets each group in its own column, all short now; an open group
// flows its rows into as many columns as the pane is wide. The phone sheet is one list.
const COLUMNS = "grid grid-cols-[repeat(auto-fit,minmax(10.5rem,1fr))] gap-x-4 px-2 pb-3";
const FLOW = "columns-[13rem] gap-x-4 px-2 pb-3";
const ONE_COLUMN = "grid grid-cols-1 px-2 pb-3";

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
 * Whether a target sits in the panel. The desktop panel and the phone sheet are
 * both that dialog, and the sheet never hands over a ref, so this asks the DOM.
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

/**
 * Each press as a chip. After a key the Space chip goes back to the groups, a
 * tap for the phone, where no Backspace is to hand.
 */
function Pressed({
  typed,
  sheet = false,
  onBack,
}: {
  typed: string;
  sheet?: boolean;
  onBack: () => void;
}) {
  return (
    <section
      aria-label="Keys pressed"
      className={`flex flex-wrap items-center gap-1.5 pt-3 pb-2 text-[13px] text-k-ink ${sheet ? "" : "px-4"}`}
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
  phone = false,
  onRun,
  onNarrow,
}: {
  context: LeaderContext;
  edits?: LeaderOpener["edits"];
  typed: string;
  /** On a phone the sheet is one column of full-width rows, a finger's target each. */
  phone?: boolean;
  onRun: (key: string) => void;
  onNarrow: (typed: string) => void;
}) {
  const { columns, hidden } = useMemo(
    () => panelRows(typed, context, edits, !phone),
    [typed, context, edits, phone],
  );
  return (
    <>
      <div className={phone ? ONE_COLUMN : typed === "" ? COLUMNS : FLOW}>
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

export function WhichKey({ phone }: { phone: boolean }) {
  const [opener, setOpener] = useState<LeaderOpener | null>(null);
  const [typed, setTyped] = useState("");
  const [phase, setPhase] = useState<Phase>("gone");
  const [place, setPlace] = useState<CSSProperties>({});
  // Set by a row that ran, so the sheet does not give the focus back over the command's.
  const [ran, setRan] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const live = useRef<Live>({ opener: null, typed: "", phase: "gone" });
  // Read by the one key listener, which outlives every render, so it never sees a stale phone.
  const phoneRef = useRef(phone);
  phoneRef.current = phone;
  // Whether the reader has pressed a key the panel acts on, or pressed outside it, since
  // it opened. A press inside the sheet (a scroll of its rows) does not count. On a
  // phone a focus that moves without one (the editor taking it back, say) is not the
  // reader going elsewhere, and must not take the sheet down with it.
  const gestured = useRef(false);

  // The desktop fade. Its frames write the opacity straight to the element, so
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
      gestured.current = false;
      setOpener(next);
      setContext(contextAt(next.from, next.note));
      setTyped("");
      setRan(false);
      setPlace(phone ? {} : placeFor(next.from));
      setPhase("open");
      if (phone) return;
      // A fade still running is caught where it is. A panel already gone starts
      // fully shown, with no fade in on desktop.
      if (spring.moving) void spring.to(1, SPRINGS.sheetOpen);
      else spring.set(1);
    },
    [phone, spring],
  );
  useEffect(() => hostLeader(open), [open]);

  const leave = useCallback(() => {
    // Already on its way out, so a second close (the focus moving, then the key that
    // moved it) changes nothing and starts no second fade.
    if (live.current.phase !== "open") return;
    live.current = { ...live.current, phase: "leaving" };
    setPhase("leaving");
    // The phone sheet leaves by itself once `open` turns false. The desktop panel
    // fades here, and is gone once the fade has landed.
    if (!phoneRef.current) {
      void spring.to(0, SPRINGS.sheetClose).then((done) => {
        if (!done) return;
        live.current = { ...live.current, phase: "gone" };
        setPhase("gone");
      });
    }
  }, [spring]);

  // The focus goes back first, so a command that moves it (a finder's input)
  // keeps it: the command runs after the focus is back, not before.
  const fire = useCallback(
    (from: LeaderOpener, run: () => void) => {
      setRan(true);
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
    const trapInBox = (event: KeyboardEvent) => {
      // On a phone the sheet is the box, found from the focused element.
      const box =
        panel.current ??
        (event.target instanceof Element
          ? event.target.closest<HTMLElement>('[role="dialog"]')
          : null);
      if (box) trapTab(event, box);
    };
    const actOn = (event: KeyboardEvent, current: Live, opener: LeaderOpener) => {
      if (event.key === "Tab") {
        trapInBox(event);
        return;
      }

      event.preventDefault();
      if (closesPanel(event)) close(opener);
      // Back up a level; with nothing typed there is nothing to undo, so it closes.
      else if (event.key === "Backspace") {
        if (current.typed === "") close(opener);
        else narrow(current.typed.slice(0, -1));
      } else typeKey(opener, current.typed + event.key);
    };
    const onKey = (event: KeyboardEvent) => {
      const current = live.current;
      const opener = current.opener;
      if (current.phase !== "open" || opener === null) return;
      gestured.current = true;
      const { key } = event;
      // Shift and the rest are presses on their way to the key they are held
      // for: `Space E` is Shift then E, so the panel keeps waiting.
      if (heldModifier(key)) return;
      if (rowPress(event)) return;
      // A key the panel acts on counts as the reader's; a lone modifier does not.
      gestured.current = true;
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
      if (event.type === "pointerdown") gestured.current = true;
      // A focus move the reader did not make leaves a phone's sheet up. The desktop
      // panel keeps closing on any focus outside it, as it always has.
      if (event.type === "focusin" && phoneRef.current && !gestured.current) return;
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
    if (phase === "open" && !phone) panel.current?.focus({ preventScroll: true });
  }, [phase, phone]);

  if (phone) {
    return (
      <Sheet
        open={phase === "open"}
        onClose={() => {
          live.current = { ...live.current, phase: "gone" };
          setPhase("gone");
        }}
        label="Leader keys"
        header={<Pressed typed={typed} sheet onBack={back} />}
        restoreFocus={!ran}
      >
        <Body
          context={context}
          edits={opener?.edits}
          typed={typed}
          phone
          onRun={runRow}
          onNarrow={narrow}
        />
      </Sheet>
    );
  }

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
