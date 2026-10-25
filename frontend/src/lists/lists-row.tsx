import { type KeyboardEvent, useEffect, useRef } from "react";
import { personOf } from "./lists-person";
import type { Item } from "./lists-store";

/**
 * One item: the tick and the words as one checkbox button, the assignee chip on
 * the right as a sibling. A button may not hold a button, so the two sit side by side.
 */
export function Row({
  item,
  me,
  people,
  tick,
  open,
  onToggle,
  onMenu,
  onPick,
}: {
  item: Item;
  me: string | null;
  people: string[];
  /** The "abgehakt von" line under a done item, or null. */
  tick: string | null;
  /** Whether this row's chip menu is the one open. */
  open: boolean;
  onToggle: () => void;
  onMenu: (open: boolean) => void;
  onPick: (name: string | null) => void;
}) {
  return (
    <div className="row">
      <div className="line">
        {/* biome-ignore lint/a11y/useSemanticElements: the whole line is the tap target */}
        <button
          type="button"
          role="checkbox"
          aria-checked={item.done}
          className="words"
          onClick={onToggle}
        >
          <span className="check" aria-hidden="true" />
          <span className="text">{item.text}</span>
        </button>
        {tick && <p className="by">{tick}</p>}
      </div>
      <PersonChip item={item} me={me} people={people} open={open} onMenu={onMenu} onPick={onPick} />
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
        onClick={() => onMenu(!open)}
      >
        <span className="chip-name">{label}</span>
      </button>
      {open && (
        <ChipMenu
          names={people}
          current={name}
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
 * The people, then Niemand. Opens with the focus on the one that is chosen, and
 * the arrows move through it, as a menu does.
 */
function ChipMenu({
  names,
  current,
  onPick,
  onEscape,
}: {
  names: string[];
  current: string | null;
  onPick: (name: string | null) => void;
  onEscape: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    menu.current?.querySelector<HTMLElement>("[aria-checked='true']")?.focus();
  }, []);

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
