import { indentWithTab } from "@codemirror/commands";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { Annotation, Compartment, EditorState, Facet, Transaction } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, keymap } from "@codemirror/view";
import { Vim, vim } from "@replit/codemirror-vim";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";
import { backticks } from "@/lib/backticks";
import { editorCommands } from "@/lib/editor-commands";
import type { EditorCommands } from "@/lib/key-bindings";
import { livePreview } from "@/lib/live-preview";
import { noteLanguage } from "@/lib/note-language";
import { vaultPaths, wikiLinkAt, wikiLinkCompletions } from "@/lib/wikilink";

type SaveHandler = (doc: string) => void;
type FollowHandler = (target: string) => void;

/**
 * Carries the save callback on the editor state.
 *
 * `Vim.defineEx` registers `:w` once for the whole module and cannot close over
 * one view's props, so the handler has to be reachable from the view it was
 * typed into. A facet is how CodeMirror hangs a value off a state.
 */
const saveHandler = Facet.define<SaveHandler, SaveHandler | undefined>({
  combine: (handlers) => handlers[0],
});

function save(view: EditorView): boolean {
  view.state.facet(saveHandler)?.(view.state.doc.toString());
  return true;
}

Vim.defineEx("write", "w", (cm: { cm6: EditorView }) => save(cm.cm6));

/**
 * Carries the follow callback, for the reason `saveHandler` carries the other.
 *
 * A facet and not one of `editorCommands`: that table is the one a leader
 * sequence names a command in, and this command is reached by `gf` and carries
 * a note's name with it.
 */
const followHandler = Facet.define<FollowHandler, FollowHandler | undefined>({
  combine: (handlers) => handlers[0],
});

/** Open the note the cursor's `[[link]]` names, vim's own go-to-file. */
function follow(view: EditorView): boolean {
  const target = wikiLinkAt(view.state, view.state.selection.main.head);
  if (target === null) return false;
  view.state.facet(followHandler)?.(target);
  return true;
}

Vim.defineAction("kastenFollowLink", (cm: { cm6: EditorView }) => follow(cm.cm6));
Vim.mapCommand("gf", "action", "kastenFollowLink", {}, { context: "normal" });

/**
 * Ctrl+click, or cmd+click, follows a link the way every browser opens one.
 *
 * The element decides, not the coordinates: the rendered link is a span of its
 * own, so a click that landed on it is a click on the link, and one that landed
 * in the space after the line is not. `posAtDOM` needs no layout for that,
 * which a test in jsdom also needs. The plain click is left alone, because
 * putting the cursor in a link is how the link gets edited.
 */
const followOnClick = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (!event.ctrlKey && !event.metaKey) return false;
    const element = event.target;
    if (!(element instanceof HTMLElement) || !element.classList.contains("cm-wikilink")) {
      return false;
    }

    const target = wikiLinkAt(view.state, view.posAtDOM(element));
    if (target === null) return false;
    view.state.facet(followHandler)?.(target);
    return true;
  },
});

/**
 * Holds live preview so `<leader>p` can swap it out.
 *
 * A compartment rather than a rebuilt view: rebuilding throws away the undo
 * history and the cursor, and turning the rendering off is not meant to cost
 * either. One instance for the module is right, because a compartment is only
 * an identity, and each state configures it separately.
 */
const preview = new Compartment();

/**
 * Holds the vault listing, which the route refreshes as notes come and go.
 *
 * A compartment for the reason the one above is: the listing changes while a
 * note is open, and rebuilding the view to tell it so would throw away the undo
 * history and the cursor.
 */
const vault = new Compartment();

/**
 * Marks the transaction that puts the vault's own text in.
 *
 * The listener below reports every other change, and reporting this one would
 * have the note saved back: that stamps a new date, which is another change to
 * the vault, which reloads here, which saves again. A note nobody touched would
 * rewrite itself once a second.
 */
const fromVault = Annotation.define<boolean>();

/**
 * Where the note itself starts, past the frontmatter the vault writes.
 *
 * The block is three fields nobody types, and a new note is nothing else, so
 * the top of the document is between the fences and the first keystroke would
 * land in the dates. Read off the text rather than the syntax tree: the state
 * is being built here and has no tree yet.
 */
function noteStart(doc: string): number {
  const lines = doc.split("\n");
  const fence = lines[0] === "---" ? lines.indexOf("---", 1) : -1;
  if (fence === -1) return 0;

  const past = lines.slice(0, fence + 1).reduce((at, line) => at + line.length + 1, 0);
  // A note that is only its block ends at the closing fence, and there is no
  // line below to sit on.
  return Math.min(past, doc.length);
}

/**
 * Whether nobody on the page holds the focus.
 *
 * The editor takes it in that case and only that case. The file tree and the
 * key map panel are focusable too, and neither is the editor's to take: opening
 * a note from the tree remounts the editor, and grabbing the focus there would
 * end a walk down the tree after the first note.
 */
function nothingFocused(): boolean {
  const active = document.activeElement;
  return !active || active === document.body;
}

interface EditorProps {
  /** The document to open. Only read on mount; pass a `key` to open another note. */
  initialDoc: string;
  /**
   * Text the vault holds now, when something other than this editor wrote it.
   *
   * Applied as one transaction rather than a remount, so the cursor and the
   * undo history survive a reload nobody asked for.
   */
  reloadDoc?: string;
  /** What the leader keys reach for. Absent leaves them inert. */
  commands?: EditorCommands;
  /** Whether markdown is rendered. Held by the route, so it outlives a remount. */
  preview?: boolean;
  /**
   * Every note in the vault, for completing a `[[` and for telling a link to a
   * note that exists from one to a note that does not.
   *
   * Absent means the listing is not known here, which is not the same as an
   * empty vault: nothing is offered and no link is called dead.
   */
  paths?: string[];
  /**
   * Line to open on, counting from one. Absent starts at the top.
   *
   * Not folded into `initialDoc`'s read-once rule: a second search hit can
   * name another line of the note already open, and that moves the cursor
   * without rebuilding anything.
   */
  startLine?: number;
  /**
   * Raised when the app wants this editor to take the focus, and 0 while it
   * does not.
   *
   * A counter and not a flag, the way the file tree's is: moving to a pane and
   * back is two requests for the focus and both have to read as a change. The
   * route raises it for a key that moved the focus and leaves it alone for a
   * click, which has already put the focus where it belongs.
   */
  focusSignal?: number;
  /**
   * Asked immediately before the vault's text goes in, and can refuse.
   *
   * The buffer picks up unsaved text of its own between the vault reporting a
   * write and the read of it arriving here, so whoever holds that text is asked
   * at the last moment rather than the first. Absent means nobody is holding
   * any, which is what an editor with no note behind it is.
   */
  allowReload?: () => boolean;
  onChange?: (doc: string) => void;
  /** Called with the whole document on `:w` or ctrl+s. */
  onSave?: (doc: string) => void;
  /** Called with the note a `[[link]]` names when `gf` follows it. */
  onFollow?: (target: string) => void;
}

/**
 * A CodeMirror 6 markdown editor.
 *
 * The EditorView owns the document. Never mirror the text into React state:
 * re-rendering the tree on every keystroke is where CodeMirror-in-React
 * performance dies.
 */
export function Editor({
  initialDoc,
  reloadDoc,
  commands,
  preview: rendered = true,
  paths,
  startLine,
  focusSignal,
  allowReload,
  onChange,
  onSave,
  onFollow,
}: EditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Every prop lives in a ref so the mount effect depends on nothing. Rebuilding
  // the view throws away undo history and cursor position, so it must happen
  // exactly once: to open a different note, remount with a `key`.
  const initialDocRef = useRef(initialDoc);
  const renderedRef = useRef(rendered);
  const pathsRef = useRef(paths);
  const commandsRef = useRef(commands);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onFollowRef = useRef(onFollow);
  const allowReloadRef = useRef(allowReload);

  useEffect(() => {
    commandsRef.current = commands;
    onChangeRef.current = onChange;
    onSaveRef.current = onSave;
    onFollowRef.current = onFollow;
    allowReloadRef.current = allowReload;
  }, [commands, onChange, onSave, onFollow, allowReload]);

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;

    const view = new EditorView({
      state: EditorState.create({
        doc: initialDocRef.current,
        selection: { anchor: noteStart(initialDocRef.current) },
        extensions: [
          // Must come first: whichever keymap is registered earliest wins, and
          // vim's bindings have to beat the ones basicSetup installs.
          vim(),
          // Ahead of basicSetup for the same reason: ctrl+s must reach us
          // rather than open the browser's save dialog.
          keymap.of([{ key: "Mod-s", run: save, preventDefault: true }]),
          // basicSetup leaves tab unbound so the key can move the focus out of
          // the editor. A note needs it to nest a list item, and `<leader>e`
          // is the way to the file tree now, so the trade is worth taking.
          // Vim maps no tab of its own, in any mode, so this is the only
          // handler the key reaches.
          keymap.of([indentWithTab]),
          // Ahead of basicSetup, whose closeBrackets would otherwise answer the
          // third backtick with a pair before the fence handler sees it.
          backticks(),
          saveHandler.of((doc) => onSaveRef.current?.(doc)),
          followHandler.of((target) => onFollowRef.current?.(target)),
          // Each one reads the ref rather than closing over the prop, so a
          // re-render never has to rebuild the view to refresh a callback.
          editorCommands.of({
            toggleTree: () => commandsRef.current?.toggleTree(),
            togglePreview: () => commandsRef.current?.togglePreview(),
            closeNote: () => commandsRef.current?.closeNote(),
            showHelp: () => commandsRef.current?.showHelp(),
            focusTree: () => commandsRef.current?.focusTree(),
            createNote: (startPath) => commandsRef.current?.createNote(startPath),
            // No path: the editor holds one note, and the route already knows
            // which. The tree is the caller that names one.
            renameNote: (startPath) => commandsRef.current?.renameNote(startPath),
            findNote: () => commandsRef.current?.findNote(),
            searchNotes: () => commandsRef.current?.searchNotes(),
            showBacklinks: () => commandsRef.current?.showBacklinks(),
            showLinksOut: () => commandsRef.current?.showLinksOut(),
            createTab: () => commandsRef.current?.createTab(),
            splitRight: () => commandsRef.current?.splitRight(),
            splitDown: () => commandsRef.current?.splitDown(),
            nextPane: () => commandsRef.current?.nextPane(),
            paneLeft: () => commandsRef.current?.paneLeft(),
            paneDown: () => commandsRef.current?.paneDown(),
            paneUp: () => commandsRef.current?.paneUp(),
            paneRight: () => commandsRef.current?.paneRight(),
            nextTab: () => commandsRef.current?.nextTab(),
            prevTab: () => commandsRef.current?.prevTab(),
            goToTab: (index) => commandsRef.current?.goToTab(index),
          }),
          basicSetup,
          noteLanguage(),
          markdownLanguage.data.of({ autocomplete: wikiLinkCompletions }),
          followOnClick,
          vault.of(pathsRef.current ? vaultPaths.of(pathsRef.current) : []),
          preview.of(renderedRef.current ? livePreview() : []),
          oneDark,
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            // `every` and not `some`: an update carrying the reload alongside
            // something the user typed is an update whose text has to be
            // written, and the keystroke in it would go unreported otherwise.
            if (update.docChanged && !update.transactions.every((tr) => tr.annotation(fromVault))) {
              onChangeRef.current?.(update.state.doc.toString());
            }
          }),
        ],
      }),
      parent,
    });
    viewRef.current = view;
    // A freshly loaded page focuses nothing, and the first thing typed at it
    // goes nowhere. The editor is what the page is for, so it takes the focus.
    if (nothingFocused()) view.focus();

    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, []);

  // Declared after the mount effect so the view exists by the time this runs,
  // which is what lets one effect serve both cases: opening a note on a line,
  // and moving to another line of the note already open.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || startLine === undefined) return;

    // The note can be edited between a scan finding the line and a click
    // opening it, and CodeMirror throws on a line past the end rather than
    // clamping, so a stale hit would take the editor down with it.
    const { doc } = view.state;
    const line = doc.line(Math.min(startLine, doc.lines));
    view.dispatch({
      selection: { anchor: line.from },
      // Centred rather than merely brought on screen: a match landing hard
      // against the top or bottom edge is a match you cannot read around.
      effects: EditorView.scrollIntoView(line.from, { y: "center" }),
    });
  }, [startLine]);

  // The vault is the source of truth, so text written to the open note by an
  // agent or an ssh session belongs on screen. One transaction and not a
  // remount: `key={path}` above only changes when another note is opened, and
  // rebuilding here would throw away the undo history and the cursor over an
  // edit the reader did not make.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || reloadDoc === undefined) return;

    // Only the span that differs, and never the whole document. CodeMirror maps
    // positions through a change, so everything outside the span comes through
    // where it was: the cursor stays on the words it sat on, and an undo of an
    // edit the reader made puts the text back where they made it. Replaced
    // whole, both collapse to the one point the replacement leaves, which is
    // what a reload used to cost. Nothing is asked of the selection here for
    // the same reason: mapping keeps it, and naming it would flatten it.
    //
    // The vault's own writes are what make this cheap. An agent appends, an
    // editor rewrites a paragraph, and kasten's `modified` stamp moves one line
    // of the frontmatter.
    const text = view.state.doc.toString();
    let from = 0;
    while (from < text.length && from < reloadDoc.length && text[from] === reloadDoc[from]) {
      from += 1;
    }

    // Both ends stop at `from`, so the tail cannot walk back into the head it
    // already matched: "aaa" grown to "aaaaa" shares its whole length with
    // itself either way round, and subtracting both would delete text that is
    // still there.
    let to = text.length;
    let insertTo = reloadDoc.length;
    while (to > from && insertTo > from && text[to - 1] === reloadDoc[insertTo - 1]) {
      to -= 1;
      insertTo -= 1;
    }

    // Nothing left after the trim is the text already on screen, which is what
    // mounting looks like from here: the note opens on the same query data this
    // prop carries. A change holding nothing is still a transaction.
    if (from === to && from === insertTo) return;

    // Asked here and not when the vault reported the write, because the two are
    // not the same moment: the read takes a round trip, and the reader can type
    // into a buffer that was clean when it went out. A refusal leaves the note
    // as it stands and the vault as it stands, and says so in the status bar.
    if (allowReloadRef.current?.() === false) return;

    view.dispatch({
      changes: { from, to, insert: reloadDoc.slice(from, insertTo) },
      // Off the undo stack as well as off the save path. Undoing a write
      // nobody here made would put the text from before it back, and that
      // revert carries no annotation, so autosave would send it to the vault:
      // one `u` overwriting whatever the other writer had just done.
      annotations: [fromVault.of(true), Transaction.addToHistory.of(false)],
    });
  }, [reloadDoc]);

  // Runs on mount as well as on every raise, which is what a freshly split pane
  // needs: it is created focused, and its first render is the only chance it
  // gets to say so. A pane that is not the focused one is handed 0 and stays put.
  useEffect(() => {
    if (focusSignal) viewRef.current?.focus();
  }, [focusSignal]);

  // Coming back to the tab lands on the body when the page had nothing focused
  // when you left it, and the cursor is dead again until you click.
  useEffect(() => {
    function onWindowFocus() {
      if (nothingFocused()) viewRef.current?.focus();
    }

    window.addEventListener("focus", onWindowFocus);
    return () => window.removeEventListener("focus", onWindowFocus);
  }, []);

  // Swapping the extension out is all this takes: the same `livePreview()`
  // pieces come back by identity, so nothing below them is rebuilt.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: preview.reconfigure(rendered ? livePreview() : []),
    });
  }, [rendered]);

  // A note written elsewhere is a link in this note that has just come to life,
  // so the listing goes in whenever the route hands over a new one.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: vault.reconfigure(paths ? vaultPaths.of(paths) : []),
    });
  }, [paths]);

  return <div ref={host} className="h-full overflow-auto" />;
}
