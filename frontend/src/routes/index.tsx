import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookPane } from "@/components/book-pane";
import { ClipPrompt } from "@/components/clip-prompt";
import { Editor } from "@/components/editor";
import { ExamPane } from "@/components/exam-pane";
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
import {
  ASSET_LIMIT_BYTES,
  createNote,
  deleteFolder,
  deleteNote,
  fetchFiles,
  fetchNote,
  fetchPage,
  fetchTerminals,
  fetchTrash,
  restoreEntry,
  type SearchHit,
  saveNote,
  uploadBook,
} from "@/lib/api";
import { visible } from "@/lib/archive";
import { clipPage } from "@/lib/clip";
import { readClock } from "@/lib/clock";
import type { TreeCommands } from "@/lib/key-bindings";
import { setField } from "@/lib/note-frontmatter";
import { bookNote } from "@/lib/note-path";
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
  openBookBeside,
  openExamInFocused,
  openInFocused,
  openTerminalInFocused,
  openTodosInFocused,
  removeFocused,
  splitFocused,
  stepTab,
  tabPanes,
} from "@/lib/panes";
import { type Period, periodicNote } from "@/lib/periodic";
import { parseTodo, type TodoState } from "@/lib/todo";
import {
  addSubtaskInVault,
  addTodoInVault,
  cycleTodoAside,
  cycleTodoInVault,
  editTodoInVault,
  toggleTimerInVault,
} from "@/lib/todo-api";
import type { TodoCycle } from "@/lib/todo-commands";
import { useAutosave } from "@/lib/use-autosave";
import { useBookmark } from "@/lib/use-bookmark";
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
  /**
   * Whether the archive is in what the four lookups answer with.
   *
   * React state and nothing more, so a reload puts it back to hidden. That is
   * the same bargain the pane arrangement makes, and the safer default of the
   * two: a lookup that quietly kept showing finished work would be the mode you
   * forgot you were in.
   */
  const [archive, setArchive] = useState(false);
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
  const {
    status,
    reason,
    change,
    save,
    saveFirst,
    revert,
    isConflicted,
    isWriting,
    adopt,
    allowReload,
    reconcile,
  } = useAutosave(pane.path);
  // The focused pane's note and the hook holding its unsaved text, for the
  // event handler below to read. That handler lives in an effect that opens one
  // stream for the life of the page, so it cannot close over either: opening a
  // note would close the stream and open another.
  // `isWriting` and `adopt` ride along for the bookmark write, which reads them
  // at the moment its `PUT` answers rather than at the moment it started.
  const focusedNote = useRef({ path: pane.path, reconcile, isWriting, adopt });
  useEffect(() => {
    focusedNote.current = { path: pane.path, reconcile, isWriting, adopt };
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
  // A flag like the terminal's: what the prompt takes is typed, not picked, so
  // there is nothing to open it on.
  const [clipPrompt, setClipPrompt] = useState(false);
  // Whether the todo prompt is open, and the row it opened on where `s` opened
  // it. The todo is typed out rather than picked, so the parent is the whole of
  // what this holds: it decides which note the line lands in.
  const [todoPrompt, setTodoPrompt] = useState<{ parent?: SearchHit } | null>(null);
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
  // One sentence about an upload that failed, drawn at the foot of the window.
  // Cleared on the next press of the key rather than on a timer: a timer is a
  // third clearing mechanism nobody asked for, and one sentence in a corner is
  // information rather than litter.
  const [notice, setNotice] = useState<string>();
  // The browser's own file picker, which is a hidden input and a click on it.
  const picker = useRef<HTMLInputElement>(null);

  /**
   * Hand the keys back to the pane a prompt was opened over.
   *
   * The prompt gives the focus back to the element it took it from, and a write
   * that moves the row it was taken from leaves that element detached: the
   * browser then holds the focus on the body and the pane is deaf to every key
   * after it. This is the signal the pane already answers to when a key moves
   * to it, and it lands after the prompt's own handback.
   */
  const refocusPane = useCallback(() => setFocusSignal((previous) => previous + 1), []);

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
   * Write one reading position into the note beside the book.
   *
   * The route owns this rather than the pane, because only the route knows
   * which pane has the focus, and the whole point of the write is not landing
   * on a note somebody has their hands in.
   *
   * Answers whether the vault took it. A no leaves the position waiting for the
   * next chance, and nothing here throws.
   */
  const writePosition = useCallback(
    async (note: string, cfi: string): Promise<boolean> => {
      // Skip while somebody could be typing into it: the note is the focused
      // pane's, or a write of its own text is already on its way to the vault.
      // Whether or not that pane is dirty, which tightens the master spec.
      // `PUT` is last writer wins with no precondition, so a save landing
      // between the read below and the write is overwritten by the older text
      // plus one field, and the cache then hands that older text back to a
      // buffer its own save has just emptied. The focused pane is the only pane
      // that can be typed into, so refusing it outright shuts a window that is
      // otherwise a whole round trip wide.
      //
      // Off the ref rather than out of the render, because a timer that fired
      // reads what is true now and not what was true when it was set.
      const focused = focusedNote.current;
      if (focused.path === note || focused.isWriting(note)) return false;

      // Stop for good once the note has left the listing. Read out of the cache
      // the way the event handler reads it, so no dependency on `data` puts a
      // fresh callback in front of the timer. A listing that has not arrived
      // refuses the write too, which is stricter than the pane's own reading of
      // the same fact and deliberately so: not knowing yet is a reason to draw
      // nothing, and it is not a reason to write into a vault whose shape you
      // do not know.
      if (!queryClient.getQueryData<string[]>(["files"])?.includes(note)) return false;

      const text = await fetchNote(note).then(
        (held) => held,
        // Deleted or renamed since, which the write has no answer to.
        () => null,
      );
      if (text === null) return false;

      // Asked again, because the read took a round trip and the note can take
      // the focus inside it. This is the reading that catches a save starting
      // in the same tick as the write.
      const now = focusedNote.current;
      if (now.path === note || now.isWriting(note)) return false;

      const written = await saveNote(note, setField(text, "reading", cfi)).then(
        (landed) => landed,
        () => null,
      );
      if (written === null) return false;

      // Say it was ours, and say it before the cache moves. The order is load
      // bearing: the cache is what the editor reloads off, and adopting after
      // it would let that reload ask about a write the hook had not been told
      // about yet. `use-autosave.test.ts` pins that reading one layer down.
      //
      // Off the ref again rather than off the read above, so this is the hook
      // that follows the note now: the reader may have clicked into it while
      // the write was out, which is the whole case `adopt` exists for.
      focusedNote.current.adopt(note, written.content);
      // `setQueryData` and not an invalidation: what `PUT` answers is the note
      // as it landed, stamp included, so there is nothing to go and read again.
      // The stream invalidates a moment later anyway, which is the belt to
      // these braces.
      queryClient.setQueryData(["note", note], written.content);
      return true;
    },
    [queryClient],
  );

  const { moved, flush, cancel } = useBookmark(writePosition);

  // The focused pane's note is the only note that can be typed into, so its
  // taking the focus is the earliest signal there is that typing may start.
  // The guard above would refuse the write anyway when the timer fired; what
  // this buys is that the work is dropped rather than left armed for a minute.
  //
  // It drops the wait and keeps the place. Forgetting where the reader got to
  // as well would mean the ordinary session, turn some pages, click into the
  // note, write a paragraph, close the reader, never bookmarks anything at all.
  useEffect(() => {
    if (pane.path !== undefined) cancel(pane.path);
  }, [pane.path, cancel]);

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
   * Read a web page and put it in the inbox, then open the note it became.
   *
   * Not through `follow`, which is the other place a note is made and opened
   * together: that one writes the body under the block the backend stamps, and
   * a clipping brings a block of its own that has to be the first line for the
   * backend to read the fields in it.
   *
   * A page clipped twice is one note. Opening what is already there beats both
   * a second copy under a name with a number after it and a refusal over a note
   * the reader would have to go and find.
   *
   * Nothing is caught. What throws here is what the prompt puts on screen, and
   * it is the only thing that can: the reader is looking at the address that
   * failed and is the one who can fix it.
   */
  const clip = useCallback(
    async (url: string) => {
      const page = await fetchPage(url);
      const { path, body } = clipPage(page.html, page.url);
      const made = (data ?? []).includes(path) ? null : await createNote(path, body);

      if (made !== null) {
        queryClient.setQueryData(["note", made.path], made.content);
        void queryClient.invalidateQueries({ queryKey: ["files"] });
      }

      setClipPrompt(false);
      await openInPane(made?.path ?? path);
    },
    [data, queryClient, openInPane],
  );

  /**
   * Take a deleted note, or a deleted folder's notes, off the screen and the
   * caches.
   *
   * Every pane holding it, not only the focused one: one note is open in
   * several panes at once, and all of them are looking at a file that is no
   * longer there. A folder carries the notes under it, which is why this reads
   * the prefix as well as the path itself.
   *
   * The cached text goes rather than being kept for a restore. The vault is
   * the only thing that knows what is in a note, and a copy left stale by a
   * write outside kasten must not survive the trip through the trash.
   */
  const discarded = useCallback(
    (gone: string) => {
      // The slash keeps this on a segment boundary: `inboxes/` is not `inbox/`.
      const inside = `${gone}/`;
      const held = (path: string | undefined) =>
        path !== undefined && (path === gone || path.startsWith(inside));

      setLayout((previous) =>
        mapPanes(previous, (shown) => (held(shown.path) ? { id: shown.id } : shown)),
      );
      queryClient.removeQueries({
        queryKey: ["note"],
        predicate: ({ queryKey }) => typeof queryKey[1] === "string" && held(queryKey[1]),
      });
      void queryClient.invalidateQueries({ queryKey: ["files"] });
    },
    [queryClient],
  );

  /**
   * Move one note into the trash, and take it off the screen.
   *
   * Nothing asks first. The note waits in the trash for as long as the backend
   * keeps it and `<leader>du` puts it back, so a mistyped key costs a keypress
   * rather than a note, and a dialog on every delete would cost one every time.
   *
   * Saved first, and the refusal it carries is the pane's own note, which is
   * the rule a rename follows: the tree deletes whatever its cursor sits on,
   * and a note that changed on disk in one pane is no reason to refuse to
   * delete another.
   */
  const discardNote = useCallback(
    async (startPath?: string) => {
      const path = startPath ?? pane.path;
      if (path === undefined) return;
      if (!(await saveFirst()) && path === pane.path) return;

      await deleteNote(path).then(
        (entry) => discarded(entry.path),
        // The vault has moved past the row: the note went or was renamed
        // between the listing and the key. The tree redraws off the next event.
        () => refuse(),
      );
    },
    [pane.path, saveFirst, discarded, refuse],
  );

  /**
   * The same for a folder, which goes in one piece and comes back in one.
   *
   * Saved first for the reason a folder's rename is: the note in the focused
   * pane may be one of the notes this takes away.
   */
  const discardFolder = useCallback(
    async (startPath: string) => {
      const holdsOpenNote = pane.path?.startsWith(`${startPath}/`) ?? false;
      if (!(await saveFirst()) && holdsOpenNote) return;

      await deleteFolder(startPath).then(
        (entry) => discarded(entry.path),
        () => refuse(),
      );
    },
    [pane.path, saveFirst, discarded, refuse],
  );

  /**
   * Put the last deleted note or folder back where it was, and open it.
   *
   * The trash is read rather than remembered, so this reaches a delete made in
   * another tab, before a reload, or by hand in a terminal. The newest entry is
   * the first row the backend answers with.
   *
   * A refusal flashes the bar: an empty trash and a path something else has
   * taken since are both a key that did nothing, and the reader has to see that
   * it did nothing.
   */
  const restoreDeleted = useCallback(async () => {
    const newest = await fetchTrash().then(
      (rows) => rows[0],
      () => undefined,
    );
    if (newest === undefined) {
      refuse();
      return;
    }

    const path = await restoreEntry(newest.entry).then(
      (landed) => landed,
      () => null,
    );
    if (path === null) {
      refuse();
      return;
    }

    void queryClient.invalidateQueries({ queryKey: ["files"] });
    // A folder has no note to open, and the notes it brought back are already
    // in the tree by the line above. A note is a `.md` file, which is the
    // vault's own rule for what one is.
    if (path.endsWith(".md")) await openInPane(path);
  }, [queryClient, openInPane, refuse]);

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
   * The buffer already carries every line of this note the press moved and
   * autosave writes them, so this moves the `## Done` log and the dependents
   * living in other notes. It reads nothing at all for a press that neither
   * touches an end of done nor moves a blocker, which is half of them.
   */
  const logCycledTodo = useCallback(
    (path: string, cycle: TodoCycle) => {
      void cycleTodoAside(path, cycle, readClock(new Date()).date, data ?? []).then(
        todosWritten,
        () => {
          // The vault refused the write. The line in the buffer stands, and the
          // log is one `<leader>x` away from being asked for again.
        },
      );
    },
    [data, todosWritten],
  );

  /** Walk one todo on, in the vault, from the pane's `x`, or set the state a key named. */
  const cycleTodo = useCallback(
    (hit: SearchHit, state?: TodoState) => {
      void cycleTodoInVault(hit, readClock(new Date()).date, data ?? [], state).then(
        todosWritten,
        () => {
          // The vault refused the write, or the note moved out from under the
          // row. The list stays as it is, and the next event redraws it.
        },
      );
    },
    [data, todosWritten],
  );

  /**
   * Start or stop a session on the pane's `t`.
   *
   * The whole clock, not just the day: a session line carries the time, and
   * reading it here keeps the pane and the rules below it functions of strings.
   */
  const toggleTimer = useCallback(
    (hit: SearchHit) => {
      void toggleTimerInVault(hit, readClock(new Date()), data ?? []).then(todosWritten, () => {
        // The vault refused the write, or the note moved out from under the
        // row. The list stays as it is, and the next event redraws it.
      });
    },
    [data, todosWritten],
  );

  /**
   * Put a typed todo under `## TODOs` in today's note, from the pane's `a`, or
   * beside the row `s` opened on as a part of it.
   *
   * One callback for both, because the prompt is one prompt: the row it opened
   * on is the whole of the difference, and it decides which note the line lands
   * in.
   *
   * The clock is read here rather than in the prompt, so a prompt left open
   * over midnight writes the day it was taken on. The prompt shuts before the
   * write lands: it is asking for one line, and it has that line.
   */
  const addTodo = useCallback(
    (input: string) => {
      const parent = todoPrompt?.parent;
      setTodoPrompt(null);
      refocusPane();
      const today = readClock(new Date()).date;
      const written =
        parent === undefined
          ? addTodoInVault(input, today, data ?? [])
          : addSubtaskInVault(parent, input, today);
      void written.then(todosWritten, () => {
        // The vault refused the write, or the note moved out from under the
        // row. Nothing on screen moved with it, so there is nothing to put back.
      });
    },
    [data, todosWritten, refocusPane, todoPrompt],
  );

  /**
   * Put an edited line back in its note, from the pane's `e`.
   *
   * No clock: the line is written as it was typed, so there is no date for
   * kasten to stamp on it. The pane has already put the row back and taken the
   * keys with it; this is only the write.
   */
  const editTodo = useCallback(
    (hit: SearchHit, line: string) => {
      void editTodoInVault(hit, line).then(todosWritten, () => {
        // The vault refused the write, or the note moved out from under the
        // row. The list stays as it is, and the next event redraws it.
      });
    },
    [todosWritten],
  );

  /**
   * Put the file the picker just handed back into the vault, with its note.
   *
   * The book keeps its own name and lands in the inbox, rather than taking the
   * name of whatever note was in the pane: that threw the title away and
   * pinned the book to a note about something else. The note beside it is
   * what makes it readable at all, the pair being a convention rather than a
   * record, and opening it is the only thing on screen that says the upload
   * worked.
   *
   * The book goes up before the note is made, so a refusal leaves no orphan
   * note behind.
   */
  const chooseBook = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file === undefined) return;

      const filed = bookNote(file.name);
      if (filed === null) {
        setNotice("The vault will not take that name");
        return;
      }

      // Checked here rather than left to the backend. Sending 400MB through
      // the proxy to be told no is rude to the connection, and in production
      // Cloudflare refuses an oversize body before kasten sees it, with a page
      // of its own: the backend's 413 is a backstop and this is the message.
      if (file.size > ASSET_LIMIT_BYTES) {
        setNotice("That book is too big");
        return;
      }

      try {
        await uploadBook(filed.book, file);
      } catch (error: unknown) {
        // A typed `unknown` and not an untyped catch. A `fetch` rejects with
        // no response at all on a dropped connection or a suspended tab, and
        // there is no status to name, so the last arm is a sentence.
        setNotice(error instanceof Error ? error.message : "The upload failed");
        return;
      }

      // The `listing` event the upload fires invalidates `["files"]` alone, so
      // a reader already sitting on "no sidecar" would never notice this one.
      void queryClient.invalidateQueries({ queryKey: ["book", filed.book] });

      const made = (data ?? []).includes(filed.note)
        ? null
        : await createNote(filed.note, `# ${filed.name}\n`);
      if (made !== null) {
        queryClient.setQueryData(["note", made.path], made.content);
        void queryClient.invalidateQueries({ queryKey: ["files"] });
      }

      await openInPane(made?.path ?? filed.note);
    },
    [data, queryClient, openInPane],
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
        if (
          pane.term !== undefined ||
          pane.todos === true ||
          pane.book !== undefined ||
          pane.exam !== undefined
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
      showHelp: () => setHelpOpen(true),
      // No `saveFirst`: this opens nothing and moves no path, it only changes
      // what four lookups answer with.
      toggleArchive: () => setArchive((previous) => !previous),
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
      // Both of these carry their own rules, so they are written above rather
      // than here: a delete saves first, empties the panes holding the note and
      // drops what was cached of it.
      deleteNote: (startPath) => void discardNote(startPath),
      deleteFolder: (startPath) => void discardFolder(startPath),
      restoreDeleted: () => void restoreDeleted(),
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
      // Needs no note in the pane: the book keeps its own name and brings its
      // own note, so there is nothing here to be beside.
      uploadBook: () => {
        const input = picker.current;
        if (input === null) return;

        setNotice(undefined);
        // Blanked before the click. An input keeps the file you last chose and
        // choosing the same one again may fire no `change` at all, which is
        // the retry after a failed upload silently doing nothing.
        input.value = "";
        // Synchronously, with nothing awaited in front of it. A file picker
        // needs transient user activation and an `await` gives the browser a
        // turn in which it expires. jsdom models none of that, so an `await`
        // here passes every test in this repo and opens nothing on the box.
        input.click();
      },
      // Saved first the way `openTodos` is, and for the same reason: this
      // replaces the focused pane, so text still waiting would be written to a
      // pane the autosave no longer follows.
      openExam: async () => {
        if (pane.path === undefined) return;
        const note = pane.path;
        if (await saveFirst()) moveTo((previous) => openExamInFocused(previous, note));
      },
      // Both, and in one render: a folded panel has no row to focus.
      focusTree: () => {
        setTreeOpen(true);
        setTreeFocus((previous) => previous + 1);
      },
      createTab: () => moveTo(addTab),
      // No save first: opening the prompt moves no path. Naming a session does
      // replace what is in the pane, and that is asked on the way out below.
      openTerminal: () => setTerminalPrompt(true),
      // No save first, for the reason the terminal's prompt needs none: opening
      // it moves no path. The note it makes is opened through `openInPane`,
      // which asks.
      importPage: () => setClipPrompt(true),
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
      discardNote,
      discardFolder,
      restoreDeleted,
      pane.path,
      pane.term,
      pane.todos,
      pane.book,
      pane.exam,
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
          // Filtered here rather than at the fetch. The unfiltered listing is
          // what resolves a `[[wikilink]]`, so the editors below still get
          // `data` whole and `gf` into the archive works with this off.
          paths={visible(data ?? [], archive)}
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
              {(shown, focused) => {
                // Bound out of the pane here, because TypeScript stops
                // narrowing a property inside the two callbacks below and the
                // bookmark's note has to be a path rather than a maybe.
                const book = shown.book;
                return shown.todos === true ? (
                  <TodoPane
                    commands={commands}
                    onOpen={(path, hitLine) => void openInPane(path, hitLine)}
                    onCycle={cycleTodo}
                    onAdd={() => setTodoPrompt({})}
                    onSubtask={(hit) => setTodoPrompt({ parent: hit })}
                    onEdit={editTodo}
                    onTimer={toggleTimer}
                    archive={archive}
                    focusSignal={focused ? focusSignal : 0}
                    // Read at the render rather than inside the pane, which
                    // stays a function of the strings it is handed. A tab left
                    // open across midnight keeps yesterday's sections until
                    // something makes it render, which is what the event stream
                    // does the moment anything is written.
                    today={readClock(new Date()).date}
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
                    onMoved={(cfi) => moved(book, cfi)}
                    onLeaving={() => flush(book)}
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
                );
              }}
            </PaneLayout>
          </div>
        </div>
      </div>
      <StatusBar
        status={pane.path === undefined ? undefined : status}
        reason={reason}
        flash={refused}
        archive={archive}
        notice={notice}
      />
      {helpOpen && <KeyHelp onClose={() => setHelpOpen(false)} />}
      {clipPrompt && (
        <ClipPrompt
          onClip={clip}
          onClose={() => {
            setClipPrompt(false);
            refocusPane();
          }}
        />
      )}
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
      {todoPrompt !== null && (
        <TodoPrompt
          onAdd={addTodo}
          onClose={() => {
            setTodoPrompt(null);
            refocusPane();
          }}
          // The line as the vault holds it, read no further than this: the
          // prompt draws it to say where the part is going, and the write reads
          // the note again for itself.
          under={
            todoPrompt.parent === undefined
              ? undefined
              : (parseTodo(todoPrompt.parent.text)?.text ?? todoPrompt.parent.text)
          }
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
                    // A reader follows a folder and never a rename. A rename
                    // moves the note and leaves the epub where it was, so
                    // rewriting `book` here would aim the reader at a file that
                    // is not the book it is reading. Undefined keeps the old
                    // value, which is what a move that touched nothing answers.
                    const book =
                      (mode === "folder"
                        ? noteAfterPrompt(mode, startPath, path, shown.book)
                        : undefined) ?? shown.book;
                    const moved = next === undefined ? shown : { ...shown, path: next };
                    return book === shown.book ? moved : { ...moved, book };
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
          // The outgoing links are left whole: a link this note really holds is
          // worth showing wherever it points, archive included.
          paths={linksOut ?? visible(data ?? [], archive)}
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
          archive={archive}
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
      {/* Last in the markup and always mounted, so `<leader>cb` has something
          to click and no open prompt has this in front of its own input.
          `accept` filters the picker's default view and stops nothing, the
          user being free to switch it to all files, which is why the backend
          looks at the bytes. */}
      <input
        ref={picker}
        type="file"
        accept=".epub,application/epub+zip"
        className="hidden"
        onChange={chooseBook}
      />
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
