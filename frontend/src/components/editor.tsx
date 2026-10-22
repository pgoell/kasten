import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { takeVaultText, writeWatched } from "@/lib/buffer-writes";
import { notePosition } from "@/lib/editor-position";
import type { EmbedSource } from "@/lib/embed";
import type { EditorCommands } from "@/lib/key-bindings";
import { keyboardUnasked } from "@/lib/last-input";
import type { Outline } from "@/lib/note-head";
import {
  createNoteView,
  type NoteViewLatest,
  setListings,
  setPreview,
  setVim,
} from "@/lib/note-view";
import type { CycleHandler } from "@/lib/todo-commands";
import { useVim } from "@/lib/vim-setting";

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
   * Raised with each open at `startLine`, so following a link to the line
   * already named moves the cursor back to it after it has wandered off.
   */
  jump?: number;
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
  /** Whether an id stands on a todo line in another note. See `idElsewhere`. */
  idElsewhere?: (id: string) => boolean;
  /** The note this holds, which tells today's own note from every other. */
  path?: string;
  /**
   * How a `![[note]]` reads the note it draws and opens it.
   *
   * Absent draws every embed as its source, the way an absent `paths` calls no
   * link dead: a view nobody told how to read the vault cannot say a note is
   * missing. Read at mount for whether there is one, through the ref after.
   */
  embeds?: EmbedSource;
  /**
   * Called with a sentence for the reader when a pasted image is refused.
   *
   * The one thing the editor does that the vault can refuse with no key having
   * been pressed, and the paste is silent without it.
   */
  onNotice?: (message: string) => void;
  /**
   * Called with the note's headings and the one being read, on each change of either.
   *
   * Absent means the outline is not shown anywhere, which costs the view nothing.
   */
  onOutline?: (outline: Outline) => void;
  /** Called when the header's Graph button is pressed. See `NoteEditor`. */
  onGraph?: () => void;
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
  jump,
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
  idElsewhere: elsewhere,
  path,
  onNotice,
  embeds,
  onOutline,
  onGraph,
}: EditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const vimOn = useVim();
  // What the view was last configured with, which the mount reads and the
  // toggle below compares against.
  const vimOnRef = useRef(vimOn);
  // Every prop lives in a ref so the mount effect depends on nothing. Rebuilding
  // the view throws away undo history and cursor position, so it must happen
  // exactly once: to open a different note, remount with a `key`.
  const initialDocRef = useRef(initialDoc);
  const startLineRef = useRef(startLine);
  const focusedRef = useRef(focused);
  const renderedRef = useRef(rendered);
  const pathsRef = useRef(paths);
  const imagesRef = useRef(images);
  const tagsRef = useRef(tags);
  const relationsRef = useRef(relations);
  // The callbacks the view calls, held in one ref the view reads at the moment
  // it calls one, so a re-render never has to rebuild the view to refresh one.
  const latest = useRef<NoteViewLatest>({
    commands,
    onChange,
    onSave,
    onFollow,
    onOpenHighlight,
    onCycleTodo,
    elsewhere,
    onNotice,
    allowReload,
    onReload,
    embeds,
    onOutline,
    onGraph,
  });

  useEffect(() => {
    latest.current = {
      commands,
      onChange,
      onSave,
      onFollow,
      onOpenHighlight,
      onCycleTodo,
      elsewhere,
      onNotice,
      allowReload,
      onReload,
      embeds,
      onOutline,
      onGraph,
    };
  }, [
    commands,
    onChange,
    onSave,
    onFollow,
    onOpenHighlight,
    onCycleTodo,
    elsewhere,
    onNotice,
    allowReload,
    onReload,
    embeds,
    onOutline,
    onGraph,
  ]);

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;

    // Where this note was left, unless the open names a line: a search hit or
    // a URL says where to read, and the effect further down puts the cursor
    // there. Read and not restored only to be moved, which would scroll twice.
    const position = notePosition(path, startLineRef.current !== undefined);
    // The text as CodeMirror holds it, which is not the string handed in when
    // that has `\r\n` line ends: the editor keeps a `\n` alone, and every
    // offset below counts in its text.
    const doc = EditorState.create({ doc: initialDocRef.current }).doc;

    const view = createNoteView({
      parent,
      doc,
      selection: position.selection(doc),
      path,
      vim: vimOnRef.current,
      preview: renderedRef.current,
      listings: {
        paths: pathsRef.current,
        images: imagesRef.current,
        tags: tagsRef.current,
        relations: relationsRef.current,
      },
      latest,
      position: position.listener,
    });
    viewRef.current = view;
    // A freshly loaded page focuses nothing, and the first thing typed at it
    // goes nowhere. The editor is what the page is for, so it takes the focus.
    // Not after a tap on a phone, for the reason the signal below gives. Only
    // the focused pane's, as on the way back into the tab: a restored tab
    // mounts every pane at once, and the first to mount would take the focus,
    // which the route follows to that pane and which turns its zoom off.
    if (focusedRef.current && !keyboardUnasked() && nothingFocused()) view.focus();

    const detach = position.attach(view);
    return () => {
      detach();
      viewRef.current = null;
      view.destroy();
    };
    // The path alone, because a facet holds the value it was built with and
    // this is the one that carries one. It never fires twice: `note-editor.tsx`
    // keys this component on the path, so a second note is a second view.
  }, [path]);

  // The setting moved, in this pane or another. The cursor, the text and the
  // undo history all stay.
  useEffect(() => {
    if (vimOnRef.current === vimOn) return;
    vimOnRef.current = vimOn;
    const view = viewRef.current;
    if (view) setVim(view, vimOn);
  }, [vimOn]);

  // Declared after the mount effect so the view exists by the time this runs,
  // which is what lets one effect serve both cases: opening a note on a line,
  // and moving to another line of the note already open.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `jump` is the trigger and not read. A second open at the same line is what moves the cursor back to it.
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
  }, [startLine, jump]);

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

    takeVaultText(view, reloadDoc, latest.current.allowReload);
  }, [reloadDoc]);

  // Runs on mount as well as on every raise, which is what a freshly split pane
  // needs: it is created focused, and its first render is the only chance it
  // gets to say so. A pane that is not the focused one is handed 0 and stays put.
  //
  // Not after a tap on a phone, where the focus is what raises the on-screen
  // keyboard: a tap that moved to a pane or opened a note did not ask to type
  // in it, and half the screen would go to keys nobody reached for. A tap on
  // the text does ask. An editor that already holds the focus keeps it either
  // way. `keyboardUnasked` says why a wide touch screen is left out.
  useEffect(() => {
    if (focusSignal && !keyboardUnasked()) viewRef.current?.focus();
  }, [focusSignal]);

  // A position, written where the note keeps them. `mark` is a new object per
  // report, so this fires once per stop rather than once per render.
  useEffect(() => {
    const view = viewRef.current;
    if (mark === undefined || view === null) return;

    writeWatched(view, mark);
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
      // Nor on a phone that was last tapped: coming back to the tab is not
      // asking to type either.
      if (focused && !keyboardUnasked() && nothingFocused()) viewRef.current?.focus();
    }

    window.addEventListener("focus", onWindowFocus);
    return () => window.removeEventListener("focus", onWindowFocus);
  }, [focused]);

  // Swapping the extension out is all this takes: the same `livePreview()`
  // pieces come back by identity, so nothing below them is rebuilt.
  useEffect(() => {
    const view = viewRef.current;
    if (view) setPreview(view, rendered);
  }, [rendered]);

  // A note written elsewhere is a link in this note that has just come to life,
  // so the listing goes in whenever the route hands over a new one. The images,
  // the tags and the relation names ride along in the same compartment: all four
  // are the vault saying what it holds.
  useEffect(() => {
    const view = viewRef.current;
    if (view) setListings(view, { paths, images, tags, relations });
  }, [paths, images, tags, relations]);

  return <div ref={host} className="h-full overflow-auto" />;
}
