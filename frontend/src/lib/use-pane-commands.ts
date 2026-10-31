import { EditorView } from "@codemirror/view";
import { useQueryClient } from "@tanstack/react-query";
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useMemo,
  useState,
} from "react";
import type { PaneMoves } from "@/components/use-pane-moves";
import { fetchAssets, fetchFiles, fetchNote, NoteMissing } from "@/lib/api";
import { heldText } from "@/lib/held-text";
import type { TreeCommands } from "@/lib/key-bindings";
import { READING_NOTE } from "@/lib/layout";
import { askOnCard, openFoodSearch } from "@/lib/log/log-card";
import { drinkTarget, logDrinkInVault, logDrinkInView } from "@/lib/log/log-write";
import { paneView, useFoodWait } from "@/lib/log/use-food-wait";
import { noteName } from "@/lib/note-path";
import {
  clearFocused,
  openBookBeside,
  openBookInFocused,
  openExamInFocused,
  openGraphBeside,
  openGraphInFocused,
  openHistoryBeside,
  openPersonBeside,
  openVideoBeside,
} from "@/lib/pane-contents";
import { paneEditor } from "@/lib/pane-doc";
import {
  addTab,
  goToTab,
  type Layout,
  nextPane,
  type Pane as PaneOf,
  removeFocused,
  splitFocused,
  stepTab,
  toggleZoom,
} from "@/lib/panes";
import { type Period, periodicNote } from "@/lib/periodic";
import { isPerson } from "@/lib/person";
import { askRsvp } from "@/lib/rsvp/use-rsvp";
import { wholePaneOpeners } from "@/lib/whole-pane-openers";
import { splitTarget, wikiLinkPath, wikiLinkTargets } from "@/lib/wikilink";

export type PaneCommands = ReturnType<typeof usePaneCommands>;

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
  pane: Pick<
    PaneOf,
    | "id"
    | "path"
    | "term"
    | "chat"
    | "todos"
    | "log"
    | "overview"
    | "finance"
    | "book"
    | "exam"
    | "review"
    | "image"
    | "pdf"
    | "html"
    | "video"
    | "person"
    | "history"
    | "graph"
  >;
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
  /** Counter, not a flag: each `<leader>v` bumps it, so every press reaches the player. */
  const [playSignal, setPlaySignal] = useState(0);

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

  const food = useFoodWait(pane.id, pane.path);

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
      // Leave a note only once the vault has its text: emptying the pane unmounts the
      // editor, which holds the only copy of an unsaved edit. A refused save keeps it open.
      closeNote: async () => {
        // Cleared like a note, since removing the last pane of the last tab does nothing.
        // Closing the socket only detaches a client; the herdr session keeps running.
        if (
          pane.term !== undefined ||
          pane.chat === true ||
          pane.todos === true ||
          pane.log === true ||
          pane.overview === true ||
          pane.finance === true ||
          pane.book !== undefined ||
          pane.exam !== undefined ||
          pane.review === true ||
          pane.image !== undefined ||
          pane.pdf !== undefined ||
          pane.html !== undefined ||
          pane.video !== undefined ||
          pane.person !== undefined ||
          pane.history !== undefined ||
          pane.graph !== undefined
        ) {
          moveTo(clearFocused);
          return;
        }
        if (pane.path === undefined) {
          moveTo(removeFocused);
          return;
        }
        if (await saveFirst()) moveTo(clearFocused);
      },
      ...wholePaneOpeners(saveFirst, moveTo),
      // Saved first: the graph replaces what the pane holds.
      openGraph: async () => {
        if (await saveFirst()) moveTo(openGraphInFocused);
      },
      // Nothing unmounts, so no saveFirst. A phone has no room beside the note: a sheet there.
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
        moveTo((previous) => openGraphBeside(previous, note));
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
      // No saveFirst: this splits rather than replaces, so nothing unsaved unmounts.
      // moveTo refuses the key while the note is conflicted.
      openBook: () => {
        if (pane.path === undefined) return;
        const note = pane.path;
        moveTo((previous) => openBookBeside(previous, note));
      },
      openReadingBook: () => void openReadingBook(),
      // Reads the cache, so a `type: Person` not yet autosaved is not seen yet.
      openPerson: () => {
        if (pane.path === undefined) return;
        const note = pane.path;
        if (!isPerson(queryClient.getQueryData<string>(["note", note]) ?? "")) return;
        moveTo((previous) => openPersonBeside(previous, note));
      },
      // No saveFirst, as it splits. Leaving the note flushes what was typed, and the
      // restore refuses while that write is out.
      openHistory: () => {
        if (pane.path === undefined) return;
        const note = pane.path;
        moveTo((previous) => openHistoryBeside(previous, note));
      },
      // No saveFirst, as it splits. A link typed but not yet autosaved is not found yet.
      openVideo: () => {
        if (pane.path === undefined) return;
        const note = pane.path;
        moveTo((previous) => openVideoBeside(previous, note));
      },
      // No guard: with no player on screen the number reaches no pane, so the key does nothing.
      toggleVideo: () => setPlaySignal((count) => count + 1),
      // The pane reads its own text, so these only ask it (`use-rsvp.ts`). No moveTo or saveFirst.
      openRsvp: () => readRsvp(false),
      rsvpFromHere: () => readRsvp(true),
      // Saved first: this replaces the focused pane, and unsaved text would go to a
      // pane the autosave no longer follows.
      openExam: async () => {
        if (pane.path === undefined) return;
        const note = pane.path;
        if (await saveFirst()) moveTo((previous) => openExamInFocused(previous, note));
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
      pane.term,
      pane.chat,
      pane.todos,
      pane.log,
      pane.overview,
      pane.finance,
      pane.book,
      pane.exam,
      pane.review,
      pane.image,
      pane.pdf,
      pane.html,
      pane.video,
      pane.person,
      pane.history,
      pane.graph,
      queryClient,
      setNotice,
      food,
      sheetGraph,
      sideGraph,
      readRsvp,
    ],
  );

  return { playSignal, commands };
}
