import { useEffect, useRef } from "react";
import {
  FOLLOW,
  FORMAT,
  INDENT,
  LEADER,
  LEADER_EDITS,
  readable,
  SCREENS,
  spelled,
  TAB_KEYS,
  TERMINAL,
  TERMINAL_CHORD,
  TODO_PANE,
  TREE,
} from "@/lib/key-bindings";
import { closeOnBackdrop, HEADER_ROW, LABEL, PANEL, STATUS } from "@/lib/overlay-styles";
import { useVim } from "@/lib/vim-setting";

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
 * here is not drawn, so a new binding needs an entry here, and a test fails
 * until it has one.
 */
const LEADER_GROUPS: readonly { title: string; keys: readonly string[] }[] = [
  {
    title: "Panes",
    keys: ["%", '"', "h", "j", "k", "l", "H", "J", "K", "L", "o", "z", "q"],
  },
  { title: "Tabs", keys: ["ct", "tl", "th", TAB_DIGITS] },
  { title: "Find", keys: ["ff", "fg", "ft"] },
  { title: "Create and capture", keys: ["cf", "cd", "cw", "cm", "cb", "ci", "cv", "cc", "cs"] },
  { title: "This note", keys: ["rf", "df", "du", "w", "="] },
  { title: "Periodic notes", keys: ["gd", "gw", "gm", "gq", "gy"] },
  {
    title: "Panes to open",
    keys: ["gb", "go", "gr", "gp", "gh", "gl", "gv", "ge", "gs", "gt", "gg"],
  },
  { title: "Todos", keys: ["x", "i", "so", "sp", "sx", "sb", "sw", "sv", "sr"] },
  { title: "Toggles", keys: ["a", "b", "p", "e", "E", "v"] },
  { title: "Help", keys: ["?", ":"] },
];

/** The leader groups above, filled from the two tables the keys live in. */
function leaderGroups(): Group[] {
  const rows = new Map(
    [...LEADER, ...LEADER_EDITS].map(({ key, label }) => [key, { key: spelled(key), label }]),
  );
  rows.set(TAB_DIGITS, {
    key: `Space ${TAB_KEYS[0]} … ${TAB_KEYS[TAB_KEYS.length - 1]}`,
    label: "Go to a tab by number",
  });

  return LEADER_GROUPS.map(({ title, keys }) => ({
    title,
    keys: keys.flatMap((key) => {
      const row = rows.get(key);
      return row ? [row] : [];
    }),
  }));
}

/**
 * One block of groups, in a grid rather than CSS columns: columns place a
 * group by the heights before it, so where one lands moved with the window.
 * A grid keeps reading order, left to right and row by row.
 */
function Block({
  title,
  intro,
  groups,
  className = "",
}: {
  title: string;
  intro?: string;
  groups: Group[];
  className?: string;
}) {
  return (
    <section className={className}>
      <h2 className="mb-1 text-[12px] font-semibold tracking-wider text-one-fg uppercase">
        {title}
      </h2>
      {intro && <p className="mb-2 text-[12px] text-one-muted">{intro}</p>}
      <div className="grid grid-cols-1 items-start gap-x-8 gap-y-4 md:grid-cols-2 xl:grid-cols-3">
        {groups.map((group) => (
          <Table key={group.title} {...group} />
        ))}
      </div>
    </section>
  );
}

function Table({ title, keys }: Group) {
  return (
    <section className="min-w-0">
      <h3 className={`${LABEL} mb-1`}>{title}</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-[13px] leading-snug">
        {keys.map(({ key, label }) => (
          <div key={key} className="contents">
            <dt className="whitespace-nowrap text-one-accent">{key}</dt>
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
 * Two blocks, the leader keys and the rest, each a grid of up to three
 * columns rather than one long list: the map is a hundred-odd keys, a single
 * column is pages of scrolling, and the point of the panel is answering a
 * question at a glance. A phone gets the one column.
 */
export function KeyHelp({ onClose }: { onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const vimOn = useVim();

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

  const others: Group[] = [
    {
      title: "Editor",
      keys: [
        ...FORMAT.map(({ key, label }) => ({ key: readable(key), label })),
        ...INDENT,
        // Only vim resolves `gf` and its Enter, so with vim off the row names
        // keys that do nothing: see "Vim on or off" in docs/reference/editor-keys.md.
        ...(vimOn ? FOLLOW : []),
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
    // Last, because it is the one group whose left column is an address rather
    // than something to press.
    { title: "Screens you type", keys: SCREENS },
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
      {...closeOnBackdrop(onClose)}
      // Padded by the side insets for the reason `BACKDROP` is: 95vw of a
      // phone on its side reaches under its notch.
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] focus:outline-none"
    >
      {/* The finder's panel, wider: this is the fourth thing the app draws over
          the editor and reads as the same object, but it holds a map rather
          than a list, and the width is what keeps the map off a scrollbar. */}
      <div className={`${PANEL} max-h-[88vh] w-[min(84rem,95vw)]`}>
        <div className={HEADER_ROW}>
          <span className={LABEL}>Keys</span>
        </div>
        <div className="min-h-0 overflow-auto px-4 py-3">
          <Block
            title="Leader keys"
            // With vim off there is no normal mode and so no leader, but every
            // one of these is a palette command under the same label.
            intro={
              vimOn
                ? "These start with Space, in normal mode."
                : `Vim is off, so run these from the command palette (${chordLabel("P")}), each by the same label.`
            }
            groups={leaderGroups()}
          />
          <Block
            title="Other keys"
            groups={others}
            className="mt-4 border-t border-one-selection pt-4"
          />
        </div>
        <p className={STATUS}>Escape or q to close, or a tap outside</p>
      </div>
    </div>
  );
}
