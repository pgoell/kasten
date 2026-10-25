import { useEffect, useRef, useState } from "react";
import { Sheet } from "@/components/sheet";
import { FOLLOW, FORMAT, INDENT, LEADER_EDITS, readable } from "@/lib/buffer-keys";
import { FINANCE_PANE } from "@/lib/finance-keys";
import { trapTab } from "@/lib/focus-trap";
import {
  ANYWHERE,
  chordLabel,
  LOG_PANE,
  REVIEW_PANE,
  SCREENS,
  TERMINAL,
  TODO_PANE,
  TREE,
} from "@/lib/key-bindings";
import { LEADER, LEADER_COLUMNS, spelled, TAB_DIGITS, TAB_KEYS } from "@/lib/leader-keys";
import { closeOnBackdrop, HEADER_ROW, INPUT, LABEL, PANEL, STATUS } from "@/lib/overlay-styles";
import { READER, RSVP_KEYS } from "@/lib/reader-keys";
import { useViewport } from "@/lib/use-viewport";
import { VIDEO_PANE } from "@/lib/video-keys";
import { useVim } from "@/lib/vim-setting";

interface Group {
  title: string;
  keys: readonly { key: string; label: string }[];
}

/**
 * The leader's six columns, filled from the two tables the keys live in.
 *
 * The grouping is `LEADER_COLUMNS`, shared with the which-key panel, so the two
 * cannot disagree about where a key sits. A key named nowhere there is not drawn.
 */
function leaderGroups(): Group[] {
  const rows = new Map(
    [...LEADER, ...LEADER_EDITS].map(({ key, label }) => [key, { key: spelled(key), label }]),
  );
  rows.set(TAB_DIGITS, {
    key: `Space ${TAB_KEYS[0]} … ${TAB_KEYS[TAB_KEYS.length - 1]}`,
    label: "Go to a tab by number",
  });

  return LEADER_COLUMNS.map(({ title, keys }) => ({
    title,
    keys: keys.flatMap((key) => {
      const row = rows.get(key);
      return row ? [row] : [];
    }),
  }));
}

/**
 * The groups that match the filter, with the rows that match inside them.
 *
 * A group whose title matches keeps every row, so `tab` shows the Tabs group
 * whole. A group left with no rows is dropped, and the column holding it can
 * then say that nothing matches.
 */
function narrow(groups: Group[], query: string): Group[] {
  const wanted = query.toLowerCase();
  return groups.flatMap((group) => {
    const inTitle = group.title.toLowerCase().includes(wanted);
    const keys = group.keys.filter(
      ({ key, label }) =>
        inTitle || key.toLowerCase().includes(wanted) || label.toLowerCase().includes(wanted),
    );
    return keys.length > 0 ? [{ ...group, keys }] : [];
  });
}

/**
 * One of the two columns: its title, an optional line under it, and its groups
 * stacked as one list. Stacked rather than in a grid, so a column reads down the
 * way the filter narrows it.
 */
function Column({
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
      <h2 className="mb-1 text-[12px] font-semibold tracking-wider text-k-ink uppercase">
        {title}
      </h2>
      {intro && <p className="mb-2 text-[12px] text-k-muted">{intro}</p>}
      {groups.length === 0 ? (
        <p className="text-[13px] text-k-muted">Nothing matches</p>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <Table key={group.title} {...group} />
          ))}
        </div>
      )}
    </section>
  );
}

function Table({ title, keys }: Group) {
  return (
    <section className="min-w-0">
      <h3 className={`${LABEL} mb-1`}>{title}</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-k-13">
        {keys.map(({ key, label }) => (
          // A key may do one thing on one tab and another on the next, so the pair is the key.
          <div key={`${key}:${label}`} className="contents">
            <dt className="whitespace-nowrap font-mono tracking-k-kbd text-k-accent">{key}</dt>
            <dd className="text-k-muted">{label}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * The whole key map, on one panel behind `<leader>?`.
 *
 * Everything on it is read from `key-bindings.ts` and `leader-keys.ts`, the same
 * tables the registrations are built from, so a key cannot appear here and be
 * missing from the editor.
 *
 * Two columns from the `md` breakpoint, the leader keys and the rest, each one
 * a stack of groups: the map is a hundred-odd keys and the point of the panel is
 * answering a question at a glance. The filter field narrows both at once, so a
 * reader typing `tab` sees every key that has one wherever it lives.
 */
export function KeyHelp({ onClose }: { onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const vimOn = useVim();
  // The which-key panel's phone signal. A phone gets the shared bottom sheet, where
  // the desktop gets the centred panel. Read off the viewport and not named `narrow`,
  // which is the filter's function below.
  const viewport = useViewport();
  const phone = viewport.narrow && viewport.coarse;
  const [query, setQuery] = useState("");

  // The filter takes the focus so the panel's own keys reach it, rather than
  // whatever was focused when it opened, and hands the focus back on the way
  // out. Restoring what held it beats naming the editor: the same key opens this
  // from the file tree, and closing there belongs back in the tree.
  // Read on the first render, before the phone sheet takes the focus for its panel:
  // in an effect the sheet's panel would already be the element that held it.
  const [opener] = useState<Element | null>(() => document.activeElement);
  useEffect(() => {
    field.current?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [opener]);

  const others: Group[] = [
    {
      title: "In a note",
      keys: [
        ...FORMAT.map(({ key, label }) => ({ key: readable(key), label })),
        ...INDENT,
        // Only vim resolves `gf` and its Enter, so with vim off the row names
        // keys that do nothing: see "Vim on or off" in docs/reference/editor-keys.md.
        ...(vimOn ? FOLLOW : []),
      ],
    },
    { title: "In a page, PDF or book", keys: READER },
    { title: "Reading word by word", keys: RSVP_KEYS },
    { title: "Over a video", keys: VIDEO_PANE },
    { title: "In review", keys: REVIEW_PANE },
    { title: "Anywhere", keys: ANYWHERE },
    { title: "File tree", keys: TREE },
    { title: "Todo pane", keys: TODO_PANE },
    { title: "Log pane", keys: LOG_PANE },
    { title: "Finance pane", keys: FINANCE_PANE },
    // Its own group because these are not leader keys and cannot be: the leader
    // is the space bar and a shell must receive the space bar.
    {
      title: "Terminal",
      keys: TERMINAL.map(({ key, label }) => ({ key: chordLabel(key), label })),
    },
    // Last, because it is the one group whose left column is an address rather
    // than something to press.
    { title: "Screens you type", keys: SCREENS },
  ];

  const header = (
    <div className={HEADER_ROW}>
      <span className={LABEL}>Keys</span>
      <input
        ref={field}
        type="search"
        aria-label="Filter keys"
        placeholder="Filter, e.g. graph or tab"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className={`${INPUT} font-mono [&::-webkit-search-cancel-button]:appearance-none`}
      />
    </div>
  );

  const columns = (
    <div className="min-h-0 overflow-auto px-4 py-3">
      <div className="grid grid-cols-1 items-start gap-x-8 gap-y-4 md:grid-cols-2">
        <Column
          title="After Space"
          // With vim off there is no normal mode and so no leader, but every
          // one of these is a palette command under the same label.
          intro={
            vimOn
              ? "These start with Space, in normal mode."
              : `Vim is off, so run these from the command palette (${chordLabel("P")}), each by the same label.`
          }
          groups={narrow(leaderGroups(), query)}
        />
        <Column
          title="Vim and the rest"
          groups={narrow(others, query)}
          className="mt-4 border-t border-k-rule pt-4 md:mt-0 md:border-t-0 md:pt-0"
        />
      </div>
    </div>
  );

  // A phone has no room for a centred panel, and the one column of `columns` is
  // all it needs. The sheet owns the Escape, the drag and the Tab stop, which the
  // panel below does for the desktop.
  // The footer is pinned under the list, at the sheet's own 16 px gutter, so the list scrolls
  // above it and the line is always at the foot.
  if (phone) {
    return (
      <Sheet
        open
        onClose={onClose}
        label="Keyboard shortcuts"
        full
        header={header}
        footer={
          <p className="border-t border-k-rule px-4 py-2 text-[11px] text-k-muted">
            Drag down or tap outside to close
          </p>
        }
      >
        {columns}
      </Sheet>
    );
  }

  return (
    <div
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      tabIndex={-1}
      onKeyDown={(event) => {
        // The filter is the only stop inside the panel, so Tab would otherwise
        // carry the focus out to the page behind it.
        if (panel.current && trapTab(event, panel.current)) return;
        // A q typed in the filter is a letter. Escape closes from the filter too.
        const typing = event.target === field.current;
        if (event.key !== "Escape" && (event.key !== "q" || typing)) return;
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
      {/* `PANEL` is mono for the overlays that are all lists of paths. Here the
          words are the UI and only the keys are code, so the sans goes on top,
          with `!` because both classes set the same font family. */}
      <div className={`${PANEL} !font-sans max-h-[88vh] w-[min(84rem,95vw)]`}>
        {header}
        {columns}
        <p className={STATUS}>Escape or q to close, or a tap outside</p>
      </div>
    </div>
  );
}
