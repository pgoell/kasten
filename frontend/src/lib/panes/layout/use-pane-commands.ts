import { useQueryClient } from "@tanstack/react-query";
import { type Dispatch, type RefObject, type SetStateAction, useCallback, useMemo } from "react";
import type { PaneMoves } from "@/components/use-pane-moves";
import { useLogCommands } from "@/lib/log/use-log-commands";
import { isPerson } from "@/lib/notes/links/person";
import type { Period } from "@/lib/notes/text/periodic";
import { openBeside } from "@/lib/panes/layout/pane-contents";
import { heldKind, type KindField, PANE_KINDS } from "@/lib/panes/layout/pane-kinds";
import {
  addTab,
  fillFocused,
  fillPane,
  focusPane,
  goToTab,
  type Layout,
  nextPane,
  type Pane as PaneOf,
  removeFocused,
  type Split,
  splitFocused,
  stepTab,
  tabPanes,
  toggleZoom,
} from "@/lib/panes/layout/panes";
import { askRsvp } from "@/lib/panes/rsvp/use-rsvp";
import { usePlayAsk } from "@/lib/panes/video/use-video-player";
import type { TreeCommands } from "@/lib/ui/keys/key-bindings";

export type PaneCommands = ReturnType<typeof usePaneCommands>;

/**
 * The save rule, in one place. `replace` unmounts the editor, which holds the only copy of an
 * unsaved edit, so it saves first and a refused save keeps the note; `beside` unmounts nothing.
 * `replace` fills the pane the key came from, by id, as the focus may move during the save (#1609),
 * and answers whether the save went through.
 */
export function paneOpeners(
  paneId: string,
  saveFirst: () => Promise<boolean>,
  moveTo: PaneMoves["moveTo"],
) {
  return {
    replace: async (content: Omit<PaneOf, "id">) =>
      (await saveFirst()) && moveTo((previous) => fillPane(previous, paneId, content)),
    beside: (holds: (pane: PaneOf) => boolean, content: Omit<PaneOf, "id">, dir: Split["dir"]) =>
      moveTo((previous) => openBeside(previous, holds, content, dir)),
  };
}

/** Commands that rearrange the window: pane contents, splits, moves, tabs and playback. */
export function usePaneCommands({
  pane,
  setLayout,
  saveFirst,
  moves,
  openPeriodic,
  setNotice,
  paths,
  focusedNote,
  sheetGraph,
  sideGraph,
  flushBook,
}: {
  pane: Pick<PaneOf, "id" | KindField>;
  setLayout: Dispatch<SetStateAction<Layout>>;
  saveFirst: () => Promise<boolean>;
  moves: Pick<PaneMoves, "moveTo" | "focusToward" | "shiftToward">;
  openPeriodic: (period: Period, at?: string) => boolean | Promise<boolean> | undefined;
  setNotice: Dispatch<SetStateAction<string | undefined>>;
  /** The vault's note paths, as the listing holds them; undefined until it loads. */
  paths: string[] | undefined;
  /** The note the focused pane holds, and whether a save of one is in the air. */
  focusedNote: RefObject<{ path: string | undefined; isWriting: (note: string) => boolean }>;
  /** On a phone the local graph is a sheet over the window, not a pane beside the note. */
  sheetGraph?: (note: string) => void;
  /** On a desktop the local graph opens over its pane, or beside it when the margin shows. */
  sideGraph?: (pane: string) => void;
  /** Writes the reader's place in a note, settling once the write ends. */
  flushBook: (note: string) => Promise<void>;
}) {
  const { moveTo, focusToward, shiftToward } = moves;
  const queryClient = useQueryClient();
  const { playSignal, play } = usePlayAsk();

  const { replace, beside } = useMemo(
    () => paneOpeners(pane.id, saveFirst, moveTo),
    [pane.id, saveFirst, moveTo],
  );
  const log = useLogCommands({ pane, saveFirst, openPeriodic, setNotice, paths, focusedNote });
  const kind = heldKind(pane);

  const readRsvp = useCallback(
    (here: boolean) => askRsvp(pane, here, setNotice),
    [pane, setNotice],
  );

  const commands = useMemo<
    Pick<
      TreeCommands,
      | "closeNote"
      | "openTodos"
      | "openLog"
      | "openOverview"
      | "openLibrary"
      | "openFinance"
      | "openGraph"
      | "openLocalGraph"
      | "openDaily"
      | "logDrink"
      | "logFood"
      | "logWeight"
      | "openWeekly"
      | "openMonthly"
      | "openQuarterly"
      | "openYearly"
      | "openBook"
      | "openPerson"
      | "openHistory"
      | "openVideo"
      | "toggleVideo"
      | "openRsvp"
      | "rsvpFromHere"
      | "openExam"
      | "openReview"
      | "createTab"
      | "openChat"
      | "openTimers"
      | "splitRight"
      | "splitDown"
      | "nextPane"
      | "paneLeft"
      | "paneDown"
      | "paneUp"
      | "paneRight"
      | "movePaneLeft"
      | "movePaneDown"
      | "movePaneUp"
      | "movePaneRight"
      | "zoomPane"
      | "nextTab"
      | "prevTab"
      | "goToTab"
    >
  >(
    () => ({
      closeNote: async () => {
        if (kind === undefined) {
          moveTo(removeFocused);
          return;
        }
        // Cleared like a note, since removing the last pane of the last tab does nothing.
        // Closing the socket only detaches a client; the herdr session keeps running.
        // In a split the pane goes and the pane beside takes the focus, as in Obsidian (#1605);
        // a terminal still empties, its pane being the way back to an editor.
        if (PANE_KINDS[kind].clears) {
          // The note beside may take the focus, and a focused note refuses the reader's place.
          if (pane.book !== undefined) await flushBook(pane.book);
          // By id: a second press or a move of the focus may have come during the write.
          moveTo((previous) => {
            if (!tabPanes(previous).some((each) => each.id === pane.id)) return previous;
            const here = focusPane(previous, pane.id);
            return kind !== "term" && tabPanes(here).length > 1
              ? removeFocused(here)
              : fillFocused(here, {});
          });
          return;
        }
        await replace({});
      },
      openTodos: () => replace({ todos: true }),
      openLog: () => replace({ log: true }),
      openOverview: () => replace({ overview: true }),
      openLibrary: () => replace({ library: true }),
      openFinance: () => replace({ finance: true }),
      openReview: () => replace({ review: true }),
      // Closing the pane later ends nothing; the runner owns the chat.
      openChat: () => replace({ chat: true }),
      openTimers: () => replace({ timers: true }),
      openGraph: () => replace({ graph: {} }),
      // A phone has no room beside the note: a sheet there.
      openLocalGraph: () => {
        if (pane.path === undefined) return;
        const note = pane.path;
        if (sheetGraph) {
          sheetGraph(note);
          return;
        }
        if (sideGraph) {
          sideGraph(pane.id);
          return;
        }
        beside((each) => each.graph?.around === note, { graph: { around: note } }, "row");
      },
      // Each takes no argument, as a leader binding needs. The shared logic is in periodic.ts.
      openDaily: () => openPeriodic("daily"),
      ...log,
      openWeekly: () => openPeriodic("weekly"),
      openMonthly: () => openPeriodic("monthly"),
      openQuarterly: () => openPeriodic("quarterly"),
      openYearly: () => openPeriodic("yearly"),
      // moveTo refuses the key while the note is conflicted.
      openBook: () => {
        if (pane.path === undefined) return;
        const note = pane.path;
        beside((each) => each.book === note, { book: note }, "row");
      },
      // Reads the cache, so a `type: Person` not yet autosaved is not seen yet.
      openPerson: () => {
        if (pane.path === undefined) return;
        const note = pane.path;
        if (!isPerson(queryClient.getQueryData<string>(["note", note]) ?? "")) return;
        // `row`: a card is short lines and reads beside a note.
        beside((each) => each.person === note, { person: note }, "row");
      },
      // Leaving the note flushes what was typed, and the restore refuses while that write is out.
      // On a narrow window the history takes the screen, as the route draws the focused pane alone.
      openHistory: () => {
        if (pane.path === undefined) return;
        const note = pane.path;
        beside((each) => each.history === note, { history: note }, "row");
      },
      // A link typed but not yet autosaved is not found yet.
      openVideo: () => {
        if (pane.path === undefined) return;
        const note = pane.path;
        // `col` rather than the book's `row`: a 16:9 player wants the width.
        beside((each) => each.video === note, { video: note }, "col");
      },
      // No guard: with no player on screen the number reaches no pane, so the key does nothing.
      toggleVideo: play,
      // The pane reads its own text, so these only ask it (`use-rsvp.ts`). No moveTo or saveFirst.
      openRsvp: () => readRsvp(false),
      rsvpFromHere: () => readRsvp(true),
      // Over the note, not beside it: beside, the answers would sit by the questions.
      openExam: async () => {
        if (pane.path === undefined) return;
        await replace({ exam: pane.path });
      },
      createTab: () => moveTo(addTab),
      // The bare nextPane and goToTab below are the imports, not these keys: an object
      // literal's keys are not names in scope for its values.
      splitRight: () => moveTo((previous) => splitFocused(previous, "row")),
      splitDown: () => moveTo((previous) => splitFocused(previous, "col")),
      nextPane: () => moveTo(nextPane),
      paneLeft: () => focusToward("left"),
      paneDown: () => focusToward("down"),
      paneUp: () => focusToward("up"),
      paneRight: () => focusToward("right"),
      movePaneLeft: () => shiftToward("left"),
      movePaneDown: () => shiftToward("down"),
      movePaneUp: () => shiftToward("up"),
      movePaneRight: () => shiftToward("right"),
      // Not through moveTo: nothing is written or moved, so a conflicted note has nothing to
      // refuse. Hiding a pane cannot blur the one you type in.
      zoomPane: () => setLayout(toggleZoom),
      nextTab: () => moveTo((previous) => stepTab(previous, 1)),
      prevTab: () => moveTo((previous) => stepTab(previous, -1)),
      goToTab: (index) => moveTo((previous) => goToTab(previous, index)),
    }),
    [
      moveTo,
      replace,
      beside,
      focusToward,
      shiftToward,
      openPeriodic,
      log,
      setLayout,
      pane.id,
      pane.path,
      pane.book,
      kind,
      queryClient,
      sheetGraph,
      sideGraph,
      flushBook,
      readRsvp,
      play,
    ],
  );

  return { playSignal, commands };
}
