import { useEffect, useRef, useState } from "react";
import { PersonCard } from "@/components/person-card";
import { type EditorCommands, heldModifier, leaderAction, leaderPrefix } from "@/lib/key-bindings";
import { noteName } from "@/lib/note-path";

interface PersonPaneProps {
  /** Vault path of the person note this pane is about. */
  person: string;
  /** What a leader sequence reaches. The same object every other pane is given. */
  commands: EditorCommands;
  /** Every path in the vault, which is what turns a link's name into a path. */
  paths?: string[];
  /** Whether the archive is in the answer, which the route holds and one key flips. */
  archive?: boolean;
  /** Raised when the pane this sits in has been moved to. See `Editor`. */
  focusSignal?: number;
  /** Called with the note to open and the line the row names. */
  onOpen: (path: string, line: number) => void;
}

const LABEL = "shrink-0 text-[11px] tracking-wide text-one-muted uppercase";

/**
 * One person's card, in a pane beside the note you are writing.
 *
 * The same card the person's own note carries at its foot, put where it can
 * stay while you work somewhere else. A pane and not an overlay for that one
 * reason: an overlay is something you dismiss, and what is open on this person
 * is worth keeping on screen next to the note that made you ask.
 */
export function PersonPane({
  person,
  commands,
  paths,
  archive,
  focusSignal,
  onOpen,
}: PersonPaneProps) {
  const panel = useRef<HTMLElement>(null);
  /** The keys of an unfinished leader sequence, starting with the space. */
  const [pending, setPending] = useState("");

  // A freshly focused pane is handed a raised signal and takes the cursor, the
  // way the image pane and the todo pane do. It has to: the pane holds no
  // CodeMirror, so without this the keys would keep going to whichever pane the
  // browser last left the cursor in.
  useEffect(() => {
    if (focusSignal) panel.current?.focus();
  }, [focusSignal]);

  // The leader block every pane that holds no editor carries its own copy of.
  // Nothing is bound bare: a card is a thing to read, and every key that does
  // something to it is somewhere else.
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

    if (event.ctrlKey || event.altKey || event.metaKey) return;

    if (key === " ") {
      setPending(key);
      event.preventDefault();
    }
  }

  return (
    <section
      ref={panel}
      data-person-pane
      // Focusable but out of the tab order, the way every other pane holds the
      // cursor.
      tabIndex={-1}
      onKeyDown={onKeyDown}
      aria-label="person"
      className="flex h-full flex-col bg-one-bg font-mono outline-none"
    >
      <header className="flex items-center gap-3 border-b border-one-line px-3 py-1">
        <span className={LABEL}>person</span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-one-fg" title={person}>
          {noteName(person)}
        </span>
      </header>

      <div className="min-h-0 flex-1">
        <PersonCard person={person} paths={paths} archive={archive} onOpen={onOpen} />
      </div>
    </section>
  );
}
