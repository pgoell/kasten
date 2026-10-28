import { useQueryClient } from "@tanstack/react-query";
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useRef,
  useState,
} from "react";
import { BookPane } from "@/components/book-pane";
import { ChatPane } from "@/components/chat-pane";
import { ExamPane } from "@/components/exam-pane";
import { GraphPane } from "@/components/graph-pane";
import { HistoryPane } from "@/components/history-pane";
import { HtmlPane } from "@/components/html-pane";
import { ImagePane } from "@/components/image-pane";
import { NotePane } from "@/components/note-pane";
import { PaneLayout } from "@/components/pane-layout";
import { PdfPane } from "@/components/pdf-pane";
import { PersonPane } from "@/components/person-pane";
import { isUnsaved, TabStrip } from "@/components/tab-strip";
import { TerminalPane } from "@/components/terminal-pane";
import type { AgentRow } from "@/components/todo-pane";
import type { PaneMoves } from "@/components/use-pane-moves";
import { VideoPane } from "@/components/video-pane";
import { isWholePane, WholePane } from "@/components/whole-pane";
import type { SearchHit } from "@/lib/api";
import type { TreeCommands } from "@/lib/key-bindings";
import type { LogActions } from "@/lib/log/use-log-actions";
import type { SaveStatus, useAutosave } from "@/lib/note/use-autosave";
import type { BufferSync } from "@/lib/note/use-buffer-sync";
import { makeNote, type NoteOpening } from "@/lib/note/use-note-opening";
import { openGraphBeside, openNoteBeside } from "@/lib/pane-contents";
import {
  activeTab,
  closeTab,
  focusedPane,
  focusPane,
  goToTab,
  homeTab,
  type Layout,
  tabPanes,
} from "@/lib/panes";
import { useRsvpAsked } from "@/lib/rsvp/use-rsvp";
import type { TodoActions } from "@/lib/todo/use-todo-actions";
import type { GuardedWrites } from "@/lib/use-guarded-writes";
import type { Listings } from "@/lib/use-listings";

type Autosave = ReturnType<typeof useAutosave>;

/** Whether a pane of the active tab plays `note`'s video, so a time in that note can seek it. */
export function seekTarget(layout: Layout, note: string): boolean {
  return tabPanes(layout).some((each) => each.video === note);
}

/** The seek a time asked for, counted so the same time asked twice seeks twice. */
interface SeekAsk {
  note: string;
  seconds: number;
  id?: string;
  signal: number;
}

/** The next ask after `previous`, one count on. */
export function nextSeek(previous: SeekAsk, note: string, seconds: number, id?: string): SeekAsk {
  return { note, seconds, id, signal: previous.signal + 1 };
}

/**
 * The video pane a `Space v` press plays in, fixed at the press.
 *
 * Read on every render, a pane that became the target after the press would play
 * on the old count, so the target is taken when the count moves and kept.
 */
export function pressTarget(
  previous: { signal: number; target: string | undefined },
  playSignal: number,
  layout: Layout,
): { signal: number; target: string | undefined } {
  if (playSignal === previous.signal) return previous;
  return { signal: playSignal, target: videoTarget(layout) };
}

/**
 * The video pane `Space v` plays in: the focused one, else the one playing the
 * focused note's video, else the first of the tab. Undefined when the tab holds
 * no video pane, so the key has nothing to play.
 */
export function videoTarget(layout: Layout): string | undefined {
  const focused = focusedPane(layout);
  if (focused.video !== undefined) return focused.id;
  const videos = tabPanes(layout).filter((each) => each.video !== undefined);
  return (videos.find((each) => each.video === focused.path) ?? videos[0])?.id;
}

/**
 * The panes of the active tab: the tab strip over the split panes, and the
 * one pane each of them holds, drawn by what the pane holds.
 */
export function WorkspacePanes({
  layout,
  narrow,
  keyboard,
  inert,
  moveTo,
  setLayout,
  commands,
  focusSignal,
  playSignal,
  graphAsk,
  graphSheet,
  preview,
  listings,
  opening,
  writes,
  todos,
  logActions,
  onTodoPrompt,
  todoRow,
  onDeleteImage,
  buffer,
  autosave,
  status,
  onNotice,
}: {
  layout: Layout;
  narrow: boolean;
  /** Whether an on-screen keyboard is up, which shows a narrow split's focused pane alone. */
  keyboard: boolean;
  inert: boolean;
  moveTo: PaneMoves["moveTo"];
  setLayout: Dispatch<SetStateAction<Layout>>;
  commands: TreeCommands;
  focusSignal: number;
  playSignal: number;
  /** The pane `<leader>gl` was pressed in, and how many presses there have been. */
  graphAsk: { pane: string; signal: number };
  /** On a phone, the route's bottom sheet; undefined on a desktop. */
  graphSheet?: (note: string) => void;
  preview: boolean;
  listings: Pick<Listings, "data" | "archive" | "linkable" | "images" | "tags" | "relations">;
  opening: Pick<NoteOpening, "seek" | "openInPane" | "follow" | "embeds" | "openPassage">;
  writes: Pick<
    GuardedWrites,
    "mark" | "moved" | "flush" | "keepPosition" | "takeHighlight" | "restoreOf"
  >;
  todos: Pick<
    TodoActions,
    | "cycleTodo"
    | "editTodo"
    | "blockTodo"
    | "toggleTimer"
    | "agentTodo"
    | "refileTodo"
    | "logCycledTodo"
  >;
  logActions: LogActions;
  onTodoPrompt: (parent?: SearchHit) => void;
  todoRow: RefObject<AgentRow | null>;
  onDeleteImage: (path: string) => void;
  buffer: Pick<BufferSync, "held" | "standbyReload" | "typed" | "reload">;
  autosave: Pick<Autosave, "allowReload" | "save">;
  status: SaveStatus;
  onNotice: Dispatch<SetStateAction<string | undefined>>;
}) {
  const tab = activeTab(layout);
  // The pane `<leader>rr` or `<leader>rh` was pressed in, and how many presses there have been.
  const rsvpAsk = useRsvpAsked();
  const { data, archive } = listings;
  const { seek, openInPane } = opening;
  const queryClient = useQueryClient();
  // The target of the press, held from the press on: see `pressTarget`.
  const pressed = useRef<{ signal: number; target: string | undefined }>({
    signal: 0,
    target: undefined,
  });
  pressed.current = pressTarget(pressed.current, playSignal, layout);
  // The layout is read through a ref so the callback the notes hold stays put.
  const [seekAsk, setSeekAsk] = useState<SeekAsk>({ note: "", seconds: 0, signal: 0 });
  const layoutNow = useRef(layout);
  layoutNow.current = layout;
  const seekVideo = useCallback(
    (note: string, seconds: number, id?: string) => {
      if (!seekTarget(layoutNow.current, note)) {
        onNotice("No player is open for this note: Space g v opens it");
        return;
      }
      setSeekAsk((previous) => nextSeek(previous, note, seconds, id));
    },
    [onNotice],
  );

  /**
   * Open a note beside the pdf it belongs to, making the note first if the vault
   * has none.
   *
   * The making is `makeNote`, the step `follow` takes for a `[[link]]` to a
   * missing note. A refused path says so in the bar and leaves the pdf alone.
   */
  async function noteBeside(path: string) {
    let note = path;
    if (!data?.includes(path)) {
      // The list can be behind the vault: a note made since it was read answers
      // 409, and that note is the one wanted, not a refusal.
      const made = await makeNote(queryClient, path, "", true);
      if (made === undefined) {
        onNotice(`The vault refused ${path}`);
        return;
      }
      note = made;
    }
    moveTo((previous) => openNoteBeside(previous, note));
  }
  return (
    /* min-w-0 lets the panes shrink instead of pushing the tree off-screen.
        The strip sits inside this column rather than over the whole window,
        so the tabs line up with the panes they divide. */
    <div
      // Out of reach under an open drawer, so Tab stays in the drawer and
      // nothing is typed into a note behind the backdrop.
      inert={inert}
      className="flex min-w-0 flex-1 flex-col"
    >
      {/* Every change here goes through `moveTo`, the same guard a move takes:
          closing the note's tab flushes its text first, and is refused while
          the note stands conflicted. */}
      <TabStrip
        layout={layout}
        narrow={narrow}
        onSelect={(index) => moveTo((previous) => goToTab(previous, index))}
        onClose={(index) => moveTo((previous) => closeTab(previous, index))}
        onHome={() => moveTo((previous) => homeTab(previous))}
        unsaved={(each) => isUnsaved(each, each.id === tab.id, buffer.held, status)}
      />
      <div className="flex min-h-0 flex-1">
        <PaneLayout
          node={tab.root}
          focus={tab.focus}
          tabId={tab.id}
          narrow={narrow}
          divided={tabPanes(layout).length > 1}
          // Below `md` a split is stacked (`PaneLayout`), except while the
          // keyboard is up: two panes would leave ~100px to type in. The tree
          // and `tab.zoom` are kept, so the stack returns with the window or
          // the keyboard.
          zoomed={tab.zoom === true || (narrow && keyboard) ? tab.focus : null}
          // The one way to another pane that `moveTo` does not stand in
          // front of, and it stays that way on purpose. This is reported
          // after the browser has moved the focus, so declining it would
          // leave the cursor blinking in a pane the border says is not the
          // focused one, and pulling the focus back is a fight with the
          // browser over a note that is already only one `:w` from being
          // settled. So a click into another pane while the open note
          // stands conflicted still leaves it, and the flush still writes.
          // A test pins that, so closing it later is a decision rather than
          // an accident.
          onFocus={(id) => setLayout((previous) => focusPane(previous, id))}
        >
          {(shown, focused) => {
            // Bound out of the pane here, because TypeScript stops
            // narrowing a property inside the two callbacks below and the
            // bookmark's note has to be a path rather than a maybe.
            const book = shown.book;
            // Bound out of the pane for the reason `book` is: TypeScript
            // stops narrowing a property inside the callback below.
            const image = shown.image;
            // Bound out of the pane for the same reason as `book`.
            const pdf = shown.pdf;
            const video = shown.video;
            const note = shown.path;
            // Only the pane the press was made in is asked to read.
            const rsvp = rsvpAsk.pane === shown.id ? rsvpAsk : undefined;
            return isWholePane(shown) ? (
              <WholePane
                pane={shown}
                commands={commands}
                focused={focused}
                focusSignal={focusSignal}
                archive={archive}
                openInPane={openInPane}
                logActions={logActions}
                onNotice={onNotice}
                todos={todos}
                onTodoPrompt={onTodoPrompt}
                todoRow={todoRow}
              />
            ) : shown.exam !== undefined ? (
              <ExamPane
                note={shown.exam}
                commands={commands}
                onOpen={(path) => void openInPane(path)}
                focusSignal={focused ? focusSignal : 0}
              />
            ) : book !== undefined ? (
              <BookPane
                note={book}
                paths={data}
                commands={commands}
                focusSignal={focused ? focusSignal : 0}
                // A click inside foliate's iframe reaches no ancestor, so
                // the pane says so itself. The same path a click into any
                // other pane takes, deliberate lack of a conflict guard
                // included: the browser has already moved the focus.
                onFocus={() => setLayout((previous) => focusPane(previous, shown.id))}
                // The note is bound here rather than passed back up by the
                // pane, so the pane holds no path of its own and a folder
                // move that rewrites `book` moves both callbacks with it.
                onMoved={(cfi) => writes.moved(book, cfi)}
                onLeaving={() => writes.flush(book)}
                onTake={(passage) => writes.takeHighlight(book, passage)}
                archive={archive}
                // The split view of #780, as the pdf pane's Note beside: the
                // book's note opens beside the book.
                onNoteBeside={() => void noteBeside(book)}
                onNotice={onNotice}
                // One pane, the one reading the note the press came from.
                seek={seek?.note === book ? seek : undefined}
                rsvp={rsvp}
              />
            ) : image !== undefined ? (
              <ImagePane
                path={image}
                commands={commands}
                focusSignal={focused ? focusSignal : 0}
                // Bound here rather than passed back up by the pane, the way
                // the reader's own callbacks are bound: the pane holds no
                // path of its own.
                onDelete={() => void onDeleteImage(image)}
              />
            ) : pdf !== undefined ? (
              <PdfPane
                path={pdf.path}
                page={pdf.page}
                opened={pdf.opened}
                commands={commands}
                focusSignal={focused ? focusSignal : 0}
                archive={archive}
                // The note's name is the pdf's with `.md` for `.pdf`, so a
                // `plan.pdf` in `x/` opens `x/plan.md`.
                onNoteBeside={() => void noteBeside(`${pdf.path.replace(/\.pdf$/i, "")}.md`)}
                rsvp={rsvp}
              />
            ) : shown.html !== undefined ? (
              <HtmlPane
                path={shown.html}
                anchor={shown.anchor}
                archive={archive}
                commands={commands}
                focusSignal={focused ? focusSignal : 0}
                // A click inside the frame reaches no ancestor, the way a
                // click inside a book does not.
                onFocus={() => setLayout((previous) => focusPane(previous, shown.id))}
                rsvp={rsvp}
              />
            ) : video !== undefined ? (
              <VideoPane
                note={video}
                commands={commands}
                focusSignal={focused ? focusSignal : 0}
                archive={archive}
                // The one player the key means: see `videoTarget`. A press
                // with no video pane on screen raises a number nothing reads.
                playSignal={shown.id === pressed.current.target ? playSignal : 0}
                // The time link is the anchor line, the chapter words are only
                // the toast's, so the take is written with none.
                onTake={(passage) => writes.takeHighlight(video, { ...passage, chapter: "" })}
                // A click inside the iframe reaches no ancestor, so the pane
                // says so itself, the way the html pane does.
                onFocus={() => setLayout((previous) => focusPane(previous, shown.id))}
                // Only the pane playing the note's video is asked to seek.
                seekSignal={
                  seekAsk.note === video
                    ? { seconds: seekAsk.seconds, signal: seekAsk.signal, id: seekAsk.id }
                    : undefined
                }
                // Bound here rather than passed back up by the pane, the
                // way the reader's callbacks are: the pane holds no path of
                // its own, so a folder move that rewrites `video` moves
                // this with it.
                onWatched={(id, seconds) => writes.keepPosition(video, id, seconds)}
              />
            ) : shown.person !== undefined ? (
              <PersonPane
                person={shown.person}
                commands={commands}
                paths={data}
                archive={archive}
                focusSignal={focused ? focusSignal : 0}
                onOpen={(path, hitLine) => void openInPane(path, hitLine)}
              />
            ) : shown.history !== undefined ? (
              <HistoryPane
                note={shown.history}
                commands={commands}
                focusSignal={focused ? focusSignal : 0}
                // Bound here, the way the reader's callbacks are, so the
                // pane holds no path the route would write to on its own.
                onRestore={(text, against, from) =>
                  writes.restoreOf(shown.history ?? "", text, against, from)
                }
              />
            ) : shown.graph !== undefined ? (
              <GraphPane
                around={shown.graph.around}
                commands={commands}
                archive={archive}
                focusSignal={focused ? focusSignal : 0}
                onOpen={(path, hitLine) => void openInPane(path, hitLine)}
                onFollow={opening.follow}
              />
            ) : shown.term !== undefined ? (
              <TerminalPane
                session={shown.term}
                commands={commands}
                focusSignal={focused ? focusSignal : 0}
                focused={focused}
              />
            ) : shown.chat === true ? (
              <ChatPane commands={commands} focusSignal={focused ? focusSignal : 0} />
            ) : (
              <NotePane
                shown={shown}
                focused={focused}
                focusSignal={focusSignal}
                commands={commands}
                preview={preview}
                archive={archive}
                listings={listings}
                opening={opening}
                mark={writes.mark}
                buffer={buffer}
                allowReload={autosave.allowReload}
                onSave={autosave.save}
                onCycleTodo={todos.logCycledTodo}
                onNotice={onNotice}
                graphSignal={graphAsk.pane === shown.id ? graphAsk.signal : 0}
                onGraphPane={() => {
                  if (note !== undefined) moveTo((previous) => openGraphBeside(previous, note));
                }}
                onGraphSheet={graphSheet}
                onSeek={seekVideo}
                rsvp={rsvp}
              />
            );
          }}
        </PaneLayout>
      </div>
    </div>
  );
}
