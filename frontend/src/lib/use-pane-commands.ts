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
import { askOnCard, openFoodSearch } from "@/lib/log-card";
import { drinkTarget, logDrinkInVault, logDrinkInView } from "@/lib/log-write";
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
import { paneView, useFoodWait } from "@/lib/use-food-wait";
import { wholePaneOpeners } from "@/lib/whole-pane-openers";
import { splitTarget, wikiLinkPath, wikiLinkTargets } from "@/lib/wikilink";

export type PaneCommands = ReturnType<typeof usePaneCommands>;

/**
 * The commands that rearrange the window: what each pane holds, the splits,
 * the moves between panes and the tabs, and the playback signal the video
 * shares with the note.
 */
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
  moves: Pick<PaneMoves, "moveTo" | "focusToward" | "swapToward">;
  openPeriodic: (period: Period) => boolean | Promise<boolean> | undefined;
  setNotice: Dispatch<SetStateAction<string | undefined>>;
  /** The vault's note paths, as the listing holds them; undefined until it loads. */
  paths: string[] | undefined;
  /** The note the focused pane holds, and whether a save of one is in the air. */
  focusedNote: RefObject<{ path: string | undefined; isWriting: (note: string) => boolean }>;
  /** On a phone the local graph is a sheet over the window, not a pane beside the note. */
  sheetGraph?: (note: string) => void;
  /**
   * On a desktop the local graph opens over the note in its pane, or beside it
   * when the margin shows. The pane decides, so this only names the pane asked.
   */
  sideGraph?: (pane: string) => void;
}) {
  const { moveTo, focusToward, swapToward } = moves;
  const queryClient = useQueryClient();
  /**
   * Raised on every `<leader>v`, which is how the note drives the player.
   *
   * The route holds it rather than the pane because the key is pressed in the
   * note and the frame is in another pane, and a counter is what carries "do it
   * again" across the two. Only the pane playing this note's video is handed
   * it; see the render below.
   */
  const [playSignal, setPlaySignal] = useState(0);

  /**
   * Open the book `READING_NOTE` links in the focused pane, over what it held.
   *
   * The config note is read fresh on every press rather than out of the cache
   * or the listing: it is a file edited by hand and by agents, and a 404 is
   * the one answer that says it is not there. Every refusal is checked before
   * the pane changes, so a note with nothing beside it is a sentence at the
   * foot of the window and not a reader drawing its own empty panel.
   */
  const openReadingBook = useCallback(async () => {
    setNotice(undefined);

    // Saved before anything is read, for two reasons: the book replaces what
    // the pane holds, as the book finder's does, and the pane may hold the
    // config note itself, whose new link would otherwise be read as the old.
    // A failed save keeps the note where it is.
    if (!(await saveFirst())) return;

    // The listings through the cache the route's own queries fill, so a press
    // right after load waits for them rather than refusing over a vault it
    // has not been told about yet.
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

    // `wikiLinkPath` falls back to the inbox for a name nothing answers to, a
    // path the listing does not hold, so the listing is what says no note.
    const note = wikiLinkPath(target, paths);
    if (!note.endsWith(".md") || !paths.includes(note)) {
      setNotice(`[[${target}]] in ${noteName(READING_NOTE)}.md names no note`);
      return;
    }

    // The backend's pairing, suffix and case alike, which `withBooks` in the
    // book finder follows too. Both suffixes, the reader opening either.
    const stem = note.slice(0, -".md".length);
    if (!books.some((path) => path === `${stem}.epub` || path === `${stem}.pdf`)) {
      setNotice(`Nothing to read beside ${note}`);
      return;
    }

    // The reader finds the `reading:` place in the note itself.
    moveTo((previous) => openBookInFocused(previous, note));
  }, [queryClient, saveFirst, moveTo, setNotice]);

  const food = useFoodWait(pane.id, pane.path);

  const commands = useMemo<
    Pick<
      TreeCommands,
      | "closeNote"
      | "openTodos"
      | "openLog"
      | "openOverview"
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
      // One key walking back out of the window: the note, then the pane it sat
      // in, then the tab that pane was the last of. A pane holding a note is
      // only emptied, because closing a note and closing the space it was read
      // in are two decisions and the key asks them one at a time.
      //
      // Only leave a note once the vault has the text. A failed write keeps it
      // on screen with the warning already in the status bar, because emptying
      // the pane unmounts the editor and the only copy of the edit goes with it.
      // A note the vault has moved past is not left either: `saveFirst` refuses
      // it, and the pane stays open with `Changed on disk` in the bar until
      // `:w` settles it.
      closeNote: async () => {
        // A terminal and the todo list are taken out of the pane the way a note
        // is, leaving the pane itself on screen. Without this the key went
        // straight to removing the pane, which does nothing at all on the last
        // pane of the last tab, so a window holding one terminal had no way
        // back to an editor and no way to reach any leader key. Nothing is
        // lost: closing the socket detaches a client, and the herdr session
        // goes on running.
        if (
          pane.term !== undefined ||
          pane.chat === true ||
          pane.todos === true ||
          pane.log === true ||
          pane.overview === true ||
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
      // The whole-pane openers: the todo list, the log, the overview, the review and the chat.
      ...wholePaneOpeners(saveFirst, moveTo),
      // Saved first for the reason `openTodos` is: the graph replaces what the
      // pane holds.
      openGraph: async () => {
        if (await saveFirst()) moveTo(openGraphInFocused);
      },
      // Nothing is unmounted and nothing needs saving first, the way `openBook`
      // needs none. A link typed and not yet saved is drawn once the autosave
      // lands. A phone has no room beside the note, so the graph is a sheet there.
      // On a desktop the pane asked draws it, over itself or beside itself.
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
      // Five rows for one helper, because a leader binding names a command that
      // takes nothing. What they have in common is in `periodic.ts`.
      openDaily: () => openPeriodic("daily"),
      // The notice says what landed, or why the vault refused. The line in the
      // notice is the line without its list dash.
      logDrink: (line) => {
        setNotice(undefined);
        const today = periodicNote("daily", new Date()).path;
        const target = drinkTarget({
          today,
          focusedPath: pane.path,
          held: heldText(today) !== undefined,
          writing: focusedNote.current.isWriting(today),
        });
        // Today's note in the focused pane is written in its buffer. Found by the
        // pane and not the focus: the palette's lookup finds no view when the
        // focus sits on the body, the toolbar or a card's field, and the vault
        // write would then land under a note open on screen.
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
        // Asked again when the queue reaches the write: a tap can wait behind a save,
        // and the note can be opened or held meanwhile. The focus is read from the
        // ref, since this closure was made at the press.
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
      // Today's note in the focused pane is searched in place. Any other note is
      // left for `openPeriodic`, which makes today's note when there is none, and
      // the wait `useFoodWait` holds searches it once it is on screen.
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
      // Needs a note in the focused pane, the way `showBacklinks` does: the
      // book is that note's path with the suffix swapped, and there is nothing
      // to swap without one. No `saveFirst`, unlike `openTodos`: this splits
      // rather than replaces, so the editor holding the note stays mounted and
      // nothing unsaved is unmounted. `moveTo` is what refuses the key while
      // that note stands conflicted.
      openBook: () => {
        if (pane.path === undefined) return;
        const note = pane.path;
        moveTo((previous) => openBookBeside(previous, note));
      },
      // Written above, for the refusals it carries.
      openReadingBook: () => void openReadingBook(),
      // Needs a person's note in the focused pane, which is what the type in
      // its frontmatter says. Read out of the cache the editor filled, so a
      // `type: Person` typed and not yet saved is not seen until the autosave
      // lands, the way a link typed into a note is not followed before then.
      // A press over any other note does nothing, which is how the key says
      // this one is not about a person.
      openPerson: () => {
        if (pane.path === undefined) return;
        const note = pane.path;
        if (!isPerson(queryClient.getQueryData<string>(["note", note]) ?? "")) return;
        moveTo((previous) => openPersonBeside(previous, note));
      },
      // Needs a note in the focused pane, and splits rather than replaces, so
      // no `saveFirst` for `openBook`'s reason. Leaving the note flushes what
      // was typed, and the restore refuses while that write is out.
      openHistory: () => {
        if (pane.path === undefined) return;
        const note = pane.path;
        moveTo((previous) => openHistoryBeside(previous, note));
      },
      // Needs a note in the focused pane for the reason `openBook` does: the
      // link is in that note, and the pane reads it out for itself. No
      // `saveFirst` for the same reason either, this splitting rather than
      // replacing. A link typed and not yet saved is not found until the
      // autosave lands, which is the second the typing stops.
      openVideo: () => {
        if (pane.path === undefined) return;
        const note = pane.path;
        moveTo((previous) => openVideoBeside(previous, note));
      },
      // No guard and no `moveTo`: this opens nothing, moves nothing and writes
      // nothing. A press with no player on screen raises a number that no pane
      // is listening to, which is a key that does nothing rather than one that
      // has to check first.
      toggleVideo: () => setPlaySignal((count) => count + 1),
      // Saved first the way `openTodos` is, and for the same reason: this
      // replaces the focused pane, so text still waiting would be written to a
      // pane the autosave no longer follows.
      openExam: async () => {
        if (pane.path === undefined) return;
        const note = pane.path;
        if (await saveFirst()) moveTo((previous) => openExamInFocused(previous, note));
      },
      createTab: () => moveTo(addTab),
      // A bare `nextPane` and `goToTab` inside these reach the imports, not the
      // keys they are written beside: an object literal's keys are not names in
      // the scope its values are written in.
      splitRight: () => moveTo((previous) => splitFocused(previous, "row")),
      splitDown: () => moveTo((previous) => splitFocused(previous, "col")),
      nextPane: () => moveTo(nextPane),
      paneLeft: () => focusToward("left"),
      paneDown: () => focusToward("down"),
      paneUp: () => focusToward("up"),
      paneRight: () => focusToward("right"),
      movePaneLeft: () => swapToward("left"),
      movePaneDown: () => swapToward("down"),
      movePaneUp: () => swapToward("up"),
      movePaneRight: () => swapToward("right"),
      // Not through `moveTo`, the way the archive and the preview are not:
      // this writes nothing, moves no note and moves no focus, so there is
      // nothing for a conflicted note to refuse. Hiding a pane cannot blur the
      // one you are typing in either, which is what the signal `moveTo` raises
      // is for.
      zoomPane: () => setLayout(toggleZoom),
      nextTab: () => moveTo((previous) => stepTab(previous, 1)),
      prevTab: () => moveTo((previous) => stepTab(previous, -1)),
      goToTab: (index) => moveTo((previous) => goToTab(previous, index)),
    }),
    [
      moveTo,
      focusToward,
      swapToward,
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
    ],
  );

  return { playSignal, commands };
}
