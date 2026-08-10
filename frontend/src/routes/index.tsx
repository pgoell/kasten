import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Editor } from "@/components/editor";
import { FileExplorer } from "@/components/file-explorer";
import { KeyHelp } from "@/components/key-help";
import { NoteEditor } from "@/components/note-editor";
import { NoteFinder } from "@/components/note-finder";
import { NotePrompt, noteAfterPrompt, type PromptMode } from "@/components/note-prompt";
import { NoteSearch } from "@/components/note-search";
import { PaneLayout, paneRects, TabStrip } from "@/components/pane-layout";
import { StatusBar } from "@/components/status-bar";
import { TerminalPane } from "@/components/terminal-pane";
import { TerminalPrompt } from "@/components/terminal-prompt";
import { TodoPane } from "@/components/todo-pane";
import { TodoPrompt } from "@/components/todo-prompt";
import { createNote, fetchFiles, fetchNote, fetchTerminals, type SearchHit } from "@/lib/api";
import { readClock } from "@/lib/clock";
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
  openTerminalInFocused,
  openTodosInFocused,
  removeFocused,
  splitFocused,
  stepTab,
  tabPanes,
} from "@/lib/panes";
import { type Period, periodicNote } from "@/lib/periodic";
import { addTodoInVault, cycleTodoInVault, logCycledTodoInVault } from "@/lib/todo-api";
import type { TodoCycle } from "@/lib/todo-commands";
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
  const { status, change, save, saveFirst, revert, isConflicted, allowReload, reconcile } =
    useAutosave(pane.path);
  // The focused pane's note and the hook holding its unsaved text, for the
  // event handler below to read. That handler lives in an effect that opens one
  // stream for the life of the page, so it cannot close over either: opening a
  // note would close the stream and open another.
  const focusedNote = useRef({ path: pane.path, reconcile });
  useEffect(() => {
    focusedNote.current = { path: pane.path, reconcile };
  });
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
  // A flag like the search's: the vault holds one set of todos and the panel
  // asks for all of them, so there is nothing here to start from.
  const [todosOpen, setTodosOpen] = useState(false);
  const [terminalPrompt, setTerminalPrompt] = useState(false);
  // A flag, like the terminal prompt's: the todo is typed out rather than
  // picked, so there is nothing here for it to start from.
  const [todoPrompt, setTodoPrompt] = useState(false);
  // The sessions the prompt offers. Asked for only while it is open: they
  // change when something outside the browser starts one, and nothing else on
  // screen reads them, so there is no reason to hold a copy the rest of the
  // time. A failure answers with none, which the prompt draws as a bare input.
  const { data: terminals } = useQuery({
    queryKey: ["terminals"],
    queryFn: fetchTerminals,
    enabled: terminalPrompt,
  });
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
  // Raised each time a key was refused, which flashes the status bar's reading.
  // A counter for the reason the two above are counters: pressing a refused key
  // twice is two refusals and both have to read as one. How long the flash
  // lasts is the bar's own business.
  const [refused, setRefused] = useState(0);

  /**
   * Decline a key where the reader can see it: the bar's one reading flashes.
   *
   * Answers null, which is what a refused reload hands back. A dozen keys and
   * one form of `:e` come through here, and a key that does nothing and says
   * nothing reads as a key that is broken.
   */
  const refuse = useCallback(() => {
    setRefused((previous) => previous + 1);
    return null;
  }, []);

  /**
   * Rearrange the panes, and hand the focus to whichever one we arrived at.
   *
   * Refused while the open note stands conflicted. Every one of these moves the
   * focused pane, which moves the note the autosave follows, and its cleanup
   * writes what is waiting to the note being left: the overwrite `saveFirst`
   * declines on every path that asks, arriving here with nobody asked.
   *
   * Every key that moves the focus comes through here. The one thing that moves
   * it without doing so is a click into another pane, which the pane layout
   * reports once the browser has already moved it, and which is deliberately
   * left alone below.
   *
   * `closeNote` reaches this after a save, by which point there is no conflict
   * left to catch it.
   */
  const moveTo = useCallback(
    (update: (previous: Layout) => Layout) => {
      if (isConflicted()) {
        refuse();
        return;
      }

      setLayout(update);
      setFocusSignal((previous) => previous + 1);
    },
    [isConflicted, refuse],
  );

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
    // Every open, the first one included. A stream that went down and came
    // back missed whatever the vault did in between: the backend replays
    // nothing and `EventSource` reconnects without saying it ever stopped,
    // which a sleeping laptop or a backend restart guarantees. Asking for the
    // listing on each open closes that hole by construction. Do not trim it
    // back to the reconnects, because there is no way to tell them apart here
    // and the gap comes back with the optimisation.
    //
    // At mount this usually beats the query's own first fetch, and with
    // `cancelRefetch` off it joins that fetch rather than replacing it, so the
    // redundant open costs nothing and the first paint waits on one walk of
    // the vault rather than two.
    stream.onopen = () =>
      queryClient.invalidateQueries({ queryKey: ["files"] }, { cancelRefetch: false });
    stream.onmessage = (message) => {
      const event = parseVaultEvent(message.data);
      if (event === null) return;

      // A note on screen is holding text the vault has moved past, so the query
      // behind it refetches and the editor takes what comes back. Which panes
      // hold the note is not asked: `invalidateQueries` refetches the queries
      // somebody is observing and only marks the rest stale, which is what a
      // note in a background tab wants anyway. A `removed` needs no refetch,
      // there being nothing left to read, and the pane keeps what it has. A
      // `listing` names no note at all.
      //
      // The focused pane is asked first, and it is the only pane that can be
      // asked: it is the one the keys reach, so it is the only one that can be
      // holding text nobody has written yet. A refusal there means the reader's
      // own edits are on screen and the reload would take them off it.
      if (event.change === "written") {
        const { path, reconcile } = focusedNote.current;
        if (event.path !== path || reconcile(event.digest)) {
          queryClient.invalidateQueries(
            { queryKey: ["note", event.path] },
            { cancelRefetch: false },
          );
        }
        // A todo written by an agent or over ssh reaches the pane without a
        // reload. Ahead of the early return below, which fires for a write to
        // a note the tree already draws, and that is most writes. `cancelRefetch`
        // off for the reason the two invalidations beside it have it off.
        queryClient.invalidateQueries({ queryKey: ["todos"] }, { cancelRefetch: false });
      }

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
      //
      // `cancelRefetch` off for the reason it is off above, and here it is the
      // one that decides what a busy vault costs. An agent writing forty notes
      // sends one batch, which arrives as forty-one messages and forty-one
      // tasks, each testing against a listing the refetch has not replaced yet.
      // On the default every one of them would cancel the last and start again,
      // and because `fetchFiles` carries no `AbortSignal` the server walks the
      // whole vault forty-one times regardless. Off, the first walk answers all
      // of them, which is what the backend's own debounce is for.
      const paths = queryClient.getQueryData<string[]>(["files"]);
      if (event.change === "written" && paths?.includes(event.path)) return;
      queryClient.invalidateQueries({ queryKey: ["files"] }, { cancelRefetch: false });
    };
    return () => stream.close();
  }, [queryClient]);

  /**
   * Open a note in the focused pane, once the vault holds what was typed here.
   *
   * Every way in goes through this: the tree, the finder, search and a
   * `[[link]]`. Opening another note moves the autosave's path, and its cleanup
   * writes what is waiting to the note it was typed into, so the same write
   * `<leader>q` refuses is one click away from happening without being asked.
   * The refusal cannot live in that cleanup: by then the path has already
   * changed, and refusing there would trade the other writer's text for the
   * reader's own.
   *
   * The focus is raised with the note, the way every key that moves between
   * panes raises it. Without that, a note opened from the file tree arrives on
   * screen with the focus still on the tree row: the editor takes the focus on
   * mount only when nothing else holds it, and the tree holds it. The note is
   * in front of you and every key you press goes to the panel beside it. A
   * click into a row lands here too and raises it just the same, which is what
   * you want from a click on a note: you asked to read it, not to go on
   * walking the tree.
   */
  const openInPane = useCallback(
    async (path: string, line?: number) => {
      if (!(await saveFirst())) return;

      setLayout((previous) => openInFocused(previous, path, line));
      setFocusSignal((previous) => previous + 1);
    },
    [saveFirst],
  );

  /**
   * Open the note a `[[link]]` names, making it if the vault has none.
   *
   * The listing is what turns a name into a path, so the resolving happens
   * here rather than in the editor, which holds one note and knows nothing of
   * the others. A link to a note that is not there is not a mistake: writing
   * the link before the note is how a vault grows, and following one is the
   * moment the note begins.
   *
   * `body` is what a note this makes starts life with, and it is empty for
   * every link followed by hand: a note the reader is about to write is one
   * they write themselves. Only the periodic keys pass one.
   */
  const follow = useCallback(
    (target: string, body = "") => {
      const paths = data ?? [];
      const path = wikiLinkPath(target, paths);
      if (paths.includes(path)) {
        void openInPane(path);
        return;
      }

      // One write. The blank line is the create's rather than the body's: the
      // text lands under a frontmatter block and wants a line between, and the
      // body is written without one so that a reader of `periodic.ts` sees the
      // heading first.
      void createNote(path, body === "" ? "" : `\n${body}`).then(
        (made) => {
          // The vault's spelling and the vault's text, the way the prompt
          // seeds them, so the editor opens what was written rather than
          // reading back a file it just made.
          queryClient.setQueryData(["note", made.path], made.content);
          queryClient.invalidateQueries({ queryKey: ["files"] });
          void openInPane(made.path);
        },
        () => {
          // The vault refused the path: a hidden name, or a note standing
          // where the link wanted a folder. The note on screen stays open
          // with the link still in it, which is the only place to fix either.
        },
      );
    },
    [data, queryClient, openInPane],
  );

  /**
   * Open the note covering today at one grain, making it if the vault has none.
   *
   * Through `follow`, because that is already the one place a note is made and
   * opened in the same breath, and a periodic note differs from a followed link
   * only in carrying a body. The date is read at the press, so a tab left open
   * overnight opens the new day's note rather than yesterday's.
   */
  const openPeriodic = useCallback(
    (period: Period) => {
      const { path, body } = periodicNote(period, new Date());
      follow(path, body);
    },
    [follow],
  );

  /**
   * The two lists a todo write moves, asked for again rather than left to
   * `/api/events`.
   *
   * The stream is the belt and this the braces: the row you just pressed should
   * redraw off the write it asked for. `["files"]` with it, because both writes
   * can make today's daily note.
   */
  const todosWritten = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["todos"] });
    void queryClient.invalidateQueries({ queryKey: ["files"] });
  }, [queryClient]);

  /**
   * Follow a `<leader>x` into the vault, from the editor.
   *
   * The buffer already carries the cycled line and autosave writes it, so this
   * moves the `## Done` log and nothing else. It reads nothing at all for a
   * press that touches neither end of done, which is most of them.
   */
  const logCycledTodo = useCallback(
    (path: string, cycle: TodoCycle) => {
      void logCycledTodoInVault(path, cycle, readClock(new Date()).date, data ?? []).then(
        todosWritten,
        () => {
          // The vault refused the write. The line in the buffer stands, and the
          // log is one `<leader>x` away from being asked for again.
        },
      );
    },
    [data, todosWritten],
  );

  /** Walk one todo on, in the vault, from the pane's `x`. */
  const cycleTodo = useCallback(
    (hit: SearchHit) => {
      void cycleTodoInVault(hit, readClock(new Date()).date, data ?? []).then(todosWritten, () => {
        // The vault refused the write, or the note moved out from under the
        // row. The list stays as it is, and the next event redraws it.
      });
    },
    [data, todosWritten],
  );

  /**
   * Put a typed todo under `## TODOs` in today's note, from the pane's `a`.
   *
   * The clock is read here rather than in the prompt, so a prompt left open
   * over midnight writes the day it was taken on. The prompt shuts before the
   * write lands: it is asking for one line, and it has that line.
   */
  const addTodo = useCallback(
    (input: string) => {
      setTodoPrompt(false);
      void addTodoInVault(input, readClock(new Date()).date, data ?? []).then(todosWritten, () => {
        // The vault refused the write. Nothing on screen moved with it, so
        // there is nothing here to put back.
      });
    },
    [data, todosWritten],
  );

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
        if (pane.term !== undefined || pane.todos === true) {
          moveTo(clearFocused);
          return;
        }
        if (pane.path === undefined) {
          moveTo(removeFocused);
          return;
        }
        if (await saveFirst()) moveTo(clearFocused);
      },
      showHelp: () => setHelpOpen(true),
      // Saved first the way a rename is, and for the same reason: the note a
      // create makes is opened in the focused pane, which moves the autosave's
      // path out from under text still waiting for the note being left.
      createNote: async (startPath = "") => {
        if (await saveFirst()) setPrompt({ mode: "create", startPath });
      },
      // Save before the prompt opens, not after Enter. `useAutosave` flushes
      // pending text when its path changes, using the render's own closure, so
      // text still waiting when the note moves would be written to a path the
      // vault no longer has. Nothing can be typed into a pane once the modal
      // holds the focus, so flushing here is enough. A failed write keeps the
      // prompt shut with the warning already in the status bar, the way
      // `closeNote` refuses to leave.
      //
      // The refusal it carries is the pane's own note and nothing else. The
      // tree renames whatever its cursor sits on, which is usually not what is
      // open, and a note that changed on disk in one pane is no reason to
      // refuse to move a note somewhere else in the vault.
      renameNote: async (startPath) => {
        const path = startPath ?? pane.path;
        if (path === undefined) return;
        if (!(await saveFirst()) && path === pane.path) return;
        setPrompt({ mode: "rename", startPath: path });
      },
      // Saved first for the reason a note's rename is: the note in the focused
      // pane may be one of the notes this moves, and text still waiting would
      // be written to a path the vault no longer has.
      renameFolder: async (startPath) => {
        // Narrowed the way the note's rename is: only a folder the open note
        // sits under can move that note's path.
        const holdsOpenNote = pane.path?.startsWith(`${startPath}/`) ?? false;
        if (!(await saveFirst()) && holdsOpenNote) return;
        setPrompt({ mode: "folder", startPath });
      },
      // No save first: opening the panel moves no path. Picking a note out of
      // it does, and `openInPane` is where that is asked.
      findNote: () => setFinderOpen(true),
      // The same, and for the same reason.
      searchNotes: () => setSearchOpen(true),
      // The same, and for the same reason.
      findTodos: () => setTodosOpen(true),
      // Saved first, unlike the three above: this one replaces what the pane
      // holds, which unmounts the editor in it and would take unsaved text with
      // it. The same rule `closeNote` follows.
      openTodos: async () => {
        if (await saveFirst()) moveTo(openTodosInFocused);
      },
      // The one command that needs a note open, because what it shows is what
      // links to that note. With an empty pane there is nothing to ask about,
      // and doing nothing is how the key says so.
      showBacklinks: () => setBacklinksOf(pane.path),
      // The same pair read the other way, and the one of the two that reads the
      // note itself. Saved first so the list holds the link you just typed:
      // `saveFirst` puts the text in the cache this reads it back out of. A
      // write that was refused or that failed still opens the panel, on the
      // older text: reading the links is no reason to hide them, and it is no
      // reason to overwrite a note that changed on disk either.
      showLinksOut: async () => {
        if (pane.path === undefined) return;
        await saveFirst();
        const text = queryClient.getQueryData<string>(["note", pane.path]) ?? "";
        setLinksOut(outgoingLinks(text, data ?? []));
      },
      // Five rows for one helper, because a leader binding names a command that
      // takes nothing. What they have in common is in `periodic.ts`.
      openDaily: () => openPeriodic("daily"),
      openWeekly: () => openPeriodic("weekly"),
      openMonthly: () => openPeriodic("monthly"),
      openQuarterly: () => openPeriodic("quarterly"),
      openYearly: () => openPeriodic("yearly"),
      // Both, and in one render: a folded panel has no row to focus.
      focusTree: () => {
        setTreeOpen(true);
        setTreeFocus((previous) => previous + 1);
      },
      createTab: () => moveTo(addTab),
      // No save first: opening the prompt moves no path. Naming a session does
      // replace what is in the pane, and that is asked on the way out below.
      openTerminal: () => setTerminalPrompt(true),
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
    [
      moveTo,
      movePane,
      saveFirst,
      openPeriodic,
      pane.path,
      pane.term,
      pane.todos,
      data,
      queryClient,
    ],
  );

  /**
   * Read the open note off the vault again and answer with its text, `:e`.
   *
   * The other way out of a conflict, `:w` being the one that keeps the buffer.
   * Null back is the refusal `:e` gets on a buffer holding unsaved text.
   *
   * The vault and not the cache: a note that changed under unsaved text is a
   * note this route deliberately did not read again, so what is cached is the
   * text from before that write, which is neither of the two versions in play.
   * `fetchQuery` fills the cache on the way through, so reopening the note
   * reads back what the buffer is about to hold.
   *
   * The discard waits on the read rather than leading it. The other order drops
   * the reader's only copy on the strength of a request that may never land.
   */
  const reload = useCallback(
    async (force: boolean): Promise<string | null> => {
      const path = pane.path;
      if (path === undefined) return null;

      const text = await queryClient.fetchQuery({
        queryKey: ["note", path],
        queryFn: () => fetchNote(path),
        // A note counts as fresh for ten seconds here, and `:e` asked for what
        // the vault holds rather than for whatever that window still has.
        staleTime: 0,
      });
      // A no here is `:e` on a buffer holding edits, and the bar is flashed
      // rather than left saying nothing about a command that did nothing.
      return revert(force) ? text : refuse();
    },
    [pane.path, queryClient, revert, refuse],
  );

  return (
    <main className="flex h-dvh flex-col bg-one-bg">
      {/* min-h-0 lets the editor scroll instead of pushing the bar off-screen. */}
      <div className="flex min-h-0 flex-1">
        <FileExplorer
          paths={data ?? []}
          openPath={pane.path}
          onOpenFile={(path) => void openInPane(path)}
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
              {(shown, focused) =>
                shown.todos === true ? (
                  <TodoPane
                    commands={commands}
                    onOpen={(path, hitLine) => void openInPane(path, hitLine)}
                    onCycle={cycleTodo}
                    onAdd={() => setTodoPrompt(true)}
                    focusSignal={focused ? focusSignal : 0}
                    // Read at the render rather than inside the pane, which
                    // stays a function of the strings it is handed. A tab left
                    // open across midnight keeps yesterday's sections until
                    // something makes it render, which is what the event stream
                    // does the moment anything is written.
                    today={readClock(new Date()).date}
                  />
                ) : shown.term !== undefined ? (
                  <TerminalPane
                    session={shown.term}
                    commands={commands}
                    focusSignal={focused ? focusSignal : 0}
                    focused={focused}
                  />
                ) : shown.path === undefined ? (
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
                    focused={focused}
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
                    focused={focused}
                    // Only the focused pane reports its typing. Nothing else can
                    // be typed into, and an unfocused pane that somehow did
                    // would be writing its text to the focused pane's path.
                    onChange={focused ? change : IGNORE}
                    // Asked for the focused pane alone, for the reason its
                    // typing is reported alone: the autosave follows that pane,
                    // so any other pane asking would be handing it a question
                    // about a note it is not holding. An unfocused pane cannot
                    // be typed into, so it is always clean and always reloads.
                    allowReload={focused ? allowReload : undefined}
                    // The focused pane alone, for the reason its typing is
                    // reported alone: the note this reads is the one the
                    // autosave follows, which is the note in that pane.
                    onReload={focused ? reload : undefined}
                    onSave={save}
                    onFollow={follow}
                    onCycleTodo={logCycledTodo}
                  />
                )
              }
            </PaneLayout>
          </div>
        </div>
      </div>
      <StatusBar status={pane.path === undefined ? undefined : status} flash={refused} />
      {helpOpen && <KeyHelp onClose={() => setHelpOpen(false)} />}
      {terminalPrompt && (
        <TerminalPrompt
          sessions={terminals ?? []}
          onOpen={(session) => {
            setTerminalPrompt(false);
            // Through `moveTo` rather than `setLayout`, so opening a terminal
            // is refused while the note in the focused pane stands conflicted,
            // the same as every other key that moves the focus. The refusal
            // sits on the path that replaces the pane rather than on the key
            // that opens the prompt, which replaces nothing.
            moveTo((previous) => openTerminalInFocused(previous, session));
          }}
          onClose={() => setTerminalPrompt(false)}
        />
      )}
      {todoPrompt && (
        <TodoPrompt
          onAdd={addTodo}
          onClose={() => setTodoPrompt(false)}
          // Read at the render, the way the pane reads it, so the line the
          // prompt draws and the line the write makes are the same day's.
          today={readClock(new Date()).date}
        />
      )}
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
            void openInPane(path);
          }}
          onClose={() => {
            setFinderOpen(false);
            setLinksOut(null);
          }}
        />
      )}
      {/* One panel for all three, because backlinks and todos are the same list
          of lines from the vault, ranked the same way, opened the same way.
          Only where the lines come from differs. */}
      {(searchOpen || backlinksOf !== undefined || todosOpen) && (
        <NoteSearch
          backlinksOf={backlinksOf}
          todos={todosOpen}
          paths={data}
          onOpen={(path, hitLine) => {
            setSearchOpen(false);
            setBacklinksOf(undefined);
            setTodosOpen(false);
            void openInPane(path, hitLine);
          }}
          onClose={() => {
            setSearchOpen(false);
            setBacklinksOf(undefined);
            setTodosOpen(false);
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
