import { useEffect, useId, useMemo, useRef, useState } from "react";
import { lineCandidates, rankIndexes } from "@/lib/fuzzy";
import {
  BACKDROP,
  HEADER_ROW,
  INPUT,
  LABEL,
  PANEL,
  PANEL_NARROW,
  ROW,
  STATUS,
} from "@/lib/overlay-styles";
import type { PaletteEntry } from "@/lib/palette";

interface CommandPaletteProps {
  entries: PaletteEntry[];
  onClose: () => void;
}

/**
 * Type a few letters of what you want done, and Enter does it.
 *
 * The finder's shape over commands rather than notes: the list is the answer
 * and the input only narrows it. Each row prints the key that does the same,
 * so reaching for the palette is also how the keys get learned.
 */
export function CommandPalette({ entries, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  const listId = useId();

  const candidates = useMemo(() => lineCandidates(entries.map((entry) => entry.label)), [entries]);
  const shown = useMemo(
    () => rankIndexes(candidates, query.trim()).flatMap((index) => entries[index] ?? []),
    [candidates, entries, query],
  );
  const cursor = Math.min(active, Math.max(shown.length - 1, 0));

  // Focus handed back to whatever held it, which is what an edit or an insert
  // writes into once the palette has gone.
  useEffect(() => {
    const opener = document.activeElement;
    field.current?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  function accept(entry: PaletteEntry | undefined) {
    if (entry === undefined) return;
    onClose();
    entry.run();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const tab = event.key === "Tab";
    const down =
      event.key === "ArrowDown" || (tab && !event.shiftKey) || (event.ctrlKey && event.key === "n");
    const up =
      event.key === "ArrowUp" || (tab && event.shiftKey) || (event.ctrlKey && event.key === "p");

    if (down || up) {
      event.preventDefault();
      if (shown.length === 0) return;
      setActive(down ? Math.min(cursor + 1, shown.length - 1) : Math.max(cursor - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      accept(shown[cursor]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Run a command"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={BACKDROP}
    >
      <div className={`${PANEL} ${PANEL_NARROW}`}>
        <div className={HEADER_ROW}>
          <label htmlFor={`${listId}-query`} className={LABEL}>
            command
          </label>
          <input
            id={`${listId}-query`}
            ref={field}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            role="combobox"
            aria-expanded={shown.length > 0}
            aria-controls={listId}
            aria-activedescendant={shown.length > 0 ? `${listId}-${cursor}` : undefined}
            autoComplete="off"
            spellCheck={false}
            className={INPUT}
          />
        </div>
        <div id={listId} role="listbox" aria-label="Commands" className="overflow-auto py-1">
          {shown.map((entry, index) => (
            <button
              key={entry.label}
              id={`${listId}-${index}`}
              type="button"
              role="option"
              aria-selected={index === cursor}
              tabIndex={-1}
              onClick={() => accept(entry)}
              className={`${ROW} flex justify-between gap-3 ${
                index === cursor ? "bg-one-hover text-one-accent" : "text-one-fg"
              }`}
            >
              <span className="truncate">{entry.label}</span>
              {entry.keys !== undefined && (
                <span className="shrink-0 text-one-muted">{entry.keys}</span>
              )}
            </button>
          ))}
        </div>
        <output className={STATUS}>{shown.length === 0 ? "no commands match" : ""}</output>
      </div>
    </div>
  );
}
