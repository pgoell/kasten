import { EditorView } from "@codemirror/view";
import { useQueryClient } from "@tanstack/react-query";
import { type Dispatch, type RefObject, type SetStateAction, useCallback, useMemo } from "react";
import type { PaneMoves } from "@/components/use-pane-moves";
import { fetchAssets, fetchFiles, fetchNote, NoteMissing } from "@/lib/api";
import { heldText } from "@/lib/held-text";
import type { TreeCommands } from "@/lib/key-bindings";
import { READING_NOTE } from "@/lib/layout";
import { askOnCard, openFoodSearch } from "@/lib/log/log-card";
import { drinkTarget, logDrinkInVault, logDrinkInView } from "@/lib/log/log-write";
import { paneView, useFoodWait } from "@/lib/log/use-food-wait";
import { noteName } from "@/lib/note-path";
import { openBeside, openBookInFocused } from "@/lib/pane-contents";
import { paneEditor } from "@/lib/pane-doc";
import { heldKind, type KindField, PANE_KINDS } from "@/lib/pane-kinds";
import {
  addTab,
  fillFocused,
  goToTab,
  type Layout,
  nextPane,
  type Pane as PaneOf,
  removeFocused,
  type Split,
  splitFocused,
  stepTab,
  toggleZoom,
} from "@/lib/panes";
import { type Period, periodicNote } from "@/lib/periodic";
import { isPerson } from "@/lib/person";
import { askRsvp } from "@/lib/rsvp/use-rsvp";
import { usePlayAsk } from "@/lib/video/use-video-player";
import { splitTarget, wikiLinkPath, wikiLinkTargets } from "@/lib/wikilink";

export type PaneCommands = ReturnType<typeof usePaneCommands>;

/**
 * The save rule, in one place. `replace` unmounts the editor, which holds the only copy of an
 * unsaved edit, so it saves first and a refused save keeps the note; `beside` unmounts nothing.
 * `replace` answers whether the pane changed.
 */
export function paneOpeners(saveFirst: () => Promise<boolean>, moveTo: PaneMoves["moveTo"]) {
  return {
    replace: async (content: Omit<PaneOf, "id">) =>
      (await saveFirst()) && moveTo((previous) => fillFocused(previous, content)),
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
}: {
  pane: Pick<PaneOf, "id" | KindField>;
  setLayout: Dispatch<SetStateAction<Layout>>;
  saveFirst: () => Promise<boolean>;
  moves: Pick<PaneMoves, "moveTo" | "focusToward" | "shiftToward">;
  openPeriodic: (period: Period) => boolean | Promise<boolean> | undefined;
  setNotice: Dispatch<SetStateAction<string | undefined>>;
  /** The vault's note paths, as the listing holds them; undefined until it loads. */
  paths: string[] | undefined;
  /** The note the focused pane holds, and whether a save of one is in the air. */
  focusedNote: RefObject<{ path: string | undefined; isWriting: (note: string) => boolean }>;
  /** On a phone the local graph is a sheet over the window, not a pane beside the note. */
  sheetGraph?: (note: string) => void;
  /** On a desktop the local graph opens over its pane, or beside it when the margin shows. */
  sideGraph?: (pane: string) => void;
}) {
  const { moveTo, focusToward, shiftToward } = moves;
  const queryClient = useQueryClient();
  const { playSignal, play } = usePlayAsk();

  /**
   * Opens the book `READING_NOTE` links. The note is read fresh on each press: it is
   * hand-edited, and a 404 is the answer that says it is missing.
   */
  const openReadingBook = useCallback(async () => {
    setNotice(undefined);

    // Saved first: the pane may hold the config note, whose new link would read as the old.
    if (!(await saveFirst())) return;

    // Read through the query cache, so a press right after load waits for the listings.
    let text: string;
    let paths: string[];
    let books: string[];
    try {
      [text, paths, books] = await Promise.all([
        fetchNote(READING_NOTE),
        queryClient.ensureQueryData({ queryKey: ["files"], queryFn: fetchFiles }),
        queryClient.ensureQueryData({ queryKey: ["assets"], queryFn: fetchAssets }),
      ]);
    } catch (error: unknown) {
      if (error instanceof NoteMissing) setNotice(`${READING_NOTE} is not there`);
      else setNotice(error instanceof Error ? error.message : `${READING_NOTE} could not be read`);
      return;
    }

    const target = wikiLinkTargets(text)[0];
    if (target === undefined || splitTarget(target).name === "") {
      setNotice(`${READING_NOTE} links no book note`);
      return;
    }

    // wikiLinkPath falls back to the inbox, so the listing is what says no note.
    const note = wikiLinkPath(target, paths);
    if (!note.endsWith(".md") || !paths.includes(note)) {
      setNotice(`[[${target}]] in ${noteName(READING_NOTE)}.md names no note`);
      return;
    }

    // Pairs as the backend does, both suffixes; withBooks in the book finder follows it.
    const stem = note.slice(0, -".md".length);
    if (!books.some((path) => path === `${stem}.epub` || path === `${stem}.pdf`)) {
      setNotice(`Nothing to read beside ${note}`);
      return;
    }

    // The reader finds the `reading:` place in the note itself.
    moveTo((previous) => openBookInFocused(previous, note));
  }, [queryClient, saveFirst, moveTo, setNotice]);

  const { replace, beside } = useMemo(() => paneOpeners(saveFirst, moveTo), [saveFirst, moveTo]);
  const food = useFoodWait(pane.id, pane.path);
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
      | "openReadingBook"
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
        if (PANE_KINDS[kind].clears) {
          moveTo((previous) => fillFocused(previous, {}));
          return;
        }
        await replace({});
      },
      openTodos: () => replace({ todos: true }),
      openLog: () => replace({ log: true }),
      openOverview: () => replace({ overview: true }),
      openFinance: () => replace({ finance: true }),
      openReview: () => replace({ review: true }),
      // Closing the pane later ends nothing; the runner owns the chat.
      openChat: () => replace({ chat: true }),
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
      // The notice names the line without its list dash, or why the vault refused.
      logDrink: (line) => {
        setNotice(undefined);
        const today = periodicNote("daily", new Date()).path;
        const target = drinkTarget({
          today,
          focusedPath: pane.path,
          held: heldText(today) !== undefined,
          writing: focusedNote.current.isWriting(today),
        });
        // Found by pane, not focus: focus on the body, toolbar or a card finds no view,
        // and the vault write would land under the open note.
        if (target === "buffer") {
          const editor = paneEditor(pane.id);
          const view = editor ? EditorView.findFromDOM(editor) : null;
          if (view === null || !logDrinkInView(view, line)) {
            setNotice(`Nothing logged: ${today} is not open to type in`);
          }
          return;
        }
        if (typeof target === "object") {
          setNotice(`Nothing logged: ${target.why}`);
          return;
        }
        // Asked again when the queue reaches the write, since a save may have run first.
        const stillOk = () => {
          const now = drinkTarget({
            today,
            focusedPath: focusedNote.current.path,
            held: heldText(today) !== undefined,
            writing: focusedNote.current.isWriting(today),
          });
          if (now === "vault") return null;
          return { why: typeof now === "object" ? now.why : `${today} is open to type in` };
        };
        void logDrinkInVault(line, paths ?? [], stillOk).then(
          () => setNotice(`Logged ${line.slice(2)} into today's note`),
          (error: unknown) =>
            setNotice(error instanceof Error ? error.message : "The drink was not logged"),
        );
      },
      // Searched in place when today's note is open. Otherwise openPeriodic makes it, and
      // useFoodWait holds the search until it is on screen.
      logFood: async () => {
        const today = periodicNote("daily", new Date()).path;
        if (pane.path === today) {
          const view = paneView(pane.id);
          if (view !== null) openFoodSearch(view);
          return;
        }
        // Saved first: a refused save leaves nothing waiting.
        if (!(await saveFirst())) return;
        food.arm(today, (view) => openFoodSearch(view));
        // A failed create or open leaves nothing waiting, so a later `<leader>gd` is not searched.
        if (!(await openPeriodic("daily"))) food.cancel();
      },
      logWeight: async (mark) => {
        const today = periodicNote("daily", new Date()).path;
        if (pane.path === today) {
          const view = paneView(pane.id);
          if (view !== null) askOnCard(view, mark);
          return;
        }
        if (!(await saveFirst())) return;
        food.arm(today, (view) => askOnCard(view, mark));
        if (!(await openPeriodic("daily"))) food.cancel();
      },
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
      openReadingBook: () => void openReadingBook(),
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
      saveFirst,
      openPeriodic,
      openReadingBook,
      paths,
      focusedNote,
      setLayout,
      pane.id,
      pane.path,
      kind,
      queryClient,
      setNotice,
      food,
      sheetGraph,
      sideGraph,
      readRsvp,
      play,
    ],
  );

  return { playSignal, commands };
}
