import { useQueryClient } from "@tanstack/react-query";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Editor } from "@/components/editor";
import { LocalGraph } from "@/components/local-graph";
import { NoteEditor } from "@/components/note-editor";
import { Outline } from "@/components/note-margins";
import { PersonFooter } from "@/components/person-card";
import { Sheet } from "@/components/sheet";
import { TodayPane } from "@/components/today-pane";
import { heldText } from "@/lib/held-text";
import type { TreeCommands } from "@/lib/key-bindings";
import type { Outline as OutlineState } from "@/lib/note-head";
import type { Pane } from "@/lib/panes";
import type { useAutosave } from "@/lib/use-autosave";
import type { BufferSync } from "@/lib/use-buffer-sync";
import type { GuardedWrites } from "@/lib/use-guarded-writes";
import type { Listings } from "@/lib/use-listings";
import type { NoteOpening } from "@/lib/use-note-opening";
import { usePaneWide } from "@/lib/use-pane-wide";
import type { TodoActions } from "@/lib/use-todo-actions";

type Autosave = ReturnType<typeof useAutosave>;

/** What an unfocused pane's editor reports its typing to, which is nowhere. */
const IGNORE = () => {};

/** The note in a pane, or the empty editor a pane holds before any note is opened in it. */
export function NotePane({
  shown,
  focused,
  focusSignal,
  commands,
  preview,
  archive,
  listings,
  opening,
  mark,
  buffer,
  allowReload,
  onSave,
  onCycleTodo,
  onNotice,
  graphSignal,
  onGraphPane,
  onGraphSheet,
}: {
  shown: Pane;
  focused: boolean;
  focusSignal: number;
  commands: TreeCommands;
  preview: boolean;
  archive: boolean;
  listings: Pick<Listings, "data" | "linkable" | "images" | "tags" | "relations">;
  opening: Pick<NoteOpening, "follow" | "embeds" | "openPassage" | "openInPane">;
  mark: GuardedWrites["mark"];
  buffer: Pick<BufferSync, "held" | "standbyReload" | "typed" | "reload">;
  allowReload: Autosave["allowReload"];
  onSave: Autosave["save"];
  onCycleTodo: TodoActions["logCycledTodo"];
  onNotice: Dispatch<SetStateAction<string | undefined>>;
  /** Raised for this pane by `Space gl`. 0 means never asked. */
  graphSignal: number;
  /** Space gl in a wide pane: the graph pane beside the note. */
  onGraphPane: () => void;
  /** On a phone: the route's bottom sheet, which holds the graph. */
  onGraphSheet?: (note: string) => void;
}) {
  const queryClient = useQueryClient();
  const { held, standbyReload, typed, reload } = buffer;
  const { follow, embeds, openPassage, openInPane } = opening;
  const { linkable, images, tags, relations, data } = listings;
  const reader = useRef<HTMLDivElement>(null);
  const wide = usePaneWide(reader);
  // The local graph's side sheet, for a pane too narrow for the margin. Shut
  // whenever the margin takes its place, and when the pane shows another note.
  const [sheetOpen, setSheetOpen] = useState(false);
  const openGraph = () => {
    if (shown.path === undefined) return;
    if (onGraphSheet) onGraphSheet(shown.path);
    else if (wide) onGraphPane();
    else setSheetOpen(true);
  };
  // The editor is memoised, so the press it holds is one function for the
  // note's life, which reads the latest `openGraph` when pressed.
  const latestOpenGraph = useRef(openGraph);
  latestOpenGraph.current = openGraph;
  const onGraph = useCallback(() => latestOpenGraph.current(), []);
  useEffect(() => {
    if (wide) setSheetOpen(false);
  }, [wide]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: shown.path is the trigger, and a sheet on another note is shut
  useEffect(() => {
    setSheetOpen(false);
  }, [shown.path]);
  // The signal a mount starts from is seen, not acted on, so a pane remounted
  // with its old count does not open the graph again.
  const seenSignal = useRef(graphSignal);
  // biome-ignore lint/correctness/useExhaustiveDependencies: openGraph is read at the change only, and the signal is the trigger
  useEffect(() => {
    // 0 is what a pane holds when another pane was asked: it is not a request here.
    const asked = graphSignal !== 0 && graphSignal !== seenSignal.current;
    seenSignal.current = graphSignal;
    if (asked) openGraph();
  }, [graphSignal]);
  // The outline the editor reports, kept with the path it was reported for.
  // A note that fails to open or is still loading has no editor reporting,
  // so the last note's outline would otherwise stay in the margin, and a
  // click on it would reach a view that is gone.
  const [reported, setReported] = useState<{ path: string; outline: OutlineState }>();
  const outline =
    reported !== undefined && reported.path === shown.path ? reported.outline : undefined;
  // One callback per note, so a render hands the editor nothing new to take in.
  const shownPath = shown.path;
  const onOutline = useCallback(
    (reading: OutlineState) => setReported({ path: shownPath ?? "", outline: reading }),
    [shownPath],
  );

  return shown.path === undefined ? (
    // An empty pane is an editor on an empty document, which is
    // what the window has always shown with no note open. It
    // costs nothing and it is what keeps every leader key working
    // in a fresh split: the alternative is a second resolver for
    // panes that hold no CodeMirror to press keys into.
    //
    // Today sits above that editor rather than in place of it, so
    // the keys an empty pane always took still reach the editor.
    //
    // ponytail: text typed into one goes nowhere, and closing the
    // pane discards it. Give it a scratch path in the vault if
    // that ever costs anybody real writing.
    // Below 768 px the whole pane scrolls as one, so Today's last section is
    // reachable and the editor's first line is never under it. From 768 up,
    // Today takes at most 70% and the editor keeps what is left.
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="shrink-0 md:max-h-[70%] md:overflow-y-auto">
        <TodayPane
          archive={archive}
          onOpen={(path, line) => void openInPane(path, line)}
          onReview={() => commands.openReview()}
        />
      </div>
      <div className="min-h-[40%] flex-1">
        <Editor
          initialDoc=""
          commands={commands}
          preview={preview}
          paths={linkable}
          images={images}
          tags={tags}
          focusSignal={focused ? focusSignal : 0}
          focused={focused}
          onFollow={follow}
          embeds={embeds}
        />
      </div>
    </div>
  ) : (
    // A column rather than the editor alone, so a person's note
    // can carry their card at its foot. `PersonFooter` draws
    // nothing under every other note, which leaves the editor the
    // whole pane it has always had.
    //
    // The margins are drawn over the editor, not beside it, so the
    // editor keeps the whole pane and its own scroller. The grid
    // does not scroll, which keeps the outline and the links in view
    // while the note scrolls under them.
    <div className="flex h-full min-h-0 flex-col">
      <div ref={reader} data-reader className="k-reader relative min-h-0 flex-1">
        <div className="h-full">
          <NoteEditor
            onGraph={onGraph}
            path={shown.path}
            commands={commands}
            preview={preview}
            paths={linkable}
            images={images}
            tags={tags}
            relations={relations}
            startLine={shown.line}
            jump={shown.jump}
            focusSignal={focused ? focusSignal : 0}
            focused={focused}
            // Only the focused pane reports its typing. Nothing else can
            // be typed into, and an unfocused pane that somehow did
            // would be writing its text to the focused pane's path.
            onChange={focused ? typed : IGNORE}
            // Asked for the focused pane alone, for the reason its
            // typing is reported alone: the autosave follows that pane,
            // so any other pane asking would be handing it a question
            // about a note it is not holding. An unfocused pane cannot
            // be typed into, so it reloads, except where it shows text
            // held as a conflict: see `standbyReload`.
            allowReload={focused ? allowReload : standbyReload(shown.id)}
            // The focused pane alone, for the reason its typing is
            // reported alone: the note this reads is the one the
            // autosave follows, which is the note in that pane.
            onReload={focused ? reload : undefined}
            // Every pane, not the focused one alone: a restored
            // pane out of focus has to open on the held text too,
            // or the autosave finds the vault's text on screen
            // when the focus arrives and never offers it (#495).
            // It takes the text on that arrival, the editor
            // showing it; till then `standbyReload` keeps it there.
            // `held` is read for the re-render, `heldText` for the
            // content, which the list does not carry. Against the
            // cached text, the entry the autosave would take.
            held={
              held.some((each) => each.path === shown.path)
                ? heldText(shown.path, queryClient.getQueryData<string>(["note", shown.path]))
                    ?.content
                : undefined
            }
            mark={mark?.note === shown.path ? mark : undefined}
            onSave={onSave}
            onFollow={follow}
            onCycleTodo={onCycleTodo}
            onOpenHighlight={openPassage}
            onNotice={onNotice}
            embeds={embeds}
            onOutline={onOutline}
          />
        </div>
        <div data-reader-grid className="k-reader-grid">
          <aside data-margin="outline" className="k-margin">
            <Outline outline={outline} />
          </aside>
          <div />
          <aside data-margin="links" className="k-margin">
            {/* Asked for only while the pane is wide: the margin is hidden below it, and
                a graph nobody can see is a query nobody needs. */}
            {wide && (
              <LocalGraph
                path={shown.path}
                archive={archive}
                onOpen={(path, line) => void openInPane(path, line)}
                onFollow={follow}
              />
            )}
          </aside>
        </div>
        <Sheet
          side
          open={sheetOpen && !wide}
          onClose={() => setSheetOpen(false)}
          label="Local graph"
        >
          {/* The margin's own top padding, so the switch sits level with the breadcrumb. */}
          <div className="px-4 pt-6 pb-6">
            <LocalGraph
              path={shown.path}
              archive={archive}
              onOpen={(path, line) => {
                setSheetOpen(false);
                void openInPane(path, line);
              }}
              onFollow={(target) => {
                setSheetOpen(false);
                follow(target);
              }}
            />
          </div>
        </Sheet>
      </div>
      <PersonFooter
        path={shown.path}
        paths={data}
        archive={archive}
        onOpen={(path, hitLine) => void openInPane(path, hitLine)}
      />
    </div>
  );
}
