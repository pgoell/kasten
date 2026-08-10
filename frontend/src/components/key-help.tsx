import { useEffect, useRef } from "react";
import {
  FOLLOW,
  FORMAT,
  INDENT,
  LEADER,
  LEADER_EDITS,
  TAB_KEYS,
  TERMINAL,
  TERMINAL_CHORD,
  TODO_PANE,
  TREE,
} from "@/lib/key-bindings";

/** Vim's spelling of a key is for vim. This is the one on the keyboard. */
function readable(key: string) {
  return key
    .replace(/^<|>$/g, "")
    .replace("C-", "Ctrl ")
    .replace("S-", "Shift ")
    .replace(/-/g, " ");
}

/**
 * `Ctrl Shift H`, built from `TERMINAL_CHORD` so the panel follows a retune.
 *
 * `readable` above rewrites vim's spellings and does nothing to a bare `"H"`,
 * which is what a terminal chord is written as, so this is the second one.
 */
function chordLabel(key: string): string {
  const held = [
    TERMINAL_CHORD.ctrlKey && "Ctrl",
    TERMINAL_CHORD.altKey && "Alt",
    TERMINAL_CHORD.shiftKey && "Shift",
    TERMINAL_CHORD.metaKey && "Meta",
  ].filter((word) => word !== false);

  return [...held, key].join(" ");
}

interface Group {
  title: string;
  keys: readonly { key: string; label: string }[];
}

function Table({ title, keys }: Group) {
  return (
    <section>
      <h3 className="mb-2 text-[11px] tracking-wider text-one-muted uppercase">{title}</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
        {keys.map(({ key, label }) => (
          <div key={key} className="contents">
            <dt className="text-right whitespace-nowrap text-one-accent">{key}</dt>
            <dd className="text-one-fg">{label}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * The whole key map, on one panel behind `<leader>?`.
 *
 * Everything on it is read from `key-bindings.ts`, the same table the vim
 * registrations are built from, so a key cannot appear here and be missing
 * from the editor.
 */
export function KeyHelp({ onClose }: { onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);

  // The panel takes the focus so its own keys reach it, rather than reaching
  // whatever was focused when it opened, and hands it back on the way out.
  // Restoring what held it beats naming the editor: the same key opens this
  // from the file tree, and closing there belongs back in the tree.
  useEffect(() => {
    const opener = document.activeElement;
    panel.current?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  const groups: Group[] = [
    {
      title: "Leader",
      // A leader key can be more than one letter, and the letters are spaced so
      // that `cf` reads as the two presses it is rather than as one key.
      keys: [
        // Two tables, one group. The keys are pressed the same way; what
        // divides them is that these write to the note rather than naming a
        // command the route provides, and nobody reading the panel cares.
        ...[...LEADER, ...LEADER_EDITS].map(({ key, label }) => ({
          key: `Space ${[...key].join(" ")}`,
          label,
        })),
        // The ten digits on one row. Ten rows carrying the same sentence would
        // bury every other key on the panel.
        {
          key: `Space ${TAB_KEYS[0]} … ${TAB_KEYS[TAB_KEYS.length - 1]}`,
          label: "Go to a tab by number",
        },
      ],
    },
    {
      title: "Editor",
      keys: [
        ...FORMAT.map(({ key, label }) => ({ key: readable(key), label })),
        ...INDENT,
        ...FOLLOW,
      ],
    },
    // Its own group because these are not leader keys and cannot be: the leader
    // is the space bar and a shell must receive the space bar.
    {
      title: "Terminal",
      keys: TERMINAL.map(({ key, label }) => ({ key: chordLabel(key), label })),
    },
    { title: "File tree", keys: TREE },
    { title: "Todos", keys: TODO_PANE },
  ];

  return (
    <div
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== "Escape" && event.key !== "q") return;
        event.preventDefault();
        onClose();
      }}
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 focus:outline-none"
    >
      <div className="max-h-[80vh] overflow-auto rounded-md border border-one-line bg-one-panel px-6 py-5 font-mono shadow-xl">
        <div className="flex flex-col gap-5">
          {groups.map((group) => (
            <Table key={group.title} {...group} />
          ))}
        </div>
        <p className="mt-5 text-[11px] text-one-muted">Escape or q to close</p>
      </div>
    </div>
  );
}
