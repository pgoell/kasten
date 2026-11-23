import { useEffect, useRef, useState } from "react";
import { Popover } from "@/components/todo/view/pick/popover";
import { Icon } from "@/components/todo/view/view-icons";
import { noteName } from "@/lib/notes/links/note-path";

const SHOWN = 8;

/** The notes whose name or path holds what is typed, names that start with it first. */
export function notesMatching(files: string[], typed: string): string[] {
  const word = typed.trim().toLowerCase();
  const notes = files.filter((path) => path.endsWith(".md"));
  if (word === "") return notes.slice(0, SHOWN);
  const starts = (path: string) => (noteName(path).toLowerCase().startsWith(word) ? 0 : 1);
  return notes
    .filter((path) => path.toLowerCase().includes(word))
    .sort((a, b) => starts(a) - starts(b) || a.length - b.length)
    .slice(0, SHOWN);
}

/** A note picked by typing part of its name: the arrows move, Enter picks. */
export function NotePick(props: {
  anchor: HTMLElement | null;
  files: string[];
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const found = notesMatching(props.files, typed);
  const pick = (path: string | undefined) => {
    if (path === undefined) return;
    props.onPick(path);
    props.onClose();
  };
  const onKey = (event: React.KeyboardEvent) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step !== undefined) setAt((now) => (now + step + found.length) % Math.max(found.length, 1));
    else if (event.key === "Enter") pick(found[at]);
    else return false;
    return true;
  };

  return (
    <Popover anchor={props.anchor} label="Link a note" onClose={props.onClose} onKey={onKey}>
      <label className="mx-1 flex items-center gap-2 border-k-rule border-b py-1.5 text-k-muted">
        <Icon name="filter" />
        <input
          ref={input}
          aria-label="Find a note"
          value={typed}
          placeholder="Find a note"
          onChange={(event) => {
            setTyped(event.target.value);
            setAt(0);
          }}
          className="min-w-0 flex-1 bg-transparent text-k-ink outline-none placeholder:text-k-muted"
        />
      </label>
      <ul aria-label="Notes" className="mt-1">
        {found.map((path, index) => (
          <li key={path}>
            <button
              type="button"
              onClick={() => pick(path)}
              onPointerEnter={() => setAt(index)}
              className={`flex h-9 w-full items-center gap-2.5 rounded-md px-2 text-left text-[15px] ${
                index === at ? "bg-k-inset" : ""
              }`}
            >
              <Icon name="doc" className="text-k-muted" />
              <span className="truncate text-k-ink">{noteName(path)}</span>
              <span className="ml-auto truncate text-k-muted text-sm">
                {path.slice(0, path.lastIndexOf("/"))}
              </span>
            </button>
          </li>
        ))}
        {found.length === 0 && (
          <li className="px-2 py-2 text-k-muted text-sm">No note by that name.</li>
        )}
      </ul>
    </Popover>
  );
}
