import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { fetchHistory, fetchHistoryText, fetchNote, type HistoryChange } from "@/lib/api";
import { lineDiff } from "@/lib/diff";
import { unstamped } from "@/lib/held-text";
import { type EditorCommands, heldModifier, leaderAction, leaderPrefix } from "@/lib/key-bindings";
import { noteName } from "@/lib/note-path";

interface HistoryPaneProps {
  /** Vault path of the note whose changes this lists. */
  note: string;
  /** What a leader sequence reaches. The same object every other pane is given. */
  commands: EditorCommands;
  /** Raised when the pane this sits in has been moved to. See `Editor`. */
  focusSignal?: number;
  /**
   * Write `text`, the note at jj change `from`, over the note, naming `against`
   * as the text on disk, and answer null once it landed or the reason it did
   * not. The route owns it, because the route owns the write queue and knows
   * what else is writing.
   */
  onRestore: (text: string, against: string, from: string) => Promise<string | null>;
}

const LABEL = "shrink-0 text-[11px] tracking-wide text-one-muted uppercase";

/** A change's time in the reader's own zone and words. */
function when(time: string): string {
  return new Date(time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * A note's jj changes beside it, one shown as a diff against the note now, and
 * a key that writes that change back.
 *
 * The note's text is read under the key the editor reads it by, so a save
 * anywhere, the restore included, redraws the diff with no plumbing of its
 * own; the list sits under that key too, so the vault's events reach it.
 */
export function HistoryPane({ note, commands, focusSignal, onRestore }: HistoryPaneProps) {
  const panel = useRef<HTMLElement>(null);
  /** The keys of an unfinished leader sequence, starting with the space. */
  const [pending, setPending] = useState("");
  // Both by commit and not by row: a write lands a new change on top, and a
  // row index would then point at another change than the one on screen.
  // Undefined is the newest, which is where the pane opens.
  /** The commit of the row the keys move. */
  const [cursorAt, setCursorAt] = useState<string>();
  /** The commit whose diff is drawn, which Enter, a click or a tap moves here. */
  const [pickedAt, setPickedAt] = useState<string>();
  const [said, setSaid] = useState<string | null>(null);

  // A freshly focused pane takes the cursor, the way the person pane does.
  useEffect(() => {
    if (focusSignal) panel.current?.focus();
  }, [focusSignal]);

  const history = useQuery({
    queryKey: ["note", note, "history"],
    queryFn: () => fetchHistory(note),
  });
  const now = useQuery({ queryKey: ["note", note], queryFn: () => fetchNote(note) });
  const changes = history.data?.changes ?? [];
  const rowOf = (commit: string | undefined) =>
    Math.max(
      changes.findIndex((each) => each.commit === commit),
      0,
    );
  const cursor = rowOf(cursorAt);
  const picked = rowOf(pickedAt);
  const change: HistoryChange | undefined = changes[picked];
  // Under its own key: the text at a commit never changes, so no write needs
  // to read it again.
  const version = useQuery({
    queryKey: ["history-text", change?.path, change?.commit],
    queryFn: () => fetchHistoryText(change?.path ?? "", change?.commit ?? ""),
    enabled: change !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const old = version.data;
  const against = now.data;
  const same = old !== undefined && against !== undefined && unstamped(old) === unstamped(against);
  const ready = old !== undefined && against !== undefined && !same;

  function pick(at: number) {
    const commit = changes[at]?.commit;
    setCursorAt(commit);
    setPickedAt(commit);
    setSaid(null);
  }

  function move(by: number) {
    const at = Math.min(Math.max(cursor + by, 0), Math.max(changes.length - 1, 0));
    setCursorAt(changes[at]?.commit);
  }

  async function restore() {
    if (!ready || change === undefined) return;
    setSaid(await onRestore(old, against, change.change));
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const { key } = event;

    if (heldModifier(key)) return;

    if (pending) {
      const sequence = pending + key;
      const wanted = sequence.slice(1);
      const run = leaderAction(wanted, commands);
      setPending(!run && leaderPrefix(wanted) ? sequence : "");

      if (run) {
        event.preventDefault();
        run();
      }
      return;
    }

    // Ahead of the modifier check below: ctrl+enter is the backlinks panel's
    // key for its one write too (#424), so the two read the same.
    if (key === "Enter" && event.ctrlKey) {
      event.preventDefault();
      void restore();
      return;
    }

    if (event.ctrlKey || event.altKey || event.metaKey) return;

    switch (key) {
      case " ":
        setPending(key);
        break;
      case "j":
      case "ArrowDown":
        move(1);
        break;
      case "k":
      case "ArrowUp":
        move(-1);
        break;
      case "Enter":
        pick(cursor);
        break;
      case "q":
      case "Escape":
        commands.closeNote();
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  const empty = history.isError
    ? "The history could not be read"
    : history.data?.versioned === false
      ? "This vault keeps no history"
      : history.data !== undefined && changes.length === 0
        ? "This note has no history yet"
        : null;

  const line =
    said ??
    (version.isError
      ? "This change could not be read"
      : same
        ? "This change is the note as it is now"
        : null);

  return (
    <section
      ref={panel}
      data-history-pane
      // Focusable but out of the tab order, the way every other pane holds the
      // cursor.
      tabIndex={-1}
      onKeyDown={onKeyDown}
      aria-label="history"
      className="flex h-full flex-col bg-one-bg font-mono outline-none"
    >
      <header className="flex items-center gap-3 border-b border-one-line px-3 py-1">
        <span className={LABEL}>history</span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-one-fg" title={note}>
          {noteName(note)}
        </span>
      </header>

      {empty !== null ? (
        <p className="px-3 py-2 text-[13px] text-one-muted">{empty}</p>
      ) : (
        <>
          <div
            role="listbox"
            aria-label="changes"
            className="max-h-[40%] shrink-0 overflow-y-auto border-b border-one-line"
          >
            {changes.map((each, at) => (
              <button
                key={each.commit}
                type="button"
                role="option"
                aria-selected={at === cursor}
                aria-current={at === picked}
                tabIndex={-1}
                onClick={() => pick(at)}
                className={`flex w-full flex-col px-3 py-1 text-left text-[13px] pointer-coarse:min-h-11 ${
                  at === cursor ? "bg-one-selection" : ""
                } ${at === picked ? "text-one-accent" : "text-one-fg"}`}
              >
                <span>
                  <span className="text-one-muted">{when(each.time)}</span>{" "}
                  {each.description || each.change}
                </span>
                {each.path !== note && (
                  <span className="text-[11px] text-one-muted">was {each.path}</span>
                )}
              </button>
            ))}
          </div>

          <div
            data-testid="history-diff"
            className="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-[13px] whitespace-pre-wrap"
          >
            {old !== undefined &&
              against !== undefined &&
              lineDiff(against, old).map((row, at) => (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: lines repeat, and the list is redrawn whole.
                  key={at}
                  className={
                    row.op === " "
                      ? "text-one-muted"
                      : row.op === "-"
                        ? "text-one-warn"
                        : "text-one-green"
                  }
                >
                  <span className="select-none">{row.op}</span>
                  {row.text}
                </div>
              ))}
          </div>

          <footer className="flex items-center gap-3 border-t border-one-line px-3 py-1">
            <output className="min-w-0 flex-1 truncate text-[12px] text-one-muted">{line}</output>
            <button
              type="button"
              disabled={!ready}
              onClick={() => void restore()}
              className="shrink-0 px-2 text-[12px] text-one-accent disabled:text-one-muted pointer-coarse:min-h-11"
            >
              Restore
            </button>
          </footer>
        </>
      )}
    </section>
  );
}
