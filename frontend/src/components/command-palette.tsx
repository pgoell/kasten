import type { EditorView } from "@codemirror/view";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { AgentRow } from "@/components/todo/todo-pane";
import { askLogConfig, logConfig, subscribeLogConfig } from "@/lib/log/log-config";
import { DEFAULT_CONFIG } from "@/lib/log/log-kinds";
import { lineCandidates, rankIndexes } from "@/lib/search/fuzzy";
import type { TreeCommands } from "@/lib/ui/keys/key-bindings";
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
} from "@/lib/ui/overlay-styles";
import { type PaletteEntry, paletteEntries } from "@/lib/ui/palette";

interface CommandPaletteProps {
  entries: PaletteEntry[];
  onClose: () => void;
}

/** 1 for a key that moves the highlight down, -1 for up, 0 for any other. */
function stepOf(event: React.KeyboardEvent): number {
  const tab = event.key === "Tab";
  const down =
    event.key === "ArrowDown" || (tab && !event.shiftKey) || (event.ctrlKey && event.key === "n");
  if (down) return 1;
  const up =
    event.key === "ArrowUp" || (tab && event.shiftKey) || (event.ctrlKey && event.key === "p");
  return up ? -1 : 0;
}

/** The finder's shape over commands: the input only narrows the list, and each row prints its key. */
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
    const step = stepOf(event);
    if (step !== 0) {
      event.preventDefault();
      if (shown.length === 0) return;
      setActive(Math.min(Math.max(cursor + step, 0), shown.length - 1));
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
      {...closeOnBackdrop(onClose)}
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
              className={`${ROW} ${TAP} flex justify-between gap-3 ${
                index === cursor ? "bg-k-surface text-k-accent" : "text-k-ink"
              }`}
            >
              <span className="truncate">{entry.label}</span>
              {entry.keys !== undefined && (
                <span className="shrink-0 text-k-muted">{entry.keys}</span>
              )}
            </button>
          ))}
        </div>
        <output className={STATUS}>{shown.length === 0 ? "no commands match" : ""}</output>
      </div>
    </div>
  );
}

/** The editor the palette opened over, or null; `row` is the todo pane's cursor row at the open. */
export interface PaletteAt {
  view: EditorView | null;
  row: AgentRow | null;
}

interface RoutePaletteProps {
  at: PaletteAt | null;
  commands: TreeCommands;
  agentTodo: (hit: AgentRow["hit"], twins?: number[]) => unknown;
  onClose: () => void;
}

/** The home route's palette, mounted while closed too so the log config is asked for on the route's mount. */
export function RoutePalette({ at, commands, agentTodo, onClose }: RoutePaletteProps) {
  // The palette reads the same store as the cards, so its `Log` rows and each
  // card's kinds follow log.md together. The palette asks on mount, since it draws
  // the config with no card to ask for it. A failed read keeps the last kinds, and
  // a missing note gives the defaults.
  const config = useSyncExternalStore(subscribeLogConfig, logConfig);
  useEffect(askLogConfig, []);
  const kinds = (config ?? DEFAULT_CONFIG).kinds;

  // The palette's rows, built only while it is open. One array per open,
  // because the palette ranks its rows again whenever `entries` arrives new and
  // an event renders the route under it (#592).
  const entries = useMemo(() => {
    if (at === null) return null;
    const listed = paletteEntries(commands, at.view, kinds);
    const row = at.row;
    if (row === null) return listed;
    // The pane's `@`, which is no leader key and so in no list above: named
    // here so the palette finds it by name and teaches the key, as it does the
    // rest. Only over the todo pane, the one place there is a row to act on.
    return [
      ...listed,
      {
        label: "Send the todo under the cursor to the agent, or take it back",
        keys: "@",
        run: () => void agentTodo(row.hit, row.twins),
      },
    ];
  }, [commands, at, agentTodo, kinds]);
  return entries && <CommandPalette entries={entries} onClose={onClose} />;
}
