import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Editor } from "@/components/editor";
import { FileExplorer } from "@/components/file-explorer";
import { KeyHelp } from "@/components/key-help";
import { NoteEditor } from "@/components/note-editor";
import { NoteFinder } from "@/components/note-finder";
import { NotePrompt, noteAfterPrompt, type PromptMode } from "@/components/note-prompt";
import { NoteSearch } from "@/components/note-search";
import { PaneLayout, paneRects, TabStrip } from "@/components/pane-layout";
import { StatusBar } from "@/components/status-bar";
import { createNote, fetchFiles } from "@/lib/api";
import type { TreeCommands } from "@/lib/key-bindings";
import { type Direction, paneToward } from "@/lib/pane-direction";
import {
  activeTab,
  addTab,
  clearFocused,
  emptyLayout,
  focusedPane,
  focusPane,
  goToTab,
  type Layout,
  mapPanes,
  nextPane,
  openInFocused,
  removeFocused,
  splitFocused,
  stepTab,
  tabPanes,
} from "@/lib/panes";
import { useAutosave } from "@/lib/use-autosave";
import { parseVaultEvent } from "@/lib/vault-events";
import { outgoingLinks, wikiLinkPath } from "@/lib/wikilink";

/** What an unfocused pane's editor reports its typing to, which is nowhere. */
const IGNORE = () => {};

interface HomeSearch {
  /** Vault-relative path of the note in the focused pane, absent while it holds none. */
  note?: string;
  /**
   * Line the editor opens on, which only a search hit names.
   *
   * In the URL beside the note so a reload lands back on the match rather than
   * at the top of the note, the way `note` itself survives one.
   */
  line?: number;
}

function Home() {
  const { data } = useQuery({ queryKey: ["files"], queryFn: fetchFiles });
  const { note, line } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();

  // How the window is divided, and what is open in each division. Seeded from
  // the URL once and never read back out of it: the arrangement itself is not
  // in there, so a reload comes back to the note you were reading in a single
  // pane rather than to the tabs you had around it.
  //
  // ponytail: layout is lost on reload. Serialising a tree of splits into a
  // query parameter is its own feature, and tmux is the thing to copy if it
  // ever earns the work: a session that outlives the window.
  const [layout, setLayout] = useState<Layout>(() => emptyLayout(note, line));
  // Raised by every key that moves the focus, so the editor in the pane arrived
  // at takes it. A click raises nothing, having already moved the focus itself.
  const [focusSignal, setFocusSignal] = useState(0);
  const pane = focusedPane(layout);
  const tab = activeTab(layout);
  // One autosave, following the focused pane, because the focused pane is the
  // only one that can be typed into. Moving to another note flushes the text
  // still waiting for the one left behind, which is the same mechanism that
  // has always covered opening a second note in a single window.
  const { status, change, save } = useAutosave(pane.path);
  // Chrome the leader keys reach. It lives up here rather than in the panel
  // because the key that toggles it is pressed inside the editor.
  const [treeOpen, setTreeOpen] = useState(true);
  // Above the remount that opening another note causes, so turning the
  // rendering off stays off until you turn it back on.
  const [preview, setPreview] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  // What the prompt is doing and where it starts, and null while it is closed.
  // One piece of state for both, because a create opening on the vault root
  // starts at "" and that still has to read as open.
  const [prompt, setPrompt] = useState<{ mode: PromptMode; startPath: string } | null>(null);
  // A flag and not a path, unlike the prompt: the finder ranks the whole vault
  // and has nothing to start from.
  const [finderOpen, setFinderOpen] = useState(false);
  // Its own flag rather than a mode of the finder's: that one ranks a vault
  // already in hand, this one asks the backend on a delay, and the two share
  // no state worth folding together.
  const [searchOpen, setSearchOpen] = useState(false);
  // The note whose backlinks are on screen, and undefined while none are. The
  // path and not a flag: the panel asks the vault for that note's name, and
  // the note in the focused pane can change under a panel that is already open.
  const [backlinksOf, setBacklinksOf] = useState<string>();
  // The notes the focused pane's note links to, and null while that panel is
  // shut. Read once when it opens rather than derived per render: the finder
  // ranks the array it is handed and wants the same one back every time.
  const [linksOut, setLinksOut] = useState<string[] | null>(null);
  // Raised to ask the tree for the focus. A counter rather than a flag,
  // because asking twice in a row is two requests and has to read as a change.
  const [treeFocus, setTreeFocus] = useState(0);

  /** Rearrange the panes, and hand the focus to whichever one we arrived at. */
  const moveTo = useCallback((update: (previous: Layout) => Layout) => {
    setLayout(update);
    setFocusSignal((previous) => previous + 1);
  }, []);

  /**
   * Move to the pane in one direction on screen, staying put at the edge.
   *
   * The boxes are read before the layout is touched rather than inside the
   * update, which React is free to run more than once. Nothing happens with no
   * pane that way, so the focus is not raised for a key that moved nothing.
   */
  const movePane = useCallback(
    (dir: Direction) => {
      const target = paneToward(paneRects(), pane.id, dir);
      if (target === null) return;
      moveTo((previous) => focusPane(previous, target));
    },
    [moveTo, pane.id],
  );

  // The URL names the note in the focused pane, so a reload comes back to what
  // you were reading. `replace` rather than a push: moving between panes is not
  // navigation, and one history entry per pane would bury the back button under
  // a walk across the window.
  useEffect(() => {
    navigate({
      search: pane.path === undefined ? {} : { note: pane.path, line: pane.line },
      replace: true,
    });
  }, [pane.path, pane.line, navigate]);

  // The vault is the source of truth, so a note written by an agent or an ssh
  // session is as real as one written here. `/api/events` says what moved and
  // the tree refetches itself.
  //
  // Opened by hand rather than through `openapi-fetch`: the endpoint answers
  // with a `StreamingResponse`, which carries no schema, so `api-types.ts` has
  // no entry to generate a client from. Nothing retries either, because
  // `EventSource` reconnects on its own.
  //
  // `queryClient` never changes identity, so this opens one stream for the
  // life of the page rather than one per note you read.
  useEffect(() => {
    const stream = new EventSource("/api/events");
    // Every open, and the first one is deliberately one invalidation too many.
    // A stream that went down and came back missed whatever the vault did in
    // between: the backend replays nothing and `EventSource` reconnects without
    // saying it ever stopped, which a sleeping laptop or a backend restart
    // guarantees. Asking for the listing on each open closes that hole by
    // construction, and the price is one refetch of a query that just loaded.
    // Do not trim it back to the reconnects, because there is no way to tell
    // them apart here and the gap comes back with the optimisation.
    stream.onopen = () => queryClient.invalidateQueries({ queryKey: ["files"] });
    stream.onmessage = (message) => {
      const event = parseVaultEvent(message.data);
      if (event === null) return;
      // A write to a note the tree already draws changes no row, and this is
      // the test that stands in for the `added` kind the backend deliberately
      // has none of. Read out of the cache rather than off `data` above: the
      // listing is already in there, and depending on it here would close and
      // reopen the stream every time it changed.
      //
      // The listing read here can be known-wrong, and it is left that way. An
      // external delete invalidates, and if the note comes back before that
      // refetch answers, the `written` tests against the array from before it
      // and returns early, so the refetch lands without the note and the tree
      // stays short a row until the next event that changes the listing. It
      // takes two debounce windows inside one `/api/files` round trip, which is
      // narrow on local disk and heals itself. Dropping the early return would
      // close it and refetch the whole listing on every autosave instead, and
      // what that listing costs is the subject of
      // docs/reference/ranking-performance.md.
      const paths = queryClient.getQueryData<string[]>(["files"]);
      if (event.change === "written" && paths?.includes(event.path)) return;
      queryClient.invalidateQueries({ queryKey: ["files"] });
    };
    return () => stream.close();
  }, [queryClient]);

  const commands = useMemo<TreeCommands>(
    () => ({
      toggleTree: () => setTreeOpen((previous) => !previous),
      togglePreview: () => setPreview((previous) => !previous),
      // One key walking back out of the window: the note, then the pane it sat
      // in, then the tab that pane was the last of. A pane holding a note is
      // only emptied, because closing a note and closing the space it was read
      // in are two decisions and the key asks them one at a time.
      //
      // Only leave a note once the vault has the text. A failed write keeps it
      // on screen with the warning already in the status bar, because emptying
      // the pane unmounts the editor and the only copy of the edit goes with it.
      closeNote: async () => {
        if (pane.path === undefined) {
          moveTo(removeFocused);
          return;
        }
        if (await save()) moveTo(clearFocused);
      },
      showHelp: () => setHelpOpen(true),
      createNote: (startPath = "") => setPrompt({ mode: "create", startPath }),
      // Save before the prompt opens, not after Enter. `useAutosave` flushes
      // pending text when its path changes, using the render's own closure, so
      // text still waiting when the note moves would be written to a path the
      // vault no longer has. Nothing can be typed into a pane once the modal
      // holds the focus, so flushing here is enough. A failed write keeps the
      // prompt shut with the warning already in the status bar, the way
      // `closeNote` refuses to leave.
      renameNote: async (startPath) => {
        const path = startPath ?? pane.path;
        if (path === undefined) return;
        if (await save()) setPrompt({ mode: "rename", startPath: path });
      },
      // Saved first for the reason a note's rename is: the note in the focused
      // pane may be one of the notes this moves, and text still waiting would
      // be written to a path the vault no longer has.
      renameFolder: async (startPath) => {
        if (await save()) setPrompt({ mode: "folder", startPath });
      },
      // No save first, unlike the two renames. They move a path out from under
      // text still waiting to be written; opening a note leaves every path
      // where it is, and `useAutosave` flushes on its own when the path it was
      // given changes.
      findNote: () => setFinderOpen(true),
      // No save first, for the reason the finder needs none: searching moves
      // no path out from under text still waiting to be written.
      searchNotes: () => setSearchOpen(true),
      // The one command that needs a note open, because what it shows is what
      // links to that note. With an empty pane there is nothing to ask about,
      // and doing nothing is how the key says so.
      showBacklinks: () => setBacklinksOf(pane.path),
      // The same pair read the other way, and the one of the two that reads the
      // note itself. Saved first so the list holds the link you just typed:
      // `save` puts the text in the cache this reads it back out of. A write
      // that failed still opens the panel on the older text, because reading
      // the links is no reason to hide them.
      showLinksOut: async () => {
        if (pane.path === undefined) return;
        await save();
        const text = queryClient.getQueryData<string>(["note", pane.path]) ?? "";
        setLinksOut(outgoingLinks(text, data ?? []));
      },
      // Both, and in one render: a folded panel has no row to focus.
      focusTree: () => {
        setTreeOpen(true);
        setTreeFocus((previous) => previous + 1);
      },
      createTab: () => moveTo(addTab),
      // A bare `nextPane` and `goToTab` inside these reach the imports, not the
      // keys they are written beside: an object literal's keys are not names in
      // the scope its values are written in.
      splitRight: () => moveTo((previous) => splitFocused(previous, "row")),
      splitDown: () => moveTo((previous) => splitFocused(previous, "col")),
      nextPane: () => moveTo(nextPane),
      paneLeft: () => movePane("left"),
      paneDown: () => movePane("down"),
      paneUp: () => movePane("up"),
      paneRight: () => movePane("right"),
      nextTab: () => moveTo((previous) => stepTab(previous, 1)),
      prevTab: () => moveTo((previous) => stepTab(previous, -1)),
      goToTab: (index) => moveTo((previous) => goToTab(previous, index)),
    }),
    [moveTo, movePane, save, pane.path, data, queryClient],
  );

  /**
   * Open the note a `[[link]]` names, making it if the vault has none.
   *
   * The listing is what turns a name into a path, so the resolving happens
   * here rather than in the editor, which holds one note and knows nothing of
   * the others. A link to a note that is not there is not a mistake: writing
   * the link before the note is how a vault grows, and following one is the
   * moment the note begins. No save first, for the reason the finder needs
   * none: this moves no path out from under text still waiting to be written.
   */
  const follow = useCallback(
    (target: string) => {
      const paths = data ?? [];
      const path = wikiLinkPath(target, paths);
      if (paths.includes(path)) {
        setLayout((previous) => openInFocused(previous, path));
        return;
      }

      void createNote(path).then(
        (made) => {
          // The vault's spelling and the vault's text, the way the prompt
          // seeds them, so the editor opens what was written rather than
          // reading back a file it just made.
          queryClient.setQueryData(["note", made.path], made.content);
          queryClient.invalidateQueries({ queryKey: ["files"] });
          setLayout((previous) => openInFocused(previous, made.path));
        },
        () => {
          // The vault refused the path: a hidden name, or a note standing
          // where the link wanted a folder. The note on screen stays open with
          // the link still in it, which is the only place to fix either.
        },
      );
    },
    [data, queryClient],
  );

  return (
    <main className="flex h-dvh flex-col bg-one-bg">
      {/* min-h-0 lets the editor scroll instead of pushing the bar off-screen. */}
      <div className="flex min-h-0 flex-1">
        <FileExplorer
          paths={data ?? []}
          openPath={pane.path}
          onOpenFile={(path) => setLayout((previous) => openInFocused(previous, path))}
          open={treeOpen}
          onOpenChange={setTreeOpen}
          commands={commands}
          focusSignal={treeFocus}
        />
        {/* min-w-0 lets the panes shrink instead of pushing the tree off-screen.
            The strip sits inside this column rather than over the whole window,
            so the tabs line up with the panes they divide. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <TabStrip
            layout={layout}
            onSelect={(index) => moveTo((previous) => goToTab(previous, index))}
          />
          <div className="flex min-h-0 flex-1">
            <PaneLayout
              node={tab.root}
              focus={tab.focus}
              divided={tabPanes(layout).length > 1}
              onFocus={(id) => setLayout((previous) => focusPane(previous, id))}
            >
              {(shown, focused) =>
                shown.path === undefined ? (
                  // An empty pane is an editor on an empty document, which is
                  // what the window has always shown with no note open. It
                  // costs nothing and it is what keeps every leader key working
                  // in a fresh split: the alternative is a second resolver for
                  // panes that hold no CodeMirror to press keys into.
                  //
                  // ponytail: text typed into one goes nowhere, and closing the
                  // pane discards it. Give it a scratch path in the vault if
                  // that ever costs anybody real writing.
                  <Editor
                    initialDoc=""
                    commands={commands}
                    preview={preview}
                    paths={data}
                    focusSignal={focused ? focusSignal : 0}
                    onFollow={follow}
                  />
                ) : (
                  <NoteEditor
                    path={shown.path}
                    commands={commands}
                    preview={preview}
                    paths={data}
                    startLine={shown.line}
                    focusSignal={focused ? focusSignal : 0}
                    // Only the focused pane reports its typing. Nothing else can
                    // be typed into, and an unfocused pane that somehow did
                    // would be writing its text to the focused pane's path.
                    onChange={focused ? change : IGNORE}
                    onSave={save}
                    onFollow={follow}
                  />
                )
              }
            </PaneLayout>
          </div>
        </div>
      </div>
      <StatusBar status={pane.path === undefined ? undefined : status} />
      {helpOpen && <KeyHelp onClose={() => setHelpOpen(false)} />}
      {prompt !== null && (
        <NotePrompt
          mode={prompt.mode}
          paths={data ?? []}
          startPath={prompt.startPath}
          openNote={pane.path}
          onOpen={(path) => {
            const { mode, startPath } = prompt;
            setPrompt(null);
            setLayout((previous) =>
              mode === "create"
                ? openInFocused(previous, path)
                : // A rename is read across every pane of every tab, not just
                  // the one in front of you: one note can be open in several
                  // panes at once, and all of them are looking at the file that
                  // just moved. `noteAfterPrompt` answers undefined for a pane
                  // holding something the move did not touch.
                  mapPanes(previous, (shown) => {
                    const next = noteAfterPrompt(mode, startPath, path, shown.path);
                    return next === undefined ? shown : { ...shown, path: next };
                  }),
            );
          }}
          onClose={() => setPrompt(null)}
        />
      )}
      {/* One panel for both, because the notes one note links to are a list of
          notes like any other: ranked the same, previewed the same, opened the
          same. Only how short the list is differs. */}
      {(finderOpen || linksOut !== null) && (
        <NoteFinder
          paths={linksOut ?? data ?? []}
          outgoing={linksOut !== null}
          onOpen={(path) => {
            setFinderOpen(false);
            setLinksOut(null);
            // No line: the finder opens a note, not a place in one, and a
            // stale `line` left behind would drop the cursor somewhere the
            // previous search happened to point at. `openInFocused` writes the
            // pane whole, which is what drops it.
            setLayout((previous) => openInFocused(previous, path));
          }}
          onClose={() => {
            setFinderOpen(false);
            setLinksOut(null);
          }}
        />
      )}
      {/* One panel for both, because backlinks are the same list of lines from
          the vault, ranked the same way, opened the same way. Only where the
          lines come from differs. */}
      {(searchOpen || backlinksOf !== undefined) && (
        <NoteSearch
          backlinksOf={backlinksOf}
          paths={data}
          onOpen={(path, hitLine) => {
            setSearchOpen(false);
            setBacklinksOf(undefined);
            setLayout((previous) => openInFocused(previous, path, hitLine));
          }}
          onClose={() => {
            setSearchOpen(false);
            setBacklinksOf(undefined);
          }}
        />
      )}
    </main>
  );
}

export const Route = createFileRoute("/")({
  component: Home,
  // The note in the focused pane lives in the URL, so a reload keeps its place.
  // Anything that is not a string reads as no note open.
  validateSearch: (search: Record<string, unknown>): HomeSearch => ({
    note: typeof search.note === "string" ? search.note : undefined,
    // Anything that is not a line number reads as no line, which covers a
    // hand-typed URL as well as the absence of one.
    line:
      Number.isInteger(Number(search.line)) && Number(search.line) > 0
        ? Number(search.line)
        : undefined,
  }),
});
