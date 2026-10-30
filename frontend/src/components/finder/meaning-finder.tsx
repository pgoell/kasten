import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { type RankedAnswer, rankedSearch } from "@/lib/api";
import { noteName } from "@/lib/note-path";
import {
  BACKDROP,
  closeOnBackdrop,
  HEADER_ROW,
  INPUT,
  LABEL,
  PANEL,
  PANEL_NARROW,
  ROW,
  STATUS,
  TAP,
} from "@/lib/overlay-styles";

interface MeaningFinderProps {
  /** Also search the archive folder, as the tree's toggle does. */
  archive: boolean;
  onOpen: (path: string) => void;
  onClose: () => void;
}

/** Each ask embeds the query, so wait for typing to pause first. */
const SETTLE_MS = 150;

/** The status line: how much of the index answered, and why a list is empty. */
export function rankedHint(
  answer: RankedAnswer | undefined,
  typed: string,
  failed: boolean,
  pending = false,
): string {
  if (failed) return "the ranked search failed";
  if (answer === undefined) return pending ? "searching" : "";
  const parts: string[] = [];
  if (answer.indexed < answer.notes) {
    parts.push(`index holds ${answer.indexed} of ${answer.notes} notes, still filling`);
  }
  if (!answer.meaning) parts.push("by words only, the model is loading or off");
  // A held answer is the previous query's: its emptiness says nothing of this one.
  if (pending) parts.push("searching");
  else if (typed !== "" && answer.hits.length === 0) parts.push("no notes match");
  return parts.join("; ");
}

/** Walk keys, matching the note finder. Bare letters belong to the query. */
function stepOf(event: React.KeyboardEvent): -1 | 0 | 1 {
  const tab = event.key === "Tab";
  const ctrl = (key: string) => event.ctrlKey && event.key === key;
  if (event.key === "ArrowDown" || (tab && !event.shiftKey) || ctrl("n") || ctrl("j")) return 1;
  if (event.key === "ArrowUp" || (tab && event.shiftKey) || ctrl("p") || ctrl("k")) return -1;
  return 0;
}

/** The note finder's keys over the ranked list; each row shows its best-matching piece. */
export function MeaningFinder({ archive, onOpen, onClose }: MeaningFinderProps) {
  const [query, setQuery] = useState("");
  const [settled, setSettled] = useState("");
  const [active, setActive] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  const opening = useRef(false);
  const listId = useId();
  const typed = query.trim();

  useEffect(() => {
    const timer = setTimeout(() => setSettled(typed), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [typed]);

  // Asked with a blank query too, so the hint shows index progress before typing.
  // The key holds the query, so an old answer never shows as the new one's.
  const ranked = useQuery({
    queryKey: ["ranked", settled, archive],
    queryFn: () => rankedSearch(settled, archive),
    placeholderData: keepPreviousData,
    retry: false,
  });
  const hits = settled === "" ? [] : (ranked.data?.hits ?? []);
  const cursor = Math.min(active, Math.max(hits.length - 1, 0));
  const highlighted = hits[cursor];

  // The note finder's focus rule: take it, hand it back unless a note opened.
  useEffect(() => {
    const opener = document.activeElement;
    field.current?.focus();
    return () => {
      if (opening.current) return;
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  function accept(path: string | undefined) {
    if (path === undefined) return;
    opening.current = true;
    onOpen(path);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const step = stepOf(event);
    if (step !== 0) {
      event.preventDefault();
      if (hits.length === 0) return;
      setActive(Math.min(Math.max(cursor + step, 0), hits.length - 1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      accept(highlighted?.path);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Find by meaning"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      {...closeOnBackdrop(onClose)}
      className={BACKDROP}
    >
      <div className={`${PANEL} ${PANEL_NARROW}`}>
        <div className={HEADER_ROW}>
          <label htmlFor={`${listId}-query`} className={LABEL}>
            find by meaning
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
            aria-expanded={hits.length > 0}
            aria-controls={listId}
            aria-activedescendant={hits.length > 0 ? `${listId}-${cursor}` : undefined}
            autoComplete="off"
            spellCheck={false}
            className={INPUT}
          />
        </div>

        {hits.length > 0 && (
          <div id={listId} role="listbox" aria-label="Notes" className="min-h-0 overflow-auto py-1">
            {hits.map((hit, index) => (
              <button
                key={hit.path}
                id={`${listId}-${index}`}
                type="button"
                role="option"
                aria-selected={index === cursor}
                tabIndex={-1}
                onClick={() => accept(hit.path)}
                className={`${ROW} ${TAP} block ${
                  index === cursor ? "bg-k-surface text-k-accent" : "text-k-ink"
                }`}
              >
                <span className="flex gap-3">
                  <span className="max-w-full shrink-0 truncate">{noteName(hit.path)}</span>
                  <span className="ml-auto min-w-0 truncate text-k-muted">{hit.heading}</span>
                </span>
                <span className="line-clamp-2 text-[12px] text-k-muted">{hit.text}</span>
              </button>
            ))}
          </div>
        )}

        <output className={STATUS}>
          {rankedHint(
            ranked.data,
            settled,
            ranked.isError,
            ranked.isPlaceholderData || settled !== typed,
          )}
        </output>
      </div>
    </div>
  );
}
