import type { Dispatch, RefObject, SetStateAction } from "react";
import { BookPane } from "@/components/book-pane";
import { ChatPane } from "@/components/chat-pane";
import { ExamPane } from "@/components/exam-pane";
import { GraphPane } from "@/components/graph-pane";
import { HistoryPane } from "@/components/history-pane";
import { HtmlPane } from "@/components/html-pane";
import { ImagePane } from "@/components/image-pane";
import { LogPane } from "@/components/log-pane";
import { NotePane } from "@/components/note-pane";
import { PaneLayout, TabStrip } from "@/components/pane-layout";
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
import { activeTab, focusedPane, focusPane, goToTab, type Layout, tabPanes } from "@/lib/panes";
import type { useAutosave } from "@/lib/use-autosave";
import type { BufferSync } from "@/lib/use-buffer-sync";
import type { GuardedWrites } from "@/lib/use-guarded-writes";
import type { Listings } from "@/lib/use-listings";
import type { LogActions } from "@/lib/use-log-actions";
import type { NoteOpening } from "@/lib/use-note-opening";
import type { TodoActions } from "@/lib/use-todo-actions";

type Autosave = ReturnType<typeof useAutosave>;

/**
 * The panes of the active tab: the tab strip over the split panes, and the
 * one pane each of them holds, drawn by what the pane holds.
 */
export function WorkspacePanes({
  layout,
  narrow,
  inert,
  moveTo,
  setLayout,
  commands,
  focusSignal,
  playSignal,
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
  onNotice,
}: {
  layout: Layout;
  narrow: boolean;
  inert: boolean;
  moveTo: PaneMoves["moveTo"];
  setLayout: Dispatch<SetStateAction<Layout>>;
  commands: TreeCommands;
  focusSignal: number;
  playSignal: number;
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
  onNotice: Dispatch<SetStateAction<string | undefined>>;
}) {
  const tab = activeTab(layout);
  const pane = focusedPane(layout);
  const { data, archive } = listings;
  const { seek, openInPane } = opening;
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
      <TabStrip
        layout={layout}
        onSelect={(index) => moveTo((previous) => goToTab(previous, index))}
      />
      <div className="flex min-h-0 flex-1">
        <PaneLayout
          node={tab.root}
          focus={tab.focus}
          tabId={tab.id}
          narrow={narrow}
          divided={tabPanes(layout).length > 1}
          // The focused pane is the one drawn alone, always: every key
          // that moves the focus turns the zoom off on its way past.
          //
          // Below `md` every tab is drawn that way, a split of 390px being
          // strips nobody can read. The tree is left as it is and so is
          // `tab.zoom`, so the splits are back when the window widens.
          zoomed={narrow || tab.zoom === true ? tab.focus : null}
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
            return shown.log === true ? (
              <LogPane
                commands={commands}
                onOpen={(path, hitLine) => void openInPane(path, hitLine)}
                focusSignal={focused ? focusSignal : 0}
                // The same clock the todo pane reads, for the same reason:
                // a tab left open across midnight shows yesterday until
                // something renders it.
                today={readClock(new Date()).date}
                actions={logActions}
                onNotice={onNotice}
              />
            ) : shown.todos === true ? (
              <TodoPane
                commands={commands}
                onOpen={(path, hitLine) => void openInPane(path, hitLine)}
                onCycle={todos.cycleTodo}
                onAdd={() => onTodoPrompt()}
                onSubtask={(hit) => onTodoPrompt(hit)}
                onEdit={todos.editTodo}
                onBlock={todos.blockTodo}
                onTimer={todos.toggleTimer}
                onAgent={(hit, twins) => void todos.agentTodo(hit, twins)}
                cursorRow={focused ? todoRow : undefined}
                onRefile={(hit, project) => void todos.refileTodo(hit, project)}
                onNotice={onNotice}
                archive={archive}
                focusSignal={focused ? focusSignal : 0}
                // Read at the render rather than inside the pane, which
                // stays a function of the strings it is handed. A tab left
                // open across midnight keeps yesterday's sections until
                // something makes it render, which is what the event stream
                // does the moment anything is written.
                today={readClock(new Date()).date}
              />
            ) : shown.review === true ? (
              <ReviewPane
                commands={commands}
                onClose={() => void commands.closeNote()}
                onOpen={(path) => void openInPane(path)}
                focusSignal={focused ? focusSignal : 0}
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
                onTake={(passage) => void writes.takeHighlight(book, passage)}
                onNotice={onNotice}
                // One pane, the one reading the note the press came from.
                seek={seek?.note === book ? seek : undefined}
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
            ) : shown.pdf !== undefined ? (
              <PdfPane
                path={shown.pdf.path}
                page={shown.pdf.page}
                opened={shown.pdf.opened}
                commands={commands}
                focusSignal={focused ? focusSignal : 0}
              />
            ) : shown.html !== undefined ? (
              <HtmlPane
                path={shown.html}
                commands={commands}
                focusSignal={focused ? focusSignal : 0}
                // A click inside the frame reaches no ancestor, the way a
                // click inside a book does not.
                onFocus={() => setLayout((previous) => focusPane(previous, shown.id))}
              />
            ) : shown.video !== undefined ? (
              <VideoPane
                note={shown.video}
                commands={commands}
                focusSignal={focused ? focusSignal : 0}
                // The one player the key means: the one playing for the
                // note the press came from, or this pane itself when the
                // press came from inside it. `pane.path` is undefined in a
                // pane holding no note and `shown.video` is always a path,
                // so the two never meet by accident.
                playSignal={shown.video === (pane.video ?? pane.path) ? playSignal : 0}
                // Bound here rather than passed back up by the pane, the
                // way the reader's callbacks are: the pane holds no path of
                // its own, so a folder move that rewrites `video` moves
                // this with it.
                onWatched={(id, seconds) => writes.keepPosition(shown.video ?? "", id, seconds)}
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
              />
            );
          }}
        </PaneLayout>
      </div>
    </div>
  );
}
