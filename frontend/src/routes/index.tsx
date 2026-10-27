import { EditorView } from "@codemirror/view";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { CommandPalette } from "@/components/command-palette";
import { FileExplorer } from "@/components/file-explorer";
import { KeyHelp } from "@/components/key-help";
import { LocalGraph } from "@/components/local-graph";
import { Sheet } from "@/components/sheet";
import { StatusBar } from "@/components/status-bar";
import type { AgentRow } from "@/components/todo-pane";
import { Toolbar } from "@/components/toolbar";
import { TopBar } from "@/components/top-bar";
import { useFinders } from "@/components/use-finders";
import { usePaneMoves } from "@/components/use-pane-moves";
import { usePrompts } from "@/components/use-prompts";
import { WhichKey } from "@/components/which-key";
import { WorkspacePanes } from "@/components/workspace-panes";
import { heldText } from "@/lib/held-text";
import type { TreeCommands } from "@/lib/key-bindings";
import { askLogConfig, logConfig, subscribeLogConfig } from "@/lib/log-config";
import { DEFAULT_CONFIG } from "@/lib/log-kinds";
import { paletteEntries } from "@/lib/palette";
import { openOnTop } from "@/lib/pane-contents";
import { docIn } from "@/lib/pane-doc";
import { activeTab, emptyLayout, focusedPane, type Layout, panesOf, tabPanes } from "@/lib/panes";
import { parseWeek } from "@/lib/search-weeks";
import { useTodoActions } from "@/lib/todo/use-todo-actions";
import { useAutosave } from "@/lib/use-autosave";
import { useBufferSync } from "@/lib/use-buffer-sync";
import { useFileTransfer } from "@/lib/use-file-transfer";
import { useGuardedWrites } from "@/lib/use-guarded-writes";
import { useKeyHelp } from "@/lib/use-key-help-key";
import { useKeyboardInset } from "@/lib/use-keyboard-inset";
import { useListings } from "@/lib/use-listings";
import { useLogActions } from "@/lib/use-log-actions";
import { useNoteOpening } from "@/lib/use-note-opening";
import { usePaneCommands } from "@/lib/use-pane-commands";
import { useTrash } from "@/lib/use-trash";
import { useTreeDrawer } from "@/lib/use-tree-drawer";
import { useVaultEvents } from "@/lib/use-vault-events";
import { useViewport } from "@/lib/use-viewport";
import { loadWorkspace } from "@/lib/workspace";

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
  week?: string;
}

function Home() {
  const listings = useListings();
  const {
    data,
    version,
    images,
    html,
    assets,
    linkable,
    tags,
    relations,
    archive,
    shown,
    shownImages,
    shownHtml,
    shownPdfs,
  } = listings;
  const { note, line, week } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();

  // Read up here rather than beside the drawer below, because which device
  // this is decides which saved workspace the layout starts from.
  const { narrow, coarse } = useViewport();
  // What this device had open when it last drew, read once (#495). Its own
  // state so the layout and the tree start from the one read: a second read
  // would re-id every pane again for nothing.
  const [saved] = useState(() => loadWorkspace(coarse));
  // The key it came from, which every save goes back to: a pointer that
  // changes mid-session (a mouse plugged into a tablet) would otherwise write
  // this layout over the other device's.
  const [savedAs] = useState(coarse);
  // How the window is divided, and what is open in each division. Restored
  // from this device's saved workspace, then the URL's note opened over it:
  // a link that names a note wins, and a plain reload, whose URL names the
  // focused pane's note, finds it already there and changes nothing.
  //
  // In the initializer and not an effect, so the first render already draws
  // the restored panes and no editor mounts on a pane about to be replaced.
  const [layout, setLayout] = useState<Layout>(() => {
    const start =
      saved === null
        ? emptyLayout(note, line)
        : note === undefined
          ? saved.layout
          : openOnTop(saved.layout, note, line);
    // A note left standing conflicted keeps the vault's text from before the
    // other write in the cache, which the effect on `held` below drops only
    // where no pane reads it. A pane this layout starts with reads it from its
    // first render, so it would open on that text as the vault's and never see
    // the vault come to hold the kept text: dropped here, before any pane
    // mounts, for every pane the first render draws.
    for (const each of start.tabs.flatMap((tab) => panesOf(tab.root))) {
      if (each.path !== undefined && heldText(each.path)?.conflicted) {
        queryClient.removeQueries({ queryKey: ["note", each.path], exact: true });
      }
    }
    return start;
  });
  // Raised by every key that moves the focus, so the editor in the pane arrived
  // at takes it. A click raises nothing, having already moved the focus itself.
  const [focusSignal, setFocusSignal] = useState(0);
  const pane = focusedPane(layout);
  const tab = activeTab(layout);
  const panes = tabPanes(layout);
  // One autosave, following the focused pane, because the focused pane is the
  // only one that can be typed into. Moving to another note flushes the text
  // still waiting for the one left behind, which is the same mechanism that
  // has always covered opening a second note in a single window.
  //
  // The focused pane's document as it stands on screen, which the autosave
  // checks before it takes held text into a pane that was already open, and
  // the bar diffs against the vault's while the note stands conflicted.
  const focusedDoc = () => docIn(pane.id);
  // The layout as of this render, for callbacks kept across renders to read
  // a pane's note at the moment they are asked rather than when made.
  const layoutNow = useRef(layout);
  layoutNow.current = layout;
  const {
    status,
    restored,
    reason,
    change,
    save,
    saveFirst,
    revert,
    isConflicted,
    isWriting,
    allowReload,
    reconcile,
  } = useAutosave(pane.path, focusedDoc, pane.id);
  const { refused, refuse, refocusPane, moveTo, focusToward, swapToward } = usePaneMoves({
    setLayout,
    setFocusSignal,
    isConflicted,
    saveFirst,
    paneId: pane.id,
  });
  const buffer = useBufferSync({
    autosave: { status, change, isConflicted, isWriting, revert },
    paneId: pane.id,
    path: pane.path,
    layoutNow,
    refuse,
  });
  const { held, decline } = buffer;
  // The focused pane's note and the hook holding its unsaved text, for
  // `useVaultEvents` to read. That handler lives in an effect that opens one
  // stream for the life of the page, so it cannot close over either: opening a
  // note would close the stream and open another.
  // `isWriting` rides along for the bookmark write, which reads it at the
  // moment its `PUT` answers rather than at the moment it started.
  const focusedNote = useRef({ path: pane.path, reconcile, isWriting, isConflicted });
  useEffect(() => {
    focusedNote.current = { path: pane.path, reconcile, isWriting, isConflicted };
  });
  // A phone: the one place the toolbar is drawn, and the rail is not.
  const phone = narrow && coarse;
  // The whole frame makes room for a keyboard that covers the page, so the
  // cursor's line, the bar and the toolbar all stay above it. A finger alone
  // decides it and not the width: a tablet has the same keyboard.
  const frame = useRef<HTMLElement>(null);
  const keyboard = useKeyboardInset(frame, coarse);
  const drawer = useTreeDrawer({ narrow, saved, savedAs, layout, focusSignal });
  const { treeOpen, setTreeOpen, treeFocus, treeReveal } = drawer;
  // Above the remount another note causes, so preview off stays off.
  const [preview, setPreview] = useState(true);
  const [helpOpen, setHelpOpen] = useKeyHelp();
  // On a phone the local graph is a sheet over the window: the note it is drawn
  // around, and whether the sheet is up. The sheet keeps the note while it goes down.
  const [graphSheet, setGraphSheet] = useState({ note: "", open: false });
  const openGraphSheet = useCallback((note: string) => setGraphSheet({ note, open: true }), []);
  // On a desktop `<leader>gl` asks the focused pane for its graph, which the pane
  // draws over itself or in the margin. Counted, so a second press asks again.
  const [graphAsk, setGraphAsk] = useState({ pane: "", signal: 0 });
  const askSideGraph = useCallback(
    (pane: string) => setGraphAsk((previous) => ({ pane, signal: previous.signal + 1 })),
    [],
  );
  // The editor the palette opened over, held so its edits and inserts have a
  // buffer to write into, or null over a pane with none. `row` is the todo
  // pane's cursor row, taken at the open, so the entry acts on the row shown.
  const [palette, setPalette] = useState<{
    view: EditorView | null;
    row: AgentRow | null;
  } | null>(null);
  // The focused todo pane's cursor row, which only that pane writes.
  const todoRow = useRef<AgentRow | null>(null);
  // One sentence about an upload that failed, drawn at the foot of the window.
  // Cleared on the next press of the key rather than on a timer: a timer is a
  // third clearing mechanism nobody asked for, and one sentence in a corner is
  // information rather than litter.
  const [notice, setNotice] = useState<string>();

  useVaultEvents(focusedNote, decline);

  const guarded = useGuardedWrites({ focusedNote, panePath: pane.path, setNotice });

  const opening = useNoteOpening({
    listings: { data, html, assets, linkable },
    layoutNow,
    focusedNote,
    setLayout,
    setFocusSignal,
    saveFirst,
    moveTo,
    setNotice,
  });
  const { openInPane, openHtmlInPane, openImageInPane, openPdfFromTree, openPeriodic } = opening;
  const trash = useTrash({ panePath: pane.path, setLayout, saveFirst, refuse, openInPane });
  const { discardImage } = trash;
  const todos = useTodoActions({ data, archive, write: guarded.write, focusedNote, setNotice });
  const logActions = useLogActions({ data, write: guarded.write, focusedNote, setNotice });
  const { todosWritten, agentTodo } = todos;
  const prompts = usePrompts({
    data,
    panePath: pane.path,
    narrow,
    setLayout,
    saveFirst,
    moves: { moveTo, refocusPane },
    openInPane,
    todosWritten,
    setNotice,
  });
  const { openTodoPrompt } = prompts;
  const paneCommands = usePaneCommands({
    pane,
    setLayout,
    saveFirst,
    moves: { moveTo, focusToward, swapToward },
    openPeriodic,
    setNotice,
    paths: data,
    focusedNote,
    sheetGraph: phone ? openGraphSheet : undefined,
    sideGraph: phone ? undefined : askSideGraph,
  });
  const { playSignal } = paneCommands;
  const files = useFileTransfer({ data, pane, saveFirst, openInPane, setNotice });
  const finders = useFinders({
    listings: { data, shown, assets, html, archive },
    panePath: pane.path,
    saveFirst,
    moves: { moveTo, refocusPane },
    openInPane,
    openFile: opening.openFile,
    linkMentionOf: guarded.linkMentionOf,
    week,
    onWeek: (next) =>
      navigate({ search: (previous) => ({ ...previous, week: next }), replace: true }),
    toggleArchive: listings.commands.toggleArchive,
  });

  // The URL names the note in the focused pane, so a reload comes back to what
  // you were reading. `replace` rather than a push: moving between panes is not
  // navigation, and one history entry per pane would bury the back button under
  // a walk across the window.
  //
  // The note and not its line: the line belongs to the open that set it, and
  // the cursor has moved on since. Written down, a reload would read it as a
  // link asking for that line (`openOnTop`) and jump the cursor back over the
  // spot the editor saved.
  useEffect(() => {
    navigate({
      search: {
        ...(pane.path === undefined ? {} : { note: pane.path }),
        ...(finders.searchOpen && week !== undefined ? { week } : {}),
      },
      replace: true,
    });
  }, [pane.path, navigate, week, finders.searchOpen]);

  const commands = useMemo<TreeCommands>(
    () => ({
      ...drawer.commands,
      ...listings.commands,
      ...paneCommands.commands,
      ...trash.commands,
      ...prompts.commands,
      ...finders.commands,
      ...files.commands,
      togglePreview: () => setPreview((previous) => !previous),
      showHelp: () => setHelpOpen(true),
      openPalette: () => {
        const focused = document.activeElement;
        const view = focused instanceof HTMLElement ? EditorView.findFromDOM(focused) : null;
        setPalette({ view, row: view === null ? todoRow.current : null });
      },
    }),
    [
      drawer.commands,
      listings.commands,
      paneCommands.commands,
      trash.commands,
      prompts.commands,
      finders.commands,
      files.commands,
      setHelpOpen,
    ],
  );
  // The palette reads the same store as the cards, so its `Log` rows and each
  // card's kinds follow log.md together. The palette asks on mount, since it draws
  // the config with no card to ask for it. A failed read keeps the last kinds, and
  // a missing note gives the defaults.
  const config = useSyncExternalStore(subscribeLogConfig, logConfig);
  useEffect(askLogConfig, []);
  const kinds = (config ?? DEFAULT_CONFIG).kinds;

  // The palette's rows, built only while it is open. One array per open,
  // because the palette ranks its rows again whenever `entries` arrives new and
  // an event renders the route under it (#592).
  const entries = useMemo(() => {
    if (palette === null) return null;
    const listed = paletteEntries(commands, palette.view, kinds);
    const row = palette.row;
    if (row === null) return listed;
    // The pane's `@`, which is no leader key and so in no list above: named
    // here so the palette finds it by name and teaches the key, as it does the
    // rest. Only over the todo pane, the one place there is a row to act on.
    return [
      ...listed,
      {
        label: "Send the todo under the cursor to the agent, or take it back",
        keys: "@",
        run: () => void agentTodo(row.hit, row.twins),
      },
    ];
  }, [commands, palette, agentTodo, kinds]);

  const closeGraphSheet = useCallback(
    () => setGraphSheet((previous) => ({ ...previous, open: false })),
    [],
  );

  // `clip`, not `hidden`: `hidden` makes a scroll box, and the sticky tabs would scroll away.
  return (
    <main ref={frame} className="safe-frame flex h-dvh flex-col overflow-x-clip bg-k-bg">
      <TopBar commands={commands} count={data?.length ?? 0} inert={narrow && treeOpen} />
      {/* min-h-0 lets the editor scroll instead of pushing the bar off-screen. */}
      <div className="flex min-h-0 flex-1">
        <FileExplorer
          // Filtered here rather than at the fetch. The unfiltered listing is
          // what resolves a `[[wikilink]]`, so the editors below still get
          // `data` whole and `gf` into the archive works with this off.
          paths={shown}
          // The same archive filter the notes answer to. An image in the
          // archive is archived like everything else under that folder.
          images={shownImages}
          html={shownHtml}
          pdfs={shownPdfs}
          // What the focused pane holds, whichever of the fields carries it. A
          // reader and an exam name the note they were opened from, so the tree
          // marks that note and `<leader>E` reaches it from either.
          openPath={
            pane.path ?? pane.book ?? pane.exam ?? pane.image ?? pane.html ?? pane.pdf?.path
          }
          onOpenFile={(path) => void openInPane(path)}
          onOpenImage={(path) => void openImageInPane(path)}
          onOpenHtml={(path) => void openHtmlInPane(path)}
          onOpenPdf={(path) => void openPdfFromTree(path)}
          open={treeOpen}
          onOpenChange={setTreeOpen}
          commands={commands}
          focusSignal={treeFocus}
          revealSignal={treeReveal}
          onLeave={refocusPane}
        />
        <WorkspacePanes
          layout={layout}
          narrow={narrow}
          keyboard={keyboard}
          inert={narrow && treeOpen}
          moveTo={moveTo}
          setLayout={setLayout}
          commands={commands}
          focusSignal={focusSignal}
          playSignal={playSignal}
          graphAsk={graphAsk}
          graphSheet={phone ? openGraphSheet : undefined}
          preview={preview}
          listings={{ data, archive, linkable, images, tags, relations }}
          opening={opening}
          writes={guarded}
          todos={todos}
          logActions={logActions}
          onTodoPrompt={openTodoPrompt}
          todoRow={todoRow}
          onDeleteImage={discardImage}
          buffer={buffer}
          autosave={{ allowReload, save }}
          status={status}
          onNotice={setNotice}
        />
      </div>
      <StatusBar
        status={pane.path === undefined ? undefined : status}
        reason={reason}
        // Every held entry but the one in the open buffer, which `status`
        // reads for. Any other entry of that note is not in the buffer, so it
        // is listed too.
        held={held.filter((each) => each.entry !== restored)}
        flash={refused}
        archive={archive}
        notice={notice}
        version={version}
        zoom={tab.zoom}
        // Narrow only: the bar says which pane of the stack has the focus.
        pane={
          narrow && panes.length > 1
            ? `${panes.findIndex((each) => each.id === pane.id) + 1}/${panes.length}`
            : undefined
        }
        inert={narrow && treeOpen}
        foot={!phone}
        onWrite={() => void save()}
        onTakeVault={buffer.takeVault}
        conflict={buffer.conflict}
      />
      {phone && <Toolbar commands={commands} split={panes.length > 1} inert={narrow && treeOpen} />}
      {helpOpen && <KeyHelp onClose={() => setHelpOpen(false)} />}
      <WhichKey phone={phone} />
      <Sheet open={graphSheet.open} onClose={closeGraphSheet} label="Local graph">
        {/* The sheet's paper runs to the screen's edges, so the graph and lists keep off them. */}
        <div className="px-4 pb-6">
          <LocalGraph
            key={graphSheet.note}
            path={graphSheet.note}
            archive={archive}
            onOpen={(path, line) => {
              closeGraphSheet();
              void openInPane(path, line);
            }}
            onFollow={(target) => {
              closeGraphSheet();
              opening.follow(target);
            }}
          />
        </div>
      </Sheet>

      {entries && <CommandPalette entries={entries} onClose={() => setPalette(null)} />}
      {prompts.element}
      {finders.element}
      {files.element}
    </main>
  );
}

export const Route = createFileRoute("/")({
  component: Home,
  // The note in the focused pane lives in the URL, so a reload keeps its place.
  // Anything that is not a string reads as no note open.
  validateSearch: (search: Record<string, unknown>): HomeSearch => ({
    note: typeof search.note === "string" ? search.note : undefined,
    week: parseWeek(search.week),
    // Anything that is not a line number reads as no line, which covers a
    // hand-typed URL as well as the absence of one.
    line:
      Number.isInteger(Number(search.line)) && Number(search.line) > 0
        ? Number(search.line)
        : undefined,
  }),
});
