import { acceptCompletion } from "@codemirror/autocomplete";
import { indentWithTab } from "@codemirror/commands";
import { markdownLanguage } from "@codemirror/lang-markdown";
import {
  Annotation,
  Compartment,
  EditorState,
  type Extension,
  Facet,
  Transaction,
} from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { type CM5EditorInterface, Vim, vim } from "@replit/codemirror-vim";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";
import { backticks } from "@/lib/backticks";
import { editorCommands } from "@/lib/editor-commands";
import { highlightAt } from "@/lib/highlight";
import { imageCompletions, imagePaste, imagePaths, noticeHandler } from "@/lib/image";
import type { EditorCommands } from "@/lib/key-bindings";
import { livePreview } from "@/lib/live-preview";
import { noteLanguage } from "@/lib/note-language";
import { relationCompletions, vaultRelations } from "@/lib/ontology";
import { moveCell } from "@/lib/table";
import { tagCompletions, vaultTags } from "@/lib/tag";
import { type CycleHandler, notePath, todoCycled } from "@/lib/todo-commands";
import { todoCompletions } from "@/lib/todo-suggest";
import { setWatched } from "@/lib/video";
import { vaultPaths, wikiLinkAt, wikiLinkCompletions } from "@/lib/wikilink";

type SaveHandler = (doc: string) => void;
type FollowHandler = (target: string) => void;
type HighlightHandler = (quote: string[]) => void;
/** Answers with the vault's text, or with null when the reload was refused. */
type ReloadHandler = (force: boolean) => Promise<string | null>;

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

/**
 * Carries the highlight callback, for the reason `saveHandler` carries the other.
 *
 * A second facet rather than a second meaning on the first: what a highlight
 * names is a passage in a book and not a note's path, so the two callbacks
 * carry different things.
 */
const highlightHandler = Facet.define<HighlightHandler, HighlightHandler | undefined>({
  combine: (handlers) => handlers[0],
});

/**
 * Open what the cursor's line names, vim's own go-to-file.
 *
 * Two readers, in this order. A `[[link]]` under the cursor is a link even
 * inside a quote line, and a highlight block is the second meaning `gf` gains:
 * the block names a passage in a book, and the cursor may sit on any of its
 * lines. Neither, and this answers false the way it always did, which is what
 * keeps `<CR>` moving down.
 */
function follow(view: EditorView): boolean {
  const target = wikiLinkAt(view.state, view.state.selection.main.head);
  if (target !== null) {
    view.state.facet(followHandler)?.(target);
    return true;
  }

  const { doc } = view.state;
  const quote = highlightAt(doc.toString(), doc.lineAt(view.state.selection.main.head).number);
  if (quote === null) return false;
  // True whether or not a handler is installed, which is what the wikilink
  // branch above does: the only editor with no callback is the empty pane, and
  // that holds no note.
  view.state.facet(highlightHandler)?.(quote);
  return true;
}

Vim.defineAction("kastenFollowLink", (cm: { cm6: EditorView }) => follow(cm.cm6));
Vim.mapCommand("gf", "action", "kastenFollowLink", {}, { context: "normal" });

/**
 * Enter follows the link too, and moves the way vim moves off one.
 *
 * A mapping takes the key whether or not the action did anything, and vim
 * reads a bare `<CR>` as `j^`, so a line holding no link would lose the motion
 * to a key that did nothing. Handing those two keys back is what keeps it.
 */
Vim.defineAction("kastenFollowLinkOrDown", (cm: CM5EditorInterface) => {
  if (follow(cm.cm6)) return;
  Vim.handleKey(cm, "j", "user");
  Vim.handleKey(cm, "^", "user");
});
Vim.mapCommand("<CR>", "action", "kastenFollowLinkOrDown", {}, { context: "normal" });

/**
 * Carries the reload callback, for the reason `saveHandler` carries the other.
 *
 * Whoever holds the unsaved text is who decides whether a `:e` may discard it,
 * and that is the same somebody the vault's text has to be read by, so the
 * whole answer comes back from one call.
 */
const reloadHandler = Facet.define<ReloadHandler, ReloadHandler | undefined>({
  combine: (handlers) => handlers[0],
});

/**
 * Read the note off the vault again, vim's `:e`, and `:e!` to discard the
 * buffer.
 *
 * The bang is not part of the command's name. The parser takes the word for
 * that and leaves everything after it as the command's argument, so `:e!`
 * arrives here as `edit` with an argString of "!" and `:e` with none. Reading
 * it is what keeps the two apart, and apart they must be: plain `:e` declines a
 * buffer holding unsaved text, and only the bang throws it away.
 */
function edit(view: EditorView, params: { argString?: string }): boolean {
  // Trimmed, because the argument holds everything typed after the word and
  // `:e! ` is still `:e!`. Losing the bang to a trailing space would turn the
  // command into the one that declines, without a word about why.
  const argument = params.argString?.trim() ?? "";
  // Those two spellings are the whole of the command. Vim opens the file an
  // argument names; this editor holds the note its pane holds, so rereading
  // that one would be the wrong note answering to the right command. Nothing
  // happens instead, which is at least not a lie.
  if (argument !== "" && argument !== "!") return false;

  const reload = view.state.facet(reloadHandler);
  if (reload === undefined) return false;

  void reload(argument === "!").then(
    (text) => {
      // Null is the refusal, and there is nothing to put in. Nothing asks
      // `allowReload` on the way in either: what that guard stands over is the
      // text waiting to be written, and the answer above came from the holder
      // of that text, who dropped it before handing this back. Dispatching into
      // a view destroyed while the read was in flight is safe, CodeMirror
      // keeping the state and doing nothing else with it.
      if (text !== null) takeVaultText(view, text);
    },
    () => {
      // The vault could not be read. Nothing was discarded, the discard waiting
      // on the text, so the buffer and the status bar stand as they were.
    },
  );
  return true;
}

Vim.defineEx("edit", "e", (cm: { cm6: EditorView }, params: { argString?: string }) =>
  edit(cm.cm6, params),
);

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
 * The four listings the vault carries, in the shape the compartment holds them.
 *
 * One compartment for all of them, and therefore one place that spells this out.
 * Any of them absent is not an empty vault: it is a view that was told nothing,
 * which offers nothing and calls no link dead.
 */
function listings(
  paths: string[] | undefined,
  images: string[] | undefined,
  tags: string[] | undefined,
  relations: string[] | undefined,
): Extension[] {
  return [
    ...(paths ? [vaultPaths.of(paths)] : []),
    ...(images ? [imagePaths.of(images)] : []),
    ...(tags ? [vaultTags.of(tags)] : []),
    ...(relations ? [vaultRelations.of(relations)] : []),
  ];
}

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
 * Put the vault's text in the buffer, replacing only the span that differs.
 *
 * Never the whole document. CodeMirror maps positions through a change, so
 * everything outside the span comes through where it was: the cursor stays on
 * the words it sat on, and an undo of an edit the reader made puts the text
 * back where they made it. Replaced whole, both collapse to the one point the
 * replacement leaves, which is what a reload used to cost. Nothing is asked of
 * the selection here for the same reason: mapping keeps it, and naming it would
 * flatten it.
 *
 * The vault's own writes are what make this cheap. An agent appends, an editor
 * rewrites a paragraph, and kasten's `modified` stamp moves one line of the
 * frontmatter.
 *
 * `allowed` is asked at the last moment, once there is a change to make, and a
 * no leaves the note as it stands and the vault as it stands. Absent means
 * nobody is holding text the change could take off the screen.
 */
function takeVaultText(view: EditorView, text: string, allowed?: (text: string) => boolean): void {
  const current = view.state.doc.toString();
  let from = 0;
  while (from < current.length && from < text.length && current[from] === text[from]) {
    from += 1;
  }

  // Both ends stop at `from`, so the tail cannot walk back into the head it
  // already matched: "aaa" grown to "aaaaa" shares its whole length with itself
  // either way round, and subtracting both would delete text that is still
  // there.
  let to = current.length;
  let insertTo = text.length;
  while (to > from && insertTo > from && current[to - 1] === text[insertTo - 1]) {
    to -= 1;
    insertTo -= 1;
  }

  // Nothing left after the trim is the text already on screen, which is what
  // mounting looks like from here: the note opens on the same query data the
  // reload prop carries. A change holding nothing is still a transaction.
  if (from === to && from === insertTo) return;
  if (allowed?.(text) === false) return;

  view.dispatch({
    changes: { from, to, insert: text.slice(from, insertTo) },
    // Off the undo stack as well as off the save path. Undoing a write nobody
    // here made would put the text from before it back, and that revert carries
    // no annotation, so autosave would send it to the vault: one `u`
    // overwriting whatever the other writer had just done.
    annotations: [fromVault.of(true), Transaction.addToHistory.of(false)],
  });
}

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
   * Every image in the vault, for completing the path in an open `![](`.
   *
   * Absent offers nothing, the way an absent `paths` does. Its own list because
   * an image is not a note: it is never linked to with `[[`, and a note that
   * does not exist yet is an invitation where an image that does not exist yet
   * is a mistake.
   */
  images?: string[];
  /**
   * Every tag the vault holds, for completing an open `#`.
   *
   * Its own list beside the other two, and absent offers nothing the way theirs
   * does. A tag names no file, so nothing else in the editor reads this.
   */
  tags?: string[];
  /**
   * Every relation name the vault's ontology note lists, for completing one.
   *
   * Its own list beside the other three, and absent offers nothing the way
   * theirs does. Read off a note in the vault, so the vocabulary is edited by
   * editing that note rather than by shipping a release.
   */
  relations?: string[];
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
   * A video position to put in this note's frontmatter, or absent for none.
   *
   * Into the buffer and not into the vault. The note this belongs to is almost
   * always the pane you are typing in, and a write that read the vault's copy
   * and saved it back would put your unsaved paragraph on the floor. An edit to
   * the buffer is an edit like any other: the autosave carries it out the way
   * it carries out a sentence you typed.
   */
  mark?: { id: string; seconds: number };
  /**
   * Whether the pane this sits in is the focused one.
   *
   * Read only on the way back into the tab, below. Every pane mounts one of
   * these, so without it they all race for the focus and the winner is
   * arbitrary.
   */
  focused?: boolean;
  /**
   * Asked immediately before the vault's text goes in, and can refuse.
   *
   * The buffer picks up unsaved text of its own between the vault reporting a
   * write and the read of it arriving here, so whoever holds that text is asked
   * at the last moment rather than the first, and handed the text so it can
   * tell a write of its own from somebody else's. Absent means nobody is
   * holding any, which is what an editor with no note behind it is.
   */
  allowReload?: (text: string) => boolean;
  /**
   * Asked for the vault's text on `:e`, with whether the reader typed the bang.
   *
   * Null back is the refusal, which is `:e` on a buffer holding unsaved edits.
   * Absent leaves the command inert, which is what a pane holding no note is.
   */
  onReload?: (force: boolean) => Promise<string | null>;
  onChange?: (doc: string) => void;
  /** Called with the whole document on `:w` or ctrl+s. */
  onSave?: (doc: string) => void;
  /** Called with the note a `[[link]]` names when `gf` follows it. */
  onFollow?: (target: string) => void;
  /** Called with a highlight block's paragraphs when `gf` lands on one. */
  onOpenHighlight?: (quote: string[]) => void;
  /** Called with the line `<leader>x` cycled, which the done log follows. */
  onCycleTodo?: CycleHandler;
  /** The note this holds, which tells today's own note from every other. */
  path?: string;
  /**
   * Called with a sentence for the reader when a pasted image is refused.
   *
   * The one thing the editor does that the vault can refuse with no key having
   * been pressed, and the paste is silent without it.
   */
  onNotice?: (message: string) => void;
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
  images,
  tags,
  relations,
  startLine,
  focusSignal,
  mark,
  focused = true,
  allowReload,
  onReload,
  onChange,
  onSave,
  onFollow,
  onOpenHighlight,
  onCycleTodo,
  path,
  onNotice,
}: EditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Every prop lives in a ref so the mount effect depends on nothing. Rebuilding
  // the view throws away undo history and cursor position, so it must happen
  // exactly once: to open a different note, remount with a `key`.
  const initialDocRef = useRef(initialDoc);
  const renderedRef = useRef(rendered);
  const pathsRef = useRef(paths);
  const imagesRef = useRef(images);
  const tagsRef = useRef(tags);
  const relationsRef = useRef(relations);
  const commandsRef = useRef(commands);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onFollowRef = useRef(onFollow);
  const onOpenHighlightRef = useRef(onOpenHighlight);
  const onCycleTodoRef = useRef(onCycleTodo);
  const onNoticeRef = useRef(onNotice);
  const allowReloadRef = useRef(allowReload);
  const onReloadRef = useRef(onReload);

  useEffect(() => {
    commandsRef.current = commands;
    onChangeRef.current = onChange;
    onSaveRef.current = onSave;
    onFollowRef.current = onFollow;
    onOpenHighlightRef.current = onOpenHighlight;
    onCycleTodoRef.current = onCycleTodo;
    onNoticeRef.current = onNotice;
    allowReloadRef.current = allowReload;
    onReloadRef.current = onReload;
  }, [
    commands,
    onChange,
    onSave,
    onFollow,
    onOpenHighlight,
    onCycleTodo,
    onNotice,
    allowReload,
    onReload,
  ]);

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
          //
          // The completion goes first and declines when no list is open, which
          // is tab's own job in every editor that offers one. Enter takes a
          // completion too, `basicSetup` binding it, but a list that tab cannot
          // take is a list nobody's fingers reach for.
          //
          // The table walk sits between them: in a table tab means the next
          // cell, and everywhere else it still means indent.
          keymap.of([
            { key: "Tab", run: acceptCompletion },
            { key: "Tab", run: (view) => moveCell(view, 1) },
            { key: "Shift-Tab", run: (view) => moveCell(view, -1) },
            indentWithTab,
          ]),
          // Ahead of basicSetup, whose closeBrackets would otherwise answer the
          // third backtick with a pair before the fence handler sees it.
          backticks(),
          saveHandler.of((doc) => onSaveRef.current?.(doc)),
          followHandler.of((target) => onFollowRef.current?.(target)),
          highlightHandler.of((quote) => onOpenHighlightRef.current?.(quote)),
          todoCycled.of((cycle) => onCycleTodoRef.current?.(cycle)),
          ...(path === undefined ? [] : [notePath.of(path)]),
          // A pane with nothing to reload answers the way a refusal does, so
          // `:e` in one is a key that does nothing rather than a key that
          // throws.
          reloadHandler.of((force) => onReloadRef.current?.(force) ?? Promise.resolve(null)),
          // Each one reads the ref rather than closing over the prop, so a
          // re-render never has to rebuild the view to refresh a callback.
          editorCommands.of({
            toggleTree: () => commandsRef.current?.toggleTree(),
            toggleArchive: () => commandsRef.current?.toggleArchive(),
            togglePreview: () => commandsRef.current?.togglePreview(),
            closeNote: () => commandsRef.current?.closeNote(),
            showHelp: () => commandsRef.current?.showHelp(),
            focusTree: () => commandsRef.current?.focusTree(),
            createNote: (startPath) => commandsRef.current?.createNote(startPath),
            // No path: the editor holds one note, and the route already knows
            // which. The tree is the caller that names one.
            renameNote: (startPath) => commandsRef.current?.renameNote(startPath),
            deleteNote: (startPath) => commandsRef.current?.deleteNote(startPath),
            restoreDeleted: () => commandsRef.current?.restoreDeleted(),
            findNote: () => commandsRef.current?.findNote(),
            searchNotes: () => commandsRef.current?.searchNotes(),
            findTodos: () => commandsRef.current?.findTodos(),
            openTodos: () => commandsRef.current?.openTodos(),
            showBacklinks: () => commandsRef.current?.showBacklinks(),
            showLinksOut: () => commandsRef.current?.showLinksOut(),
            openDaily: () => commandsRef.current?.openDaily(),
            openWeekly: () => commandsRef.current?.openWeekly(),
            openMonthly: () => commandsRef.current?.openMonthly(),
            openQuarterly: () => commandsRef.current?.openQuarterly(),
            openYearly: () => commandsRef.current?.openYearly(),
            openBook: () => commandsRef.current?.openBook(),
            openVideo: () => commandsRef.current?.openVideo(),
            toggleVideo: () => commandsRef.current?.toggleVideo(),
            uploadBook: () => commandsRef.current?.uploadBook(),
            importNotes: () => commandsRef.current?.importNotes(),
            exportNote: () => commandsRef.current?.exportNote(),
            openExam: () => commandsRef.current?.openExam(),
            openReview: () => commandsRef.current?.openReview(),
            createTab: () => commandsRef.current?.createTab(),
            openTerminal: () => commandsRef.current?.openTerminal(),
            importPage: () => commandsRef.current?.importPage(),
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
          // vim's `number relativenumber`: the line the cursor sits on names
          // itself and the rest count the distance to it, which is the number
          // `10j` and `d5k` are reached for with. basicSetup's own
          // `lineNumbers()` carries no config, so this adds a formatter to the
          // gutter already there rather than a second one beside it. It
          // redraws when the cursor changes line because `highlightActiveLineGutter`,
          // also basicSetup's, moves its marker then.
          lineNumbers({
            formatNumber: (line, state) => {
              const cursor = state.doc.lineAt(state.selection.main.head).number;
              return `${line === cursor ? line : Math.abs(line - cursor)}`;
            },
          }),
          noteLanguage(),
          markdownLanguage.data.of({ autocomplete: wikiLinkCompletions }),
          markdownLanguage.data.of({ autocomplete: todoCompletions }),
          markdownLanguage.data.of({ autocomplete: imageCompletions }),
          markdownLanguage.data.of({ autocomplete: tagCompletions }),
          markdownLanguage.data.of({ autocomplete: relationCompletions }),
          // The clipboard's image goes into the vault and the note gets the
          // path. Ahead of nothing in particular: CodeMirror's own paste is a
          // handler on the same event and runs when this one declines, which is
          // every paste that carries text.
          imagePaste(),
          noticeHandler.of((message) => onNoticeRef.current?.(message)),
          followOnClick,
          vault.of(
            listings(pathsRef.current, imagesRef.current, tagsRef.current, relationsRef.current),
          ),
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
    // The path alone, because a facet holds the value it was built with and
    // this is the one that carries one. It never fires twice: `note-editor.tsx`
    // keys this component on the path, so a second note is a second view.
  }, [path]);

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
  //
  // The guard is asked here and not when the vault reported the write, because
  // the two are not the same moment: the read takes a round trip, and the
  // reader can type into a buffer that was clean when it went out. It is handed
  // the text, so the answer to a write of our own can be told from somebody
  // else's and only one of the two is worth reporting.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || reloadDoc === undefined) return;

    takeVaultText(view, reloadDoc, allowReloadRef.current);
  }, [reloadDoc]);

  // Runs on mount as well as on every raise, which is what a freshly split pane
  // needs: it is created focused, and its first render is the only chance it
  // gets to say so. A pane that is not the focused one is handed 0 and stays put.
  useEffect(() => {
    if (focusSignal) viewRef.current?.focus();
  }, [focusSignal]);

  // A position, written where the note keeps them. `mark` is a new object per
  // report, so this fires once per stop rather than once per render.
  useEffect(() => {
    const view = viewRef.current;
    if (mark === undefined || view === null) return;

    const held = view.state.doc.toString();
    const wanted = setWatched(held, mark.id, mark.seconds);
    if (wanted === held) return;

    // The smallest change that gets there, rather than replacing the document.
    // A whole-document replace maps the cursor to nowhere in particular and
    // would move it out from under whoever is typing; this touches the
    // frontmatter block alone, so a cursor below it does not move at all.
    let from = 0;
    while (held[from] === wanted[from]) from += 1;
    let tail = 0;
    while (
      tail < Math.min(held.length, wanted.length) - from &&
      held[held.length - 1 - tail] === wanted[wanted.length - 1 - tail]
    ) {
      tail += 1;
    }

    view.dispatch({
      changes: { from, to: held.length - tail, insert: wanted.slice(from, wanted.length - tail) },
      // Nobody typed this, so `u` must not undo it. An edit in the history
      // would also put the position back the moment you undid a sentence.
      annotations: Transaction.addToHistory.of(false),
    });
  }, [mark]);

  // Coming back to the tab lands on the body when the page had nothing focused
  // when you left it, and the cursor is dead again until you click.
  //
  // Only the focused pane's editor revives itself. Every pane mounts one of
  // these and they would otherwise all race, which is invisible between two
  // notes and wrong beside a terminal: a terminal pane loses every time, and
  // the shell then drops every key until you click back into it.
  useEffect(() => {
    function onWindowFocus() {
      if (focused && nothingFocused()) viewRef.current?.focus();
    }

    window.addEventListener("focus", onWindowFocus);
    return () => window.removeEventListener("focus", onWindowFocus);
  }, [focused]);

  // Swapping the extension out is all this takes: the same `livePreview()`
  // pieces come back by identity, so nothing below them is rebuilt.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: preview.reconfigure(rendered ? livePreview() : []),
    });
  }, [rendered]);

  // A note written elsewhere is a link in this note that has just come to life,
  // so the listing goes in whenever the route hands over a new one. The images,
  // the tags and the relation names ride along in the same compartment: all four
  // are the vault saying what it holds.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: vault.reconfigure(listings(paths, images, tags, relations)),
    });
  }, [paths, images, tags, relations]);

  return <div ref={host} className="h-full overflow-auto" />;
}
