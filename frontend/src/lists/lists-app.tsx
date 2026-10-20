import { type KeyboardEvent, useEffect, useRef, useState, useSyncExternalStore } from "react";
import "../styles/lists.css";
import {
  createListsStore,
  type Item,
  LISTS,
  type ListsStore,
  suggestionsFor,
  viewOf,
} from "./lists-store";

export function ListsApp() {
  const [store, setStore] = useState<ListsStore | null>(null);

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
  const [draft, setDraft] = useState("");
  const field = useRef<HTMLInputElement>(null);

  const items = viewOf(snap, current);
  const open = items.filter((item) => !item.done);
  const done = items.filter((item) => item.done);
  const loaded = snap.lists[current] !== undefined;
  const chips = suggestionsFor(snap, current, draft);

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

  return (
    <div className="app">
      <header className="top">
        {/* biome-ignore lint/a11y/useSemanticElements: a segmented control, not a form group */}
        <div className="segment" role="group" aria-label="Liste">
          {LISTS.map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={name === current}
              onClick={() => setCurrent(name)}
            >
              {name}
            </button>
          ))}
        </div>
        {!snap.online && <p className="status pill">Offline, wird gesendet</p>}
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
            {keyed(open).map((item) => (
              <Row
                key={item.key}
                item={item}
                onToggle={() => store.tick(current, item.text, true)}
              />
            ))}
          </section>
        )}

        {done.length > 0 && (
          <section className="done" aria-label="Erledigt">
            <div className="group-head">
              <h2>Erledigt</h2>
              <button type="button" onClick={() => store.clear(current)}>
                Leeren
              </button>
            </div>
            <div className="group">
              {keyed(done).map((item) => (
                <Row
                  key={item.key}
                  item={item}
                  onToggle={() => store.tick(current, item.text, false)}
                />
              ))}
            </div>
          </section>
        )}
      </main>

      <footer className="composer">
        {chips.length > 0 && (
          // biome-ignore lint/a11y/useSemanticElements: a row of suggestion chips, not a form group
          <div className="chips" role="group" aria-label="Vorschläge">
            {chips.map((text) => (
              <button key={text} type="button" className="chip" onClick={() => take(text)}>
                {text}
              </button>
            ))}
          </div>
        )}
        <input
          ref={field}
          className="field"
          type="text"
          aria-label="Neuer Eintrag"
          placeholder="Eintrag"
          enterKeyHint="done"
          autoComplete="off"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKey}
        />
      </footer>
    </div>
  );
}

/**
 * Keys by text, with a count for repeats. Not by line: an optimistic row has
 * line -1, and the server's answer gives it a real one, which would remount
 * the row and leave a node a caller is holding detached.
 */
function keyed(items: Item[]): (Item & { key: string })[] {
  const count = new Map<string, number>();
  return items.map((item) => {
    const n = count.get(item.text) ?? 0;
    count.set(item.text, n + 1);
    return { ...item, key: `${item.text}#${n}` };
  });
}

function Row({ item, onToggle }: { item: Item; onToggle: () => void }) {
  return (
    // A list row is a button a thumb can hit, which a native checkbox with its
    // own label would not give.
    // biome-ignore lint/a11y/useSemanticElements: the whole row is the tap target
    <button
      type="button"
      role="checkbox"
      aria-checked={item.done}
      className="row"
      onClick={onToggle}
    >
      <span className="check" aria-hidden="true" />
      <span className="text">{item.text}</span>
    </button>
  );
}
