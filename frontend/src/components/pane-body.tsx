import type { Dispatch, ReactElement, RefObject, SetStateAction } from "react";
import { BookPane } from "@/components/book-pane";
import { ChatPane } from "@/components/chat-pane";
import { ExamPane } from "@/components/exam-pane";
import { FinancePane } from "@/components/finance-pane";
import { GraphPane } from "@/components/graph-pane";
import { HistoryPane } from "@/components/history-pane";
import { HtmlPane } from "@/components/html-pane";
import { ImagePane } from "@/components/image-pane";
import { LogPane } from "@/components/log-pane";
import { NotePane } from "@/components/note-pane";
import { OverviewPane } from "@/components/overview-pane";
import { PdfPane } from "@/components/pdf-pane";
import { PersonPane } from "@/components/person-pane";
import { ReviewPane } from "@/components/review-pane";
import { TerminalPane } from "@/components/terminal-pane";
import { type AgentRow, TodoPane } from "@/components/todo-pane";
import type { PaneMoves } from "@/components/use-pane-moves";
import { VideoPane } from "@/components/video-pane";
import type { SearchHit } from "@/lib/api";
import { readClock } from "@/lib/clock";
import type { TreeCommands } from "@/lib/key-bindings";
import type { LogActions } from "@/lib/log/use-log-actions";
import type { useAutosave } from "@/lib/note/use-autosave";
import type { BufferSync } from "@/lib/note/use-buffer-sync";
import type { NoteOpening } from "@/lib/note/use-note-opening";
import { openBeside } from "@/lib/pane-contents";
import { heldKind, type KindField, type Pane } from "@/lib/pane-kinds";
import { focusPane, type Layout } from "@/lib/panes";
import type { useRsvpAsked } from "@/lib/rsvp/use-rsvp";
import type { TodoActions } from "@/lib/todo/use-todo-actions";
import type { GuardedWrites } from "@/lib/use-guarded-writes";
import type { Listings } from "@/lib/use-listings";
import type { VideoAsks } from "@/lib/video/use-video-player";

/** What every pane is handed, whatever it holds. */
export interface PaneShared {
  commands: TreeCommands;
  focusSignal: number;
  archive: boolean;
  openInPane: NoteOpening["openInPane"];
  onNotice: Dispatch<SetStateAction<string | undefined>>;
}

/** What one kind of pane or another needs beyond the shared context; each body takes its own. */
export interface PaneExtras {
  paths: string[] | undefined;
  setLayout: Dispatch<SetStateAction<Layout>>;
  moveTo: PaneMoves["moveTo"];
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
  autosave: Pick<ReturnType<typeof useAutosave>, "allowReload" | "save">;
  /** The pane `<leader>gl` was pressed in, and how many presses there have been. */
  graphAsk: { pane: string; signal: number };
  /** On a phone, the route's bottom sheet; undefined on a desktop. */
  graphSheet?: (note: string) => void;
  /** The pane `<leader>rr` or `<leader>rh` was pressed in, and how many presses there have been. */
  rsvpAsk: ReturnType<typeof useRsvpAsked>;
  video: VideoAsks;
  /** Opens a note beside its pdf or book, making the note first if the vault has none. */
  noteBeside: (path: string) => Promise<void>;
}

interface At {
  shown: Pane;
  focused: boolean;
  shared: PaneShared;
  extras: PaneExtras;
  /** The focus signal for a pane that takes it only while focused. */
  signal: number;
}

type Body<K extends KindField> = (value: NonNullable<Pane[K]>, at: At) => ReactElement;

/** Only the pane the press was made in is asked to read. */
const rsvpOf = ({ shown, extras }: At) =>
  extras.rsvpAsk.pane === shown.id ? extras.rsvpAsk : undefined;

const note = ({ shown, focused, shared, extras }: At) => (
  <NotePane
    shown={shown}
    focused={focused}
    focusSignal={shared.focusSignal}
    commands={shared.commands}
    preview={extras.preview}
    archive={shared.archive}
    listings={extras.listings}
    opening={extras.opening}
    mark={extras.writes.mark}
    buffer={extras.buffer}
    allowReload={extras.autosave.allowReload}
    onSave={extras.autosave.save}
    onCycleTodo={extras.todos.logCycledTodo}
    onNotice={shared.onNotice}
    graphSignal={extras.graphAsk.pane === shown.id ? extras.graphAsk.signal : 0}
    onGraphPane={() => {
      const path = shown.path;
      if (path !== undefined)
        extras.moveTo((previous) =>
          openBeside(
            previous,
            (pane) => pane.graph?.around === path,
            { graph: { around: path } },
            "row",
          ),
        );
    }}
    onGraphSheet={extras.graphSheet}
    onSeek={extras.video.seek}
    rsvp={rsvpOf({ shown, focused, shared, extras, signal: 0 })}
  />
);

/** One body per kind of `PANE_KINDS`, so a kind with no body fails the type check. */
const BODIES: { [K in KindField]: Body<K> } = {
  path: (_, at) => note(at),
  term: (session, { shared, focused, signal }) => (
    <TerminalPane
      session={session}
      commands={shared.commands}
      focusSignal={signal}
      focused={focused}
    />
  ),
  todos: (_, { shared, extras, focused, signal }) => (
    <TodoPane
      commands={shared.commands}
      onOpen={(path, hitLine) => void shared.openInPane(path, hitLine)}
      onCycle={extras.todos.cycleTodo}
      onAdd={() => extras.onTodoPrompt()}
      onSubtask={(hit) => extras.onTodoPrompt(hit)}
      onEdit={extras.todos.editTodo}
      onBlock={extras.todos.blockTodo}
      onTimer={extras.todos.toggleTimer}
      onAgent={(hit, twins) => void extras.todos.agentTodo(hit, twins)}
      cursorRow={focused ? extras.todoRow : undefined}
      onRefile={(hit, project) => void extras.todos.refileTodo(hit, project)}
      onNotice={shared.onNotice}
      archive={shared.archive}
      focusSignal={signal}
      // Read at the render rather than inside the pane, which
      // stays a function of the strings it is handed. A tab left
      // open across midnight keeps yesterday's sections until
      // something makes it render, which is what the event stream
      // does the moment anything is written.
      today={readClock(new Date()).date}
    />
  ),
  log: (_, { shared, extras, signal }) => (
    <LogPane
      commands={shared.commands}
      onOpen={(path, hitLine) => void shared.openInPane(path, hitLine)}
      focusSignal={signal}
      // The same clock the todo pane reads, for the same reason:
      // a tab left open across midnight shows yesterday until
      // something renders it.
      today={readClock(new Date()).date}
      actions={extras.logActions}
      onNotice={shared.onNotice}
    />
  ),
  overview: (_, { shared, signal }) => (
    <OverviewPane
      commands={shared.commands}
      focusSignal={signal}
      archive={shared.archive}
      // Read at the render, so a tab left open across midnight redraws.
      today={readClock(new Date()).date}
    />
  ),
  finance: (_, { shared, signal }) => (
    <FinancePane
      commands={shared.commands}
      focusSignal={signal}
      onNotice={shared.onNotice}
      today={readClock(new Date()).date}
    />
  ),
  book: (book, at) => (
    <BookPane
      note={book}
      paths={at.extras.paths}
      commands={at.shared.commands}
      focusSignal={at.signal}
      // A click inside foliate's iframe reaches no ancestor, so
      // the pane says so itself. The same path a click into any
      // other pane takes, deliberate lack of a conflict guard
      // included: the browser has already moved the focus.
      onFocus={() => at.extras.setLayout((previous) => focusPane(previous, at.shown.id))}
      // The note is bound here rather than passed back up by the
      // pane, so the pane holds no path of its own and a folder
      // move that rewrites `book` moves both callbacks with it.
      onMoved={(cfi) => at.extras.writes.moved(book, cfi)}
      onLeaving={() => at.extras.writes.flush(book)}
      onTake={(passage) => at.extras.writes.takeHighlight(book, passage)}
      archive={at.shared.archive}
      // The split view of #780, as the pdf pane's Note beside: the
      // book's note opens beside the book.
      onNoteBeside={() => void at.extras.noteBeside(book)}
      onNotice={at.shared.onNotice}
      // One pane, the one reading the note the press came from.
      seek={at.extras.opening.seek?.note === book ? at.extras.opening.seek : undefined}
      rsvp={rsvpOf(at)}
    />
  ),
  exam: (exam, { shared, signal }) => (
    <ExamPane
      note={exam}
      commands={shared.commands}
      onOpen={(path) => void shared.openInPane(path)}
      focusSignal={signal}
    />
  ),
  review: (_, { shared, signal }) => (
    <ReviewPane
      commands={shared.commands}
      onClose={() => void shared.commands.closeNote()}
      onOpen={(path, line) => void shared.openInPane(path, line)}
      focusSignal={signal}
    />
  ),
  image: (image, { shared, extras, signal }) => (
    <ImagePane
      path={image}
      commands={shared.commands}
      focusSignal={signal}
      // Bound here rather than passed back up by the pane, the way
      // the reader's own callbacks are bound: the pane holds no
      // path of its own.
      onDelete={() => void extras.onDeleteImage(image)}
    />
  ),
  pdf: (pdf, at) => (
    <PdfPane
      path={pdf.path}
      page={pdf.page}
      opened={pdf.opened}
      commands={at.shared.commands}
      focusSignal={at.signal}
      archive={at.shared.archive}
      // The note's name is the pdf's with `.md` for `.pdf`, so a
      // `plan.pdf` in `x/` opens `x/plan.md`.
      onNoteBeside={() => void at.extras.noteBeside(`${pdf.path.replace(/\.pdf$/i, "")}.md`)}
      rsvp={rsvpOf(at)}
    />
  ),
  html: (html, at) => (
    <HtmlPane
      path={html}
      anchor={at.shown.anchor}
      archive={at.shared.archive}
      commands={at.shared.commands}
      focusSignal={at.signal}
      // A click inside the frame reaches no ancestor, the way a
      // click inside a book does not.
      onFocus={() => at.extras.setLayout((previous) => focusPane(previous, at.shown.id))}
      rsvp={rsvpOf(at)}
    />
  ),
  video: (video, { shown, shared, extras, signal }) => (
    <VideoPane
      note={video}
      commands={shared.commands}
      focusSignal={signal}
      archive={shared.archive}
      // The one player the key means: see `videoTarget`.
      playSignal={extras.video.playFor(shown.id)}
      // The time link is the anchor line, the chapter words are only
      // the toast's, so the take is written with none.
      onTake={(passage) => extras.writes.takeHighlight(video, { ...passage, chapter: "" })}
      // A click inside the iframe reaches no ancestor, so the pane
      // says so itself, the way the html pane does.
      onFocus={() => extras.setLayout((previous) => focusPane(previous, shown.id))}
      // Only the pane playing the note's video is asked to seek.
      seekSignal={extras.video.seekFor(video)}
      // Bound here rather than passed back up by the pane, the
      // way the reader's callbacks are: the pane holds no path of
      // its own, so a folder move that rewrites `video` moves
      // this with it.
      onWatched={(id, seconds) => extras.writes.keepPosition(video, id, seconds)}
    />
  ),
  person: (person, { shared, extras, signal }) => (
    <PersonPane
      person={person}
      commands={shared.commands}
      paths={extras.paths}
      archive={shared.archive}
      focusSignal={signal}
      onOpen={(path, hitLine) => void shared.openInPane(path, hitLine)}
    />
  ),
  history: (history, { shared, extras, signal }) => (
    <HistoryPane
      note={history}
      commands={shared.commands}
      focusSignal={signal}
      // Bound here, the way the reader's callbacks are, so the
      // pane holds no path the route would write to on its own.
      onRestore={(text, against, from) => extras.writes.restoreOf(history, text, against, from)}
    />
  ),
  graph: (graph, { shared, extras, signal }) => (
    <GraphPane
      around={graph.around}
      commands={shared.commands}
      archive={shared.archive}
      focusSignal={signal}
      onOpen={(path, hitLine) => void shared.openInPane(path, hitLine)}
      onFollow={extras.opening.follow}
    />
  ),
  chat: (_, { shared, signal }) => <ChatPane commands={shared.commands} focusSignal={signal} />,
};

/**
 * The one pane `shown` holds, drawn by its kind. A plain function of its props with no state of
 * its own, so the element at each pane's place keeps its type and the pane is never remounted.
 */
export function PaneBody({
  shown,
  focused,
  shared,
  extras,
}: {
  shown: Pane;
  focused: boolean;
  shared: PaneShared;
  extras: PaneExtras;
}) {
  const at = { shown, focused, shared, extras, signal: focused ? shared.focusSignal : 0 };
  const kind = heldKind(shown);
  // An empty pane is the note pane, which shows Today.
  if (kind === undefined) return note(at);
  return (BODIES[kind] as Body<KindField>)(shown[kind] as never, at);
}

/** Whether a pane holds one of the five kinds that fill the whole pane. */
export function isWholePane(
  pane: Pick<Pane, "overview" | "finance" | "log" | "todos" | "review">,
): boolean {
  return (
    pane.overview === true ||
    pane.finance === true ||
    pane.log === true ||
    pane.todos === true ||
    pane.review === true
  );
}
