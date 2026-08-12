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
import { HEADER_ROW, LABEL, PANEL, STATUS } from "@/lib/overlay-styles";

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

/**
 * The ten tab digits, under a name no sequence of leader keys can spell.
 *
 * One row rather than ten, because ten rows carrying the same sentence would
 * bury every other key on the panel. It is looked up by name below like a
 * binding, and the space in the name is what keeps it out of the way of one.
 */
const TAB_DIGITS = "tab digits";

/**
 * The leader's keys, cut into the groups they were designed in.
 *
 * `LEADER` is alphabetical, which is the order for a table nobody reads and
 * the wrong one for a panel somebody scans: `cf`, `df` and `rf` are one job in
 * three places. The order inside a group is this list's. A key named nowhere
 * here falls into the last group rather than off the panel, so a new binding
 * needs no edit in this file to show up.
 */
const LEADER_GROUPS: readonly { title: string; keys: readonly string[] }[] = [
  { title: "Panes", keys: ["%", '"', "h", "j", "k", "l", "o", "q"] },
  { title: "Tabs", keys: ["ct", "tl", "th", TAB_DIGITS] },
  { title: "Notes", keys: ["cf", "rf", "df", "du", "cw", "cm", "w"] },
  { title: "Find", keys: ["ff", "fg", "ft"] },
  { title: "Go to", keys: ["gd", "gw", "gm", "gq", "gy", "gb", "go", "gr", "ge", "gt"] },
  { title: "Todos", keys: ["x", "i", "so", "sp", "sx", "sb", "sr"] },
];

/** The leader groups above, filled from the two tables the keys live in. */
function leaderGroups(): Group[] {
  // A leader key can be more than one letter, and the letters are spaced so
  // that `cf` reads as the two presses it is rather than as one key.
  const rows = new Map(
    [...LEADER, ...LEADER_EDITS].map(({ key, label }) => [
      key,
      { key: `Space ${[...key].join(" ")}`, label },
    ]),
  );
  rows.set(TAB_DIGITS, {
    key: `Space ${TAB_KEYS[0]} … ${TAB_KEYS[TAB_KEYS.length - 1]}`,
    label: "Go to a tab by number",
  });

  const named = LEADER_GROUPS.map(({ title, keys }) => ({
    title,
    keys: keys.flatMap((key) => {
      const row = rows.get(key);
      rows.delete(key);
      return row ? [row] : [];
    }),
  }));

  // Whatever was named nowhere above, in the table's own order: the toggles,
  // the terminal, the formatter and this panel's own key.
  return [...named, { title: "The rest", keys: [...rows.values()] }];
}

function Table({ title, keys }: Group) {
  return (
    // A group is one card and a card never straddles two columns, so the panel
    // reflows as the window changes without cutting a group in half.
    <section className="mb-4 break-inside-avoid">
      <h3 className={`${LABEL} mb-1`}>{title}</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-[13px] leading-snug">
        {keys.map(({ key, label }) => (
          <div key={key} className="contents">
            <dt className="text-right whitespace-nowrap text-one-accent">{key}</dt>
            <dd className="text-one-muted">{label}</dd>
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
 *
 * It is laid out in columns rather than one long list because the map is
 * ninety-odd keys: a single column is a page and a half of scrolling, and the
 * point of the panel is answering a question at a glance.
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
    ...leaderGroups(),
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
    { title: "Todo pane", keys: TODO_PANE },
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
      {/* The finder's panel, wider: this is the fourth thing the app draws over
          the editor and reads as the same object, but it holds a map rather
          than a list, and the width is what keeps the map off a scrollbar. */}
      <div className={`${PANEL} max-h-[88vh] w-[min(84rem,95vw)]`}>
        <div className={HEADER_ROW}>
          <span className={LABEL}>Keys</span>
        </div>
        <div className="min-h-0 columns-1 gap-x-8 overflow-auto px-4 py-3 md:columns-2 xl:columns-3">
          {groups.map((group) => (
            <Table key={group.title} {...group} />
          ))}
        </div>
        <p className={STATUS}>Escape or q to close</p>
      </div>
    </div>
  );
}
