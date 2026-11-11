import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Item } from "./lists-store";
import { personOf } from "./lists-view";

/** How far a finger must pull a row left, in px, before letting go deletes it. */
const SWIPE_DELETE = 96;

/** How far a finger moves before the row decides it is a swipe and not a tap or a scroll. */
const SWIPE_SLOP = 10;

/**
 * A row a finger pulls left to delete. Touch only: a mouse has the × instead. The row takes
 * pan-y, so the page still scrolls up and down and the sideways move reaches us.
 */
function useSwipe(onDelete: () => void) {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const swiping = useRef(false);
  // Set by a swipe, so the click its lift fires opens no edit and ticks nothing.
  const moved = useRef(false);

  function end(): void {
    start.current = null;
    swiping.current = false;
    setDx(0);
  }

  return {
    dx,
    handlers: {
      onPointerDown(event: ReactPointerEvent<HTMLElement>) {
        if (event.pointerType !== "touch") return;
        start.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
        moved.current = false;
      },
      onPointerMove(event: ReactPointerEvent<HTMLElement>) {
        const from = start.current;
        if (!from || from.id !== event.pointerId) return;
        const x = event.clientX - from.x;
        const y = event.clientY - from.y;
        if (!swiping.current) {
          if (Math.abs(y) > SWIPE_SLOP) return end();
          if (x > -SWIPE_SLOP) return;
          swiping.current = true;
          moved.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
        }
        setDx(Math.min(0, x));
      },
      onPointerUp() {
        const pulled = swiping.current && dx <= -SWIPE_DELETE;
        end();
        if (pulled) onDelete();
      },
      onPointerCancel: end,
      onClickCapture(event: MouseEvent<HTMLElement>) {
        if (!moved.current) return;
        moved.current = false;
        event.preventDefault();
        event.stopPropagation();
      },
    },
  };
}

/**
 * One item or part: the tick, the words, which a tap opens for editing, the assignee chip and
 * the ×. A finger pulls the row left to delete it. In editing, Löschen stands where the chip was.
 * A button may not hold a button, so all sit side by side.
 */
export function Row({
  item,
  me,
  people,
  tick,
  count,
  folded,
  open,
  onToggle,
  onMenu,
  onPick,
  onEdit,
  onDelete,
  onFold,
  onPart,
}: {
  item: Item;
  me: string | null;
  people: string[];
  /** The "abgehakt von" line under a done item, or null. */
  tick: string | null;
  /** `1/3` for an item with parts, or null. */
  count: string | null;
  /** Whether the parts are folded away; only read when there is a count. */
  folded: boolean;
  /** Whether this row's chip menu is the one open. */
  open: boolean;
  onToggle: () => void;
  onMenu: (open: boolean) => void;
  onPick: (name: string | null) => void;
  onEdit: (text: string) => void;
  onDelete: () => void;
  onFold: () => void;
  /** Opens the Eintrag field for a part of this item; left out where no part is offered. */
  onPart?: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const swipe = useSwipe(onDelete);
  // Set once Enter, Escape or Löschen ends the edit, so the blur the field's removal may fire saves nothing.
  const ended = useRef(false);

  // Enter and a blur save, Escape drops the draft. Empty words are no edit.
  function finish(save: boolean): void {
    if (ended.current) return;
    ended.current = true;
    const text = draft?.trim() ?? "";
    setDraft(null);
    if (save && text && text !== item.text) onEdit(text);
  }

  function start(): void {
    ended.current = false;
    setDraft(item.text);
  }

  const pulled = swipe.dx <= -SWIPE_DELETE;
  return (
    <div className="swipe" data-swiping={swipe.dx < 0} data-armed={pulled}>
      <div
        className="row"
        data-done={item.done}
        style={{ "--depth": item.depth, "--swipe": `${swipe.dx}px` } as CSSProperties}
        {...(draft === null ? swipe.handlers : {})}
      >
        {/* biome-ignore lint/a11y/useSemanticElements: a round tick, drawn as the list's own */}
        <button
          type="button"
          role="checkbox"
          aria-checked={item.done}
          aria-label={item.text}
          className="tick"
          onClick={onToggle}
        >
          <span className="check" aria-hidden="true" />
        </button>
        <div className="line">
          {draft === null ? (
            <button
              type="button"
              className="words"
              aria-label={`${item.text} bearbeiten`}
              onClick={start}
            >
              <span className="text">{item.text}</span>
              {count && <span className="parts">{count}</span>}
            </button>
          ) : (
            <input
              className="edit"
              aria-label="Wörter"
              enterKeyHint="done"
              autoComplete="off"
              // biome-ignore lint/a11y/noAutofocus: the tap on the words asked for this field
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => finish(true)}
              onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "Enter") finish(true);
                if (event.key === "Escape") finish(false);
              }}
            />
          )}
          {tick && <p className="by">{tick}</p>}
        </div>
        {draft !== null ? (
          <button
            type="button"
            className="delete"
            // Held off the field's blur, which would save the words first.
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              finish(false);
              onDelete();
            }}
          >
            Löschen
          </button>
        ) : (
          <>
            {count && (
              <button
                type="button"
                className="fold"
                aria-expanded={!folded}
                aria-label={`Teile von ${item.text}`}
                onClick={onFold}
              />
            )}
            {onPart && (
              <button
                type="button"
                className="part"
                aria-label={`Teil zu ${item.text}`}
                onClick={onPart}
              >
                +
              </button>
            )}
            <PersonChip
              item={item}
              me={me}
              people={people}
              open={open}
              onMenu={onMenu}
              onPick={onPick}
            />
            <button
              type="button"
              className="remove"
              aria-label={`${item.text} löschen`}
              onClick={onDelete}
            >
              ×
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Who the item is for. "Wer?" when nobody, "Ich" when it is you, else the name.
 * A tap opens the menu of people; a second tap on the chip closes it.
 */
function PersonChip({
  item,
  me,
  people,
  open,
  onMenu,
  onPick,
}: {
  item: Item;
  me: string | null;
  people: string[];
  open: boolean;
  onMenu: (open: boolean) => void;
  onPick: (name: string | null) => void;
}) {
  const chip = useRef<HTMLButtonElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  // A key opens the menu with its checked item focused; a tap or a click leaves the focus where it was.
  const [byKey, setByKey] = useState(false);
  const name = personOf(item.assignee);
  const label = name === null ? "Wer?" : name === me ? "Ich" : name;

  // A press anywhere else closes the menu. The chip itself is inside `wrap`, so its own press is not outside.
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !wrap.current?.contains(event.target)) onMenu(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, onMenu]);

  // Escape closes the menu from wherever the focus is, as a menu does. The focus goes back
  // to the chip, which a click left on the chip already, and a key's focus was in the menu.
  useEffect(() => {
    if (!open) return;
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      onMenu(false);
      chip.current?.focus();
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [open, onMenu]);

  function close(restore: boolean): void {
    onMenu(false);
    if (restore) chip.current?.focus();
  }

  return (
    <div className="chip-wrap" ref={wrap}>
      <button
        ref={chip}
        type="button"
        className={`chip ${name === null ? "unlinked" : "linked"}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event: MouseEvent<HTMLButtonElement>) => {
          // A key's click has a detail of 0; a tap or a mouse click has 1 or more.
          setByKey(event.detail === 0);
          onMenu(!open);
        }}
        onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
          if (open) {
            // With the menu open, the arrows from the chip move into it, from its first or last row.
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            const rows = [
              ...(wrap.current?.querySelectorAll<HTMLElement>("[role='menuitemradio']") ?? []),
            ];
            (event.key === "ArrowDown" ? rows[0] : rows.at(-1))?.focus();
            return;
          }
          if (event.key !== "ArrowDown") return;
          event.preventDefault();
          setByKey(true);
          onMenu(true);
        }}
      >
        <span className="chip-name">{label}</span>
      </button>
      {open && (
        <ChipMenu
          names={people}
          current={name}
          focusChecked={byKey}
          onPick={(picked) => {
            close(true);
            onPick(picked);
          }}
          onEscape={() => close(true)}
        />
      )}
    </div>
  );
}

/**
 * The people, then Niemand. Opened by a key, it takes the focus on the one that is chosen,
 * and the arrows move through it, as a menu does. Opened by a tap, the focus stays on the
 * chip, so no ring appears on a row the finger never reached.
 */
function ChipMenu({
  names,
  current,
  focusChecked,
  onPick,
  onEscape,
}: {
  names: string[];
  current: string | null;
  focusChecked: boolean;
  onPick: (name: string | null) => void;
  onEscape: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusChecked) menu.current?.querySelector<HTMLElement>("[aria-checked='true']")?.focus();
  }, [focusChecked]);

  function onKey(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      onEscape();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const options = [
      ...(menu.current?.querySelectorAll<HTMLElement>("[role='menuitemradio']") ?? []),
    ];
    const at = options.indexOf(document.activeElement as HTMLElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    options[(at + step + options.length) % options.length]?.focus();
  }

  return (
    <div role="menu" aria-label="Wer?" className="menu" ref={menu} onKeyDown={onKey}>
      {names.map((name) => (
        <button
          key={name}
          type="button"
          role="menuitemradio"
          aria-checked={name === current}
          onClick={() => onPick(name)}
        >
          {name}
        </button>
      ))}
      <button
        type="button"
        role="menuitemradio"
        aria-checked={current === null}
        onClick={() => onPick(null)}
      >
        Niemand
      </button>
    </div>
  );
}
