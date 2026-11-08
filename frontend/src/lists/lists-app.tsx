import { type KeyboardEvent, useEffect, useRef, useState, useSyncExternalStore } from "react";
import "../styles/lists.css";
import { followScheme } from "./follow-scheme";
import { personOf } from "./lists-person";
import { Row } from "./lists-row";
import { createListsStore, type Item, LISTS, type ListsStore, type Snapshot } from "./lists-store";
import { countOf, type Group, groupsOf, suggestionsFor, viewOf, without } from "./lists-view";
import { tickLine } from "./tick-line";

/** The done items shown before "Erledigt" is unfolded. */
const FOLDED = 3;

/** How long a delete waits for Rückgängig before it is sent. */
const UNDO_MS = 5000;

/** A delete the person can still take back. */
type Pending = { list: string; text: string };

type Keyed = Item & { key: string };

export function ListsApp() {
  const [store, setStore] = useState<ListsStore | null>(null);

  // The page follows the phone's scheme while it is open; the stop runs on unmount.
  useEffect(() => followScheme(), []);

  useEffect(() => {
    // Made here and not at import: StrictMode runs this effect twice, and the
    // store the first run made is closed by its cleanup before the second.
    const next = createListsStore();
    setStore(next);
    return () => next.close();
  }, []);

  return store ? <Lists store={store} /> : null;
}

function Lists({ store }: { store: ListsStore }) {
  const snap = useSyncExternalStore(store.subscribe, store.snapshot);
  const [current, setCurrent] = useState<string>("Einkauf");
  const [mine, setMine] = useState(false);
  const [unfolded, setUnfolded] = useState(false);
  // The one chip whose menu is open, by its row's key. A second menu cannot open.
  const [menu, setMenu] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // The item the Eintrag field adds a part to, by its words, or null for an item of its own.
  const [under, setUnder] = useState<string | null>(null);
  // Items with their parts folded away, by row key. Parts show by default.
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<Pending | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const field = useRef<HTMLInputElement>(null);
  const now = Date.now();

  // A delete still waiting is sent when the next one comes or the screen goes, never dropped.
  const sendPending = useRef<() => void>(() => undefined);
  sendPending.current = () => {
    clearTimeout(timer.current);
    if (pending) store.remove(pending.list, pending.text);
    setPending(null);
  };
  useEffect(() => () => sendPending.current(), []);

  // "Meine": the items for you, and the ones for nobody. With no name read, that is the nobody ones.
  const shown = (item: Item) => {
    const name = personOf(item.assignee);
    return !mine || name === null || name === snap.me;
  };
  const all = viewOf(snap, current);
  const groups = groupsOf(
    pending && pending.list === current ? without(all, pending.text) : all,
  ).filter(({ item, parts }) => shown(item) || parts.some(shown));
  const open = groups.filter(({ item }) => !item.done);
  const done = latestFirst(groups.filter(({ item }) => item.done));
  const loaded = snap.lists[current] !== undefined;
  const chips = suggestionsFor(snap, current, draft);

  function choose(name: string): void {
    setCurrent(name);
    setMenu(null);
    setUnder(null);
  }

  function add(text: string): void {
    const clean = text.trim();
    if (clean) store.add(current, clean, under ?? undefined);
  }

  function remove(text: string): void {
    sendPending.current();
    setPending({ list: current, text });
    timer.current = setTimeout(() => sendPending.current(), UNDO_MS);
  }

  function undo(): void {
    clearTimeout(timer.current);
    setPending(null);
  }

  function fold(key: string): void {
    setFolded((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  function take(text: string): void {
    add(text);
    setDraft("");
    field.current?.focus();
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Escape") setUnder(null);
    // Enter picks a candidate in a Japanese or Chinese input method; that is not a submit.
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    add(draft);
    setDraft("");
  }

  function rowOf(item: Keyed, tick: string | null, count: string | null) {
    return (
      <Row
        key={item.key}
        item={item}
        me={snap.me}
        people={snap.people}
        tick={tick}
        count={count}
        folded={folded.has(item.key)}
        open={menu === item.key}
        onToggle={() => store.tick(current, item.text, !item.done)}
        onMenu={(on) => setMenu((prev) => (on ? item.key : prev === item.key ? null : prev))}
        onPick={(name) => store.assign(current, item.text, name, personOf(item.assignee))}
        onEdit={(text) => store.edit(current, item.text, text)}
        onDelete={() => remove(item.text)}
        onFold={() => fold(item.key)}
        onPart={
          item.depth === 0 && !item.done
            ? () => {
                setUnder(item.text);
                field.current?.focus();
              }
            : undefined
        }
      />
    );
  }

  /** An item's row and, unless folded, its parts' rows under it, each with its own count. */
  function groupRows(groups: Group[], prefix: string, withTick: boolean) {
    return keyed(groups, prefix).flatMap(({ key, rows }) =>
      (folded.has(key) ? rows.slice(0, 1) : rows).map((row, n) =>
        rowOf(row, withTick ? tickLine(row, now) : null, countOf(rows, n)),
      ),
    );
  }

  return (
    <div className="app">
      <header className="top">
        <h1>Listen</h1>
        {/* biome-ignore lint/a11y/useSemanticElements: a segmented control, not a form group */}
        <div className="segment" role="group" aria-label="Liste">
          {LISTS.map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={name === current}
              onClick={() => choose(name)}
            >
              {name} <span className="count">{openCount(snap, name)}</span>
            </button>
          ))}
        </div>
        {/* biome-ignore lint/a11y/useSemanticElements: a segmented control, not a form group */}
        <div className="segment" role="group" aria-label="Anzeige">
          <button type="button" aria-pressed={!mine} onClick={() => setMine(false)}>
            Alle
          </button>
          <button type="button" aria-pressed={mine} onClick={() => setMine(true)}>
            Meine
          </button>
        </div>
        {!snap.online && <p className="status pill">Offline, wird gesendet</p>}
        {snap.signIn && <p className="status pill">Anmelden nötig</p>}
        {snap.online && snap.queue.length > 0 && <p className="status">Wird gesendet</p>}
      </header>

      {snap.errors.length > 0 && (
        <div className="error" role="alert">
          <div>
            {snap.errors.map((message) => (
              <p key={message}>{message}</p>
            ))}
          </div>
          <button type="button" onClick={store.dismissErrors}>
            Schließen
          </button>
        </div>
      )}

      <main className="lists">
        {loaded && open.length === 0 && done.length === 0 && (
          <p className="empty">Nichts auf der Liste</p>
        )}

        {open.length > 0 && (
          <section className="group" aria-label="Offen">
            {groupRows(open, "open", false)}
          </section>
        )}

        {done.length > 0 && (
          <section className="done" aria-label="Erledigt">
            <div className="group-head">
              <h2>
                <button
                  type="button"
                  aria-expanded={unfolded}
                  onClick={() => setUnfolded(!unfolded)}
                >
                  Erledigt <span className="count">{done.length}</span>
                </button>
              </h2>
              <button type="button" onClick={() => store.clear(current)}>
                Leeren
              </button>
            </div>
            <div className="group">
              {groupRows(unfolded ? done : done.slice(0, FOLDED), "done", true)}
            </div>
          </section>
        )}
      </main>

      {pending && (
        <div className="undo" role="status">
          <span>„{pending.text}“ gelöscht</span>
          <button type="button" onClick={undo}>
            Rückgängig
          </button>
        </div>
      )}

      <footer className="composer">
        {under !== null && (
          <div className="under">
            <span>Teil von „{under}“</span>
            <button type="button" aria-label="Kein Teil" onClick={() => setUnder(null)}>
              ×
            </button>
          </div>
        )}
        {chips.length > 0 && (
          // biome-ignore lint/a11y/useSemanticElements: a row of suggestion chips, not a form group
          <div className="chips" role="group" aria-label="Vorschläge">
            {chips.map((text) => (
              <button key={text} type="button" className="suggest" onClick={() => take(text)}>
                {text}
              </button>
            ))}
          </div>
        )}
        <div className="entry">
          <input
            ref={field}
            className="field"
            type="text"
            aria-label="Eintrag"
            placeholder={under === null ? "Eintrag" : "Teil"}
            enterKeyHint="done"
            autoComplete="off"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKey}
          />
          <button
            type="button"
            className="add"
            onClick={() => {
              add(draft);
              setDraft("");
            }}
          >
            Hinzufügen
          </button>
        </div>
      </footer>
    </div>
  );
}

/**
 * Keys by text, with a count for repeats, a part's under its item's. Not by line: an optimistic
 * row has line -1, and the server's answer gives it a real one, which would remount the row and
 * leave a node a caller is holding detached. The group is in the key so an open row and a done
 * row of one text do not share a menu.
 */
function keyed(groups: Group[], prefix: string): { key: string; rows: Keyed[] }[] {
  const count = new Map<string, number>();
  const keyOf = (text: string) => {
    const n = count.get(text) ?? 0;
    count.set(text, n + 1);
    return `${text}#${n}`;
  };
  return groups.map(({ item, parts }) => {
    const key = `${prefix}:${keyOf(item.text)}`;
    const rows = [item, ...parts].map((row, n) => ({
      ...row,
      key: n === 0 ? key : `${key}>${keyOf(`${item.text}>${row.text}`)}`,
    }));
    return { key, rows };
  });
}

/** Latest tick first. An item with no time comes after them, in the note's order. */
function latestFirst(groups: Group[]): Group[] {
  return [...groups].sort(({ item: one }, { item: other }) => {
    if (one.ticked_at && other.ticked_at) {
      return Date.parse(other.ticked_at) - Date.parse(one.ticked_at);
    }
    if (one.ticked_at) return -1;
    if (other.ticked_at) return 1;
    return 0;
  });
}

/** The open items of a list, parts not counted, queued writes laid over, for its count in the switch. */
function openCount(snap: Snapshot, list: string): number {
  return viewOf(snap, list).filter((item) => !item.done && item.depth === 0).length;
}
