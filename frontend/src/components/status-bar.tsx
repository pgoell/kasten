import { useEffect, useState } from "react";
import { SaveSign } from "@/components/save-sign";
import { Clock } from "@/components/status-clock";
import { StatusDetail } from "@/components/status-detail";
import { BUILD } from "@/lib/build";
import { lineDiff } from "@/lib/diff";
import type { SaveStatus } from "@/lib/use-autosave";

/** How long the refusal flash lasts. The same 400ms `--animate-flash` names. */
const FLASH_MS = 400;

const SAVE_LABEL: Record<SaveStatus, string> = {
  saved: "Saved",
  unsaved: "Unsaved changes",
  saving: "Saving",
  error: "Could not save",
  conflict: "Changed on disk",
};

/**
 * What to do about the readings that need doing something about.
 *
 * The other three settle themselves, so naming a key under them would be
 * telling the reader to act on a note that is already written.
 */
const SAVE_FIX: Partial<Record<SaveStatus, string>> = {
  error: "Your text is still here. :w or ctrl+s writes it again, :e! drops it for the vault's.",
  conflict: "Somebody else wrote this note. :w keeps your text, :e! takes the vault's.",
};

/**
 * The same two ways out as buttons, under the sentence that names them.
 *
 * A phone has no ex prompt to type `:w` at: vim is off under a finger, and on
 * it has no Escape to reach normal mode with. The palette's `Write the note`
 * row lists only over a focused editor, and the tap that opened this sentence
 * took the focus off it.
 *
 * `:e!` is the same call under both readings but not the same loss: after a
 * conflict it gives up your text for somebody else's, after a failed write
 * it gives up text the vault never saw. The button names what goes.
 */
const SAVE_ACTIONS: Partial<Record<SaveStatus, Record<"write" | "takeVault", string>>> = {
  error: { write: "Write my text", takeVault: "Drop my text" },
  conflict: { write: "Write my text", takeVault: "Take the vault's" },
};

/** A held note is opened to be dealt with, so nothing here can write it. */
const HELD_FIX = "Open the note to write it again, or :e! there to drop it.";

/**
 * A conflict left behind wants a choice, and the choice wants the diff, which
 * only the note's own bar can show: it alone has the vault's text at hand.
 */
const CONFLICT_FIX =
  "Open the note to see what differs and pick: :w keeps your text, :e! takes the vault's.";

type Opened = "notice" | "save" | "held" | "conflicts";

type HeldNote = { path: string; reason: string; conflicted?: boolean };

/**
 * One note by name, or how many, after what is wrong with them. Counted by
 * path: a note can hold two texts, and is still one note.
 */
function heldLabel(prefix: string, notes: readonly HeldNote[]) {
  const paths = new Set(notes.map(({ path }) => path));
  const [only] = paths;
  return paths.size === 1 && only
    ? `${prefix}: ${noteName(only)}`
    : `${prefix}: ${paths.size} notes`;
}

/** The note's name as the finder shows it, without the folders or `.md`. */
function noteName(path: string) {
  return (path.split("/").pop() ?? path).replace(/\.md$/, "");
}

/**
 * What is running, which is one reading in production and two in development.
 *
 * Production ships the three images under one release tag, so the backend's
 * version is the whole answer and no bundle carries a commit. Development
 * moves them separately: uvicorn reloads the tree under it, while the bundle in
 * front of you was stamped when the dev server last started, so a tab left open
 * across a rebase says so here rather than by behaving strangely.
 *
 * The shell is not in it. That container reports to nobody, and stamping it
 * would be a route of its own for a service you look at rather than through.
 */
function Version({ backend }: { backend: string }) {
  return (
    // Gone below `md`. Development's two readings alone are wider than a third
    // of a phone, and of everything in the bar this is the last thing wanted there.
    <span
      data-testid="version"
      className="shrink-0 text-[11px] text-one-muted tabular-nums max-md:hidden"
    >
      {BUILD === "" ? backend : `be ${backend} fe ${BUILD}`}
    </span>
  );
}

interface StatusBarProps {
  /** Absent while no note is open, when there is nothing to say about one. */
  status?: SaveStatus;
  /** What the vault answered a failed write with, shown under the reading. */
  reason?: string;
  /**
   * Raised each time a key was refused, which flashes the reading below.
   *
   * The number itself says nothing; that it changed is the whole message. The
   * element is keyed on it, so a fresh one replaces the old and starts the
   * animation again. That is what keeps the timing in CSS and out of here:
   * nothing to schedule, nothing to clear, and no timer left running when the
   * bar unmounts.
   */
  flash?: number;
  /**
   * Whether the archive is in what the four lookups answer with.
   *
   * Shown because it is a mode, and a mode with nothing on screen saying so is
   * the one you forget you are in: a note missing from the finder would read as
   * a note missing from the vault. It sits in the left column, which the layout
   * has always kept empty for the save ring's sake.
   */
  archive?: boolean;
  /**
   * One sentence about something that just failed, or nothing to say.
   *
   * Not `reason`, which belongs to the save: that one is tied to `status` and
   * is carried only in the save element's `title`. This is for a failure with
   * no ring to hang off, an upload above all, and the left column is where it
   * fits because the footer is mounted whatever the focused pane holds.
   */
  notice?: string;
  /**
   * What the backend answered for itself, and nothing until it has.
   *
   * A prop rather than a lookup of its own: the bar is rendered bare in its
   * tests and holds no query client, and the route already owns every other
   * call the footer draws from.
   */
  version?: string;
  /**
   * Whether the tab is drawn as one pane over the rest of them.
   *
   * Shown for the reason `archive` is: it is a mode, and a zoomed tab holding
   * four panes looks exactly like a tab holding one. Without a word here the
   * direction keys would read as broken rather than as having nowhere to go.
   */
  zoom?: boolean;
  /**
   * Which pane of how many is drawn, as "1/2", where only one of them is.
   *
   * A narrow window draws a tab's focused pane alone, and unlike a zoom nobody
   * asked for that, so a split looks exactly like a single note. Absent
   * wherever every pane is on screen to be counted.
   */
  pane?: string;
  /**
   * Whether the explorer drawer is open over the page.
   *
   * The bar is under the backdrop then. Tab never landed here, nothing in
   * the bar being in the tab order; this takes it away from a screen reader,
   * which would otherwise read out a page the sheet has covered.
   */
  inert?: boolean;
  /**
   * Whether the bar is the foot of the page, with no toolbar under it.
   *
   * Then it pads by the home indicator's inset, which a phone on its side
   * still has: there the window is too wide for the toolbar (#355).
   */
  foot?: boolean;
  /**
   * The notes other than the open one whose text the vault refused, each with
   * what it answered.
   *
   * Apart from `status`, which speaks for the open note alone. That text is
   * kept until it is written or dropped, and leaving its note is no reason to
   * stop saying so: a save in the next note says nothing about the last.
   *
   * A `conflicted` one was left standing "Changed on disk" rather than refused,
   * and is listed apart: its way out is a choice between two texts, not a retry.
   */
  held?: readonly HeldNote[];
  /**
   * The vault's text and the reader's, for the open note standing conflicted.
   *
   * A function and not the two strings: the route would have to read the
   * buffer on every render to pass them, and they are wanted only while the
   * detail is open on a conflict. Read then, each render, so the diff follows
   * the reader's edits toward a merge.
   */
  conflict?: () => { vault: string; mine: string } | undefined;
  /** Write the buffer over the vault, which is `:w`. */
  onWrite?: () => void;
  /** Throw the buffer away for the vault's text, which is `:e!`. */
  onTakeVault?: () => void;
}

/**
 * The strip along the foot of the window.
 *
 * It runs the full width, under the file tree as well as the editor, and wears
 * the panel's colour with no rule above it so the two read as one surface.
 */
export function StatusBar({
  status,
  reason,
  flash,
  archive,
  notice,
  version,
  zoom,
  pane,
  inert,
  foot,
  held = [],
  conflict,
  onWrite,
  onTakeVault,
}: StatusBarProps) {
  // Taken off again once it has played. The class alone would outlive its own
  // animation, and every later mount of this reading, coming back from a tab
  // holding no note, would play it again with nothing refused. `animationend`
  // would say when to stop without a timer, but jsdom fires none, and a flash
  // no test can see is a flash that drifts.
  const [flashing, setFlashing] = useState(false);
  useEffect(() => {
    if (!flash) return;

    setFlashing(true);
    const timer = setTimeout(() => setFlashing(false), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flash]);

  // Which of the two is opened out above the bar. A `title` is all either had,
  // and a finger has no way to hover: the reason a write failed and the way
  // out of it were unreadable on a phone, and so was the end of a long notice.
  const [opened, setOpened] = useState<Opened | null>(null);
  const failed = held.filter(({ conflicted }) => !conflicted);
  const conflicts = held.filter(({ conflicted }) => conflicted);
  const lines = (notes: readonly HeldNote[]) =>
    notes.map(({ path, reason }) => `${path}: ${reason}`);
  // A string and not the list: the route filters a fresh array every render,
  // and shutting on its identity would shut the detail as soon as it opened.
  const heldKey = [...lines(failed), "", ...lines(conflicts)].join("\n");
  // Shut again when what it showed changes. Left open, it would show the next
  // notice unasked, over the last line of the note, to someone who opened
  // the one before it. A conflict is the exception and opens by itself: the
  // reader has to choose between two texts, and cannot without seeing them.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the four are the trigger, and only `status` is read.
  useEffect(
    () => setOpened(status === "conflict" ? "save" : null),
    [notice, status, reason, heldKey],
  );
  const saveLines = status ? [SAVE_LABEL[status], reason, SAVE_FIX[status]].filter(Boolean) : [];
  // The label alone is on screen already, or is "Saved".
  const saveOpens = saveLines.length > 1;
  const heldDetail = [...lines(failed), HELD_FIX].join("\n");
  const conflictDetail = [...lines(conflicts), CONFLICT_FIX].join("\n");
  const detail =
    opened === "notice"
      ? notice
      : opened === "save" && saveOpens
        ? saveLines.join("\n")
        : opened === "held" && failed.length > 0
          ? heldDetail
          : opened === "conflicts" && conflicts.length > 0
            ? conflictDetail
            : undefined;
  const open = (which: Opened) => setOpened(opened === which ? null : which);
  const texts = opened === "save" && status === "conflict" ? conflict?.() : undefined;
  const diff = texts && lineDiff(texts.vault, texts.mine);
  const run = { write: onWrite, takeVault: onTakeVault };
  const actions =
    opened === "save" && status
      ? (["write", "takeVault"] as const).flatMap((action) => {
          const label = SAVE_ACTIONS[status]?.[action];
          const call = run[action];
          return label && call ? [{ action, label, call }] : [];
        })
      : [];

  const save = status && (
    <SaveSign
      key={flash}
      status={status}
      label={SAVE_LABEL[status]}
      warn={Boolean(SAVE_FIX[status])}
      title={saveLines.join("\n")}
      flashing={flashing}
    />
  );

  return (
    // Three columns rather than two: the outer pair share what the clock does
    // not take, so the reading sits on the middle of the window and does not
    // shift sideways when the save ring appears beside it.
    //
    // `minmax(0, 1fr)` and not `1fr`, whose floor is the content: a long notice
    // would push the bar wider than a phone instead of being cut short.
    <footer
      inert={inert}
      className={`relative grid h-6 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center bg-one-panel px-3 pointer-coarse:h-11 ${
        // With the clock gone the notice takes what the save sign leaves,
        // rather than the half of the bar an even split would give it.
        notice !== undefined ? "max-md:grid-cols-[minmax(0,1fr)_auto_auto]" : ""
      } ${
        // `box-content` so the inset is added under the bar's height rather
        // than taken out of it.
        foot ? "safe-foot box-content" : ""
      }`}
    >
      {detail !== undefined && (
        <StatusDetail
          detail={detail}
          diff={diff}
          actions={actions}
          onClose={() => setOpened(null)}
        />
      )}
      <div className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap">
        {version !== undefined && <Version backend={version} />}
        {notice !== undefined && (
          <button
            type="button"
            tabIndex={-1}
            data-testid="notice"
            // The whole sentence, for when the bar had room for half of it:
            // on hover under a mouse, and opened out above the bar on a tap.
            title={notice}
            onClick={() => open("notice")}
            className="min-w-0 truncate text-[11px] text-one-warn pointer-coarse:h-11"
          >
            {notice}
          </button>
        )}
        {archive === true && (
          <span data-testid="archive-shown" className="text-[11px] text-one-muted">
            archive
          </span>
        )}
        {zoom === true && (
          // Gone below `md`, where every tab is drawn as one pane, zoomed or
          // not, and the count beside it is what says so.
          <span data-testid="zoom-shown" className="text-[11px] text-one-muted max-md:hidden">
            zoom
          </span>
        )}
        {pane !== undefined && (
          <span data-testid="pane-shown" className="text-[11px] text-one-muted tabular-nums">
            pane {pane}
          </span>
        )}
      </div>
      {/* The held list crowds the clock out on a phone as a notice does: it
          is the one reading there that loses text if nobody acts on it. */}
      <Clock crowded={notice !== undefined || held.length > 0} />
      <div className="flex min-w-0 items-center justify-end gap-2 justify-self-end whitespace-nowrap">
        {failed.length > 0 && (
          <button
            type="button"
            tabIndex={-1}
            data-testid="held"
            // Every note and what the vault said, on hover under a mouse and
            // opened out above the bar on a tap, the way a notice is.
            title={heldDetail}
            onClick={() => open("held")}
            className="min-w-0 truncate text-[11px] text-one-warn pointer-coarse:h-11"
          >
            {heldLabel("Not saved", failed)}
          </button>
        )}
        {conflicts.length > 0 && (
          <button
            type="button"
            tabIndex={-1}
            data-testid="held-conflict"
            title={conflictDetail}
            onClick={() => open("conflicts")}
            className="min-w-0 truncate text-[11px] text-one-warn pointer-coarse:h-11"
          >
            {heldLabel("Changed on disk", conflicts)}
          </button>
        )}
        {saveOpens ? (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => open("save")}
            className="pointer-coarse:h-11"
          >
            {save}
          </button>
        ) : (
          save
        )}
      </div>
    </footer>
  );
}
