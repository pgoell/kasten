import { type KeyboardEvent, useEffect, useRef, useState, useSyncExternalStore } from "react";
import "../styles/lists.css";
import { followScheme } from "./follow-scheme";
import { personOf } from "./lists-person";
import { Row } from "./lists-row";
import { createListsStore, type Item, LISTS, type ListsStore, type Snapshot } from "./lists-store";
import { suggestionsFor, viewOf } from "./lists-view";
import { tickLine } from "./tick-line";

/** The done items shown before "Erledigt" is unfolded. */
const FOLDED = 3;

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
  const field = useRef<HTMLInputElement>(null);
  const now = Date.now();

  // "Meine": the items for you, and the ones for nobody. With no name read, that is the nobody ones.
  const shown = (item: Item) => {
    const name = personOf(item.assignee);
    return !mine || name === null || name === snap.me;
  };
  const items = viewOf(snap, current).filter(shown);
  const open = items.filter((item) => !item.done);
  const done = latestFirst(items.filter((item) => item.done));
  const loaded = snap.lists[current] !== undefined;
  const chips = suggestionsFor(snap, current, draft);

  function choose(name: string): void {
    setCurrent(name);
    setMenu(null);
  }

  function add(text: string): void {
    const clean = text.trim();
    if (clean) store.add(current, clean);
  }

  function take(text: string): void {
    add(text);
    setDraft("");
    field.current?.focus();
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>): void {
    // Enter picks a candidate in a Japanese or Chinese input method; that is not a submit.
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    add(draft);
    setDraft("");
  }

  function rowOf(item: Keyed, tick: string | null) {
    return (
      <Row
        key={item.key}
        item={item}
        me={snap.me}
        people={snap.people}
        tick={tick}
        open={menu === item.key}
        onToggle={() => store.tick(current, item.text, !item.done)}
        onMenu={(on) => setMenu((prev) => (on ? item.key : prev === item.key ? null : prev))}
        onPick={(name) => store.assign(current, item.text, name, personOf(item.assignee))}
      />
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
            {keyed(open, "open").map((item) => rowOf(item, null))}
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
              {keyed(unfolded ? done : done.slice(0, FOLDED), "done").map((item) =>
                rowOf(item, tickLine(item, now)),
              )}
            </div>
          </section>
        )}
      </main>

      <footer className="composer">
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
            placeholder="Eintrag"
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
 * Keys by text, with a count for repeats. Not by line: an optimistic row has
 * line -1, and the server's answer gives it a real one, which would remount
 * the row and leave a node a caller is holding detached. The group is in the key
 * so an open row and a done row of one text do not share a menu.
 */
function keyed(items: Item[], group: string): Keyed[] {
  const count = new Map<string, number>();
  return items.map((item) => {
    const n = count.get(item.text) ?? 0;
    count.set(item.text, n + 1);
    return { ...item, key: `${group}:${item.text}#${n}` };
  });
}

/** Latest tick first. An item with no time comes after them, in the note's order. */
function latestFirst(items: Item[]): Item[] {
  return [...items].sort((one, other) => {
    if (one.ticked_at && other.ticked_at) {
      return Date.parse(other.ticked_at) - Date.parse(one.ticked_at);
    }
    if (one.ticked_at) return -1;
    if (other.ticked_at) return 1;
    return 0;
  });
}

/** The open items of a list, queued writes laid over, for its count in the switch. */
function openCount(snap: Snapshot, list: string): number {
  return viewOf(snap, list).filter((item) => !item.done).length;
}
