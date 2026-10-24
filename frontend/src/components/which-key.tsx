import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sheet } from "@/components/sheet";
import { trapTab } from "@/lib/focus-trap";
import { heldModifier, LEADER, LEADER_COLUMNS, TAB_DIGITS, TAB_KEYS } from "@/lib/leader-keys";
import { LABEL } from "@/lib/overlay-styles";
import { SPRINGS, Spring } from "@/lib/spring";
import { hostLeader, type LeaderOpener } from "@/lib/which-key";

/**
 * The which-key panel: what Space leads to, shown at once and narrowed by each
 * key. It owns the keyboard while it is open, so nothing behind it sees a key.
 */

type Phase = "open" | "leaving" | "gone";

interface Row {
  key: string;
  label: string;
}

interface Column {
  title: string;
  rows: Row[];
}

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
// The desktop panel wraps its six columns to the width. The phone sheet is one list.
const COLUMNS = "grid grid-cols-[repeat(auto-fit,minmax(10.5rem,1fr))] gap-x-4 gap-y-4 px-2 pb-3";
const ONE_COLUMN = "grid grid-cols-1 gap-y-4 px-2 pb-3";

/** The keys as the panel prints them: `cf` reads as two presses, `c f`. */
function spaced(keys: string): string {
  return [...keys].join(" ");
}

/**
 * The leader cut into its six columns. A key of the editor's edits appears only
 * where the editor opened the panel, and a key in neither table is skipped.
 */
function columnsFor(edits: readonly Row[] = []): Column[] {
  return LEADER_COLUMNS.map(({ title, keys }) => ({
    title,
    rows: keys.flatMap((key) => {
      if (key === TAB_DIGITS) return [{ key, label: TAB_LABEL }];
      const row = LEADER.find((each) => each.key === key) ?? edits.find((each) => each.key === key);
      return row ? [{ key, label: row.label }] : [];
    }),
  }));
}

/**
 * The foot of the pane the leader was pressed in, so a split shows which pane is
 * taking the keys. Without a pane (the file tree), the foot of the window.
 */
function placeFor(from: Element | null): CSSProperties {
  const pane = from?.closest("[data-pane]");
  if (!pane) return { left: 0, width: "100%", bottom: 0 };
  const rect = pane.getBoundingClientRect();
  return { left: rect.left, width: rect.width, bottom: window.innerHeight - rect.bottom };
}

const PANEL = '[role="dialog"][aria-label="Leader keys"]';

/**
 * Whether a target sits in the panel. The desktop panel and the phone sheet are
 * both that dialog, and the sheet never hands over a ref, so this asks the DOM.
 */
function insidePanel(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(PANEL) !== null;
}

/**
 * Hands the focus back to what held it when Space was pressed. Synchronous and
 * without a scroll, so the panel's leave never moves the page.
 */
function focusBack(opener: LeaderOpener) {
  const from = opener.from;
  if (from instanceof HTMLElement && from.isConnected) from.focus({ preventScroll: true });
}

/** Each press as a chip. The sheet's header already insets its row, so there it takes no side padding. */
function Pressed({ typed, sheet = false }: { typed: string; sheet?: boolean }) {
  return (
    <section
      aria-label="Keys pressed"
      className={`flex flex-wrap items-center gap-1.5 pt-3 pb-2 text-[13px] text-k-ink ${sheet ? "" : "px-4"}`}
    >
      <kbd className={CHIP}>Space</kbd>
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
  rowKey,
  shown,
  label,
  onRun,
}: {
  rowKey: string;
  shown: string;
  label: string;
  onRun: (key: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onRun(rowKey)}
      className={`group k-row w-full cursor-pointer px-3 py-[2px] text-left text-[13px] pointer-coarse:min-h-11 ${ENTRY_TRACK}`}
    >
      <kbd className={`${KEY} whitespace-nowrap text-k-accent`}>{spaced(shown)}</kbd>
      <span className="leading-[1.3] text-k-muted group-hover:text-k-ink group-focus-visible:text-k-ink">
        {label}
      </span>
    </button>
  );
}

/** The ten tab digits in one row: a number is typed, not clicked. */
function TabRow() {
  return (
    <div className={`px-3 py-[3px] text-[13px] ${TAB_TRACK}`}>
      <kbd className={`${KEY} whitespace-nowrap text-k-accent`}>
        {`${TAB_KEYS[0]} … ${TAB_KEYS[TAB_KEYS.length - 1]}`}
      </kbd>
      <span className="text-k-muted">{TAB_LABEL}</span>
    </div>
  );
}

/**
 * The six columns before any key, and once a key is typed the rows it begins,
 * shown in one group per column the matches sit in, each under its own title.
 */
function Body({
  columns,
  typed,
  phone = false,
  onRun,
}: {
  columns: Column[];
  typed: string;
  /** On a phone the sheet is one column of full-width rows, a finger's target each. */
  phone?: boolean;
  onRun: (key: string) => void;
}) {
  if (typed === "") {
    return (
      <div className={phone ? ONE_COLUMN : COLUMNS}>
        {columns.map((column) => (
          <section key={column.title} className="min-w-0">
            <h3 className={`${LABEL} mb-1 px-3`}>{column.title}</h3>
            {column.rows.map((row) =>
              row.key === TAB_DIGITS ? (
                <TabRow key={row.key} />
              ) : (
                <Entry
                  key={row.key}
                  rowKey={row.key}
                  shown={row.key}
                  label={row.label}
                  onRun={onRun}
                />
              ),
            )}
          </section>
        ))}
      </div>
    );
  }

  // One group per column the matches sit in, in column order, so `ct` sits under Tabs.
  const groups = columns.flatMap((column) => {
    const rows = column.rows.filter(
      (row) => row.key !== TAB_DIGITS && row.key.startsWith(typed) && row.key.length > typed.length,
    );
    return rows.length > 0 ? [{ title: column.title, rows }] : [];
  });
  return (
    <div className="px-2 pb-3">
      {groups.map((group) => (
        <section key={group.title} className="mb-2">
          <h3 className={`${LABEL} mb-1 px-3`}>{group.title}</h3>
          {group.rows.map((row) => (
            <Entry
              key={row.key}
              rowKey={row.key}
              shown={row.key.slice(typed.length)}
              label={row.label}
              onRun={onRun}
            />
          ))}
        </section>
      ))}
    </div>
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

  // The desktop fade. Its frames write the opacity straight to the element, so
  // a narrowing key never re-renders the fade and the panel is never remounted.
  const [spring] = useState(
    () =>
      new Spring(1, (value) => {
        if (panel.current) panel.current.style.opacity = String(value);
      }),
  );
  useEffect(() => () => spring.stop(), [spring]);

  const columns = useMemo(() => columnsFor(opener?.edits), [opener]);

  const open = useCallback(
    (next: LeaderOpener) => {
      live.current = { opener: next, typed: "", phase: "open" };
      setOpener(next);
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

  const runRow = (key: string) => {
    // A panel on its way out takes no click: its rows are still drawn for the fade.
    if (live.current.phase !== "open" || opener === null) return;
    const run = opener.resolve(key);
    if (run) fire(opener, run);
  };

  // Capture on the document, so the panel sees each key before anything behind
  // it. Stopping it here is what keeps vim's `y` from yanking under the panel.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const current = live.current;
      const opener = current.opener;
      if (current.phase !== "open" || opener === null) return;
      const { key } = event;
      // Shift and the rest are presses on their way to the key they are held
      // for: `Space E` is Shift then E, so the panel keeps waiting.
      if (heldModifier(key)) return;
      // Enter on a focused row is that row's click, so the button gets it.
      if (key === "Enter" && event.target instanceof HTMLButtonElement && insidePanel(event.target))
        return;
      event.stopPropagation();

      if (key === "Tab") {
        // On a phone the sheet is the box, found from the focused element.
        const box =
          panel.current ??
          (event.target instanceof Element
            ? event.target.closest<HTMLElement>('[role="dialog"]')
            : null);
        if (box) trapTab(event, box);
        return;
      }

      event.preventDefault();
      if (key === "Escape" || key === " " || event.ctrlKey || event.altKey || event.metaKey) {
        focusBack(opener);
        leave();
        return;
      }

      const next = current.typed + key;
      const run = opener.resolve(next);
      if (run) fire(opener, run);
      else if (opener.prefix(next)) {
        live.current = { ...current, typed: next };
        setTyped(next);
      } else {
        focusBack(opener);
        leave();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [leave, fire]);

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
        header={<Pressed typed={typed} sheet />}
        restoreFocus={!ran}
      >
        <Body columns={columns} typed={typed} phone onRun={runRow} />
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
      <Pressed typed={typed} />
      <div className="min-h-0 overflow-y-auto overscroll-contain">
        <Body columns={columns} typed={typed} onRun={runRow} />
      </div>
    </div>
  );
}
