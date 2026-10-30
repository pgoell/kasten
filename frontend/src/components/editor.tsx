import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useContext, useEffect, useLayoutEffect, useRef } from "react";
import { takeVaultText, writeWatched } from "@/lib/editor/buffer-writes";
import type { FileTarget } from "@/lib/editor/editor-follow";
import { notePosition } from "@/lib/editor/editor-position";
import {
  createNoteView,
  type NoteViewLatest,
  setListings,
  setPreview,
  setVim,
} from "@/lib/editor/note-view";
import { useVim } from "@/lib/editor/vim-setting";
import type { EmbedSource } from "@/lib/embed";
import type { EditorCommands } from "@/lib/key-bindings";
import { keyboardUnasked } from "@/lib/last-input";
import { Leaving } from "@/lib/leaving";
import type { Outline } from "@/lib/note/note-head";
import type { ReviewSource } from "@/lib/review/periodic-review";
import type { CycleHandler } from "@/lib/todo/todo-commands";

/**
 * Whether nobody on the page holds the focus. The editor takes it only then:
 * the tree and key map are focusable too, and a remount on opening a note
 * there would end a walk down the tree after the first one.
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
   * Every note in the vault, for completing a `[[` and for spotting dead links.
   * Absent means the listing is not known here, which is not an empty vault.
   */
  paths?: string[];
  /**
   * Every image in the vault, for completing the path in an open `![](`. Its own
   * list: an image is never linked with `[[`, and a missing image is a mistake
   * where a missing note is only an invitation.
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
   * Every relation name the ontology note lists, for completing one. Read off that
   * note, so editing it changes the vocabulary without a release.
   */
  relations?: string[];
  /**
   * Line to open on, counting from one. Absent starts at the top. Not folded into
   * `initialDoc`'s read-once rule: a second search hit can name another line of the
   * note already open, and that moves the cursor without a rebuild.
   */
  startLine?: number;
  /**
   * Raised with each open at `startLine`, so following a link to the line
   * already named moves the cursor back to it after it has wandered off.
   */
  jump?: number;
  /**
   * Raised when the app wants this editor to take the focus; 0 while it does not.
   * A counter, not a flag: moving to a pane and back are two requests that must both
   * read as a change. The route raises it for a key, not for a click.
   */
  focusSignal?: number;
  /**
   * A video position for this note's frontmatter, or absent for none. Written into
   * the buffer, not the vault: the vault's copy would overwrite your unsaved text.
   */
  mark?: { id: string; seconds: number };
  /**
   * Whether the pane this sits in is the focused one. Every pane mounts one of these,
   * so without this check they all race for the focus.
   */
  focused?: boolean;
  /**
   * Asked just before the vault's text goes in, and can refuse. The buffer may pick
   * up unsaved text between the vault's write and this read, so the holder is asked
   * at the last moment. Absent means nobody holds any.
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
  onFollow?: (target: string, file?: FileTarget) => void;
  /** Called with a highlight block's paragraphs when `gf` lands on one. */
  onOpenHighlight?: (quote: string[]) => void;
  /** Called with the line `<leader>x` cycled, which the done log follows. */
  onCycleTodo?: CycleHandler;
  /** Whether an id stands on a todo line in another note. See `idElsewhere`. */
  idElsewhere?: (id: string) => boolean;
  /** The note this holds, which tells today's own note from every other. */
  path?: string;
  /**
   * How a `![[note]]` reads the note it draws and opens. Absent draws every embed as
   * its source, so a view told nothing cannot call a note missing.
   */
  embeds?: EmbedSource;
  /** What a periodic note's review block reads with. Absent, no block is drawn. */
  review?: ReviewSource;
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
  /** Called with the seconds a time in the note asks the video to seek to, and its video's id when it names one. See `NoteEditor`. */
  onSeek?: (seconds: number, id?: string) => void;
}

/**
 * A CodeMirror 6 markdown editor. The EditorView owns the document: never mirror
 * the text into React state, or every keystroke re-renders the tree.
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
  review,
  onOutline,
  onGraph,
  onSeek,
}: EditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const leaving = useContext(Leaving);
  // The position's writer, kept so a view taken off the page can be watched again.
  const positionRef = useRef<ReturnType<typeof notePosition> | null>(null);
  const detachRef = useRef<(() => void) | null>(null);
  const vimOn = useVim();
  const vimOnRef = useRef(vimOn);
  // The mount runs once: rebuilding would throw away undo history and the cursor.
  const initialDocRef = useRef(initialDoc);
  const startLineRef = useRef(startLine);
  const focusedRef = useRef(focused);
  const renderedRef = useRef(rendered);
  const pathsRef = useRef(paths);
  const imagesRef = useRef(images);
  const tagsRef = useRef(tags);
  const relationsRef = useRef(relations);
  // Read when the view calls, so a re-render never rebuilds the view to refresh one.
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
    review,
    onOutline,
    onGraph,
    onSeek,
  });

  // Not while leaving: the view on its way out must not reach the new note's callbacks.
  useEffect(() => {
    if (leaving) return;
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
      review,
      onOutline,
      onGraph,
      onSeek,
    };
  }, [
    leaving,
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
    review,
    onOutline,
    onGraph,
    onSeek,
  ]);

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;

    // Restored only when the open names no line: a named one moves the cursor, and a
    // restore too would scroll twice.
    const position = notePosition(path, startLineRef.current !== undefined);
    // CodeMirror holds the text with `\r\n` folded to `\n`, so offsets count its text.
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
    // A fresh page focuses nothing, so the first keystroke goes nowhere: take the focus.
    // Only the focused pane, and not after a phone tap: see the signal below.
    if (focusedRef.current && !keyboardUnasked() && nothingFocused()) view.focus();

    positionRef.current = position;
    detachRef.current = position.attach(view);
    return () => {
      detachRef.current?.();
      detachRef.current = null;
      viewRef.current = null;
      view.destroy();
    };
    // Path alone: note-editor.tsx keys this view on it, so the effect never fires twice.
  }, [path]);

  // Leaving keeps this view a task longer, so it drops its callbacks and writes its
  // cursor and scroll now for the new editor to read (`nothingFocused` in editor.tsx).
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!leaving) {
      // A new position: the made one has shown its scroll already, so its reveal does nothing.
      if (view && detachRef.current === null) {
        const position = notePosition(path, false);
        positionRef.current = position;
        detachRef.current = position.attach(view);
      }
      return;
    }
    latest.current = {};
    detachRef.current?.();
    detachRef.current = null;
    if (view?.hasFocus) view.contentDOM.blur();
  }, [leaving, path]);

  // Reconfigure, do not rebuild: a rebuild would lose the cursor and the undo history.
  useEffect(() => {
    if (vimOnRef.current === vimOn) return;
    vimOnRef.current = vimOn;
    const view = viewRef.current;
    if (view) setVim(view, vimOn);
  }, [vimOn]);

  // Declared after the mount effect, so the view exists by the time this runs.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `jump` is the trigger and not read. A second open at the same line is what moves the cursor back to it.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || startLine === undefined) return;

    // The note can shrink between a scan and a click, and CodeMirror throws past its end.
    const { doc } = view.state;
    const line = doc.line(Math.min(startLine, doc.lines));
    view.dispatch({
      selection: { anchor: line.from },
      // Centred, so a match at an edge is not one you cannot read around.
      effects: EditorView.scrollIntoView(line.from, { y: "center" }),
    });
  }, [startLine, jump]);

  // Vault text written to the open note elsewhere goes in as one transaction, not a remount,
  // so undo history and the cursor survive. The guard is asked here, not at the write,
  // since the reader may have typed since. Not while leaving: a missing allowReload counts as allowed.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || reloadDoc === undefined || leaving) return;

    takeVaultText(view, reloadDoc, latest.current.allowReload);
  }, [reloadDoc, leaving]);

  // Also on mount: a freshly split pane is created focused, and its first render is its one chance.
  // Not after a phone tap, which would raise the on-screen keyboard for a tap that did not ask.
  useEffect(() => {
    if (focusSignal && !keyboardUnasked()) viewRef.current?.focus();
  }, [focusSignal]);

  // `mark` is a new object per report, so this fires once per stop, not once per render.
  useEffect(() => {
    const view = viewRef.current;
    if (mark === undefined || view === null) return;

    writeWatched(view, mark);
  }, [mark]);

  // Coming back to the tab lands on the body if nothing was focused, and the cursor is dead.
  // Only the focused pane revives itself: the rest would race, and a terminal loses and drops keys.
  useEffect(() => {
    function onWindowFocus() {
      // Nor on a phone that was last tapped: coming back to the tab is not asking to type.
      if (focused && !keyboardUnasked() && nothingFocused()) viewRef.current?.focus();
    }

    window.addEventListener("focus", onWindowFocus);
    return () => window.removeEventListener("focus", onWindowFocus);
  }, [focused]);

  // Swapping the extension keeps the same `livePreview()` pieces, so nothing below is rebuilt.
  // The mount skips it: a reconfigure would carry a scroll taken before the open centred (#950).
  useEffect(() => {
    if (renderedRef.current === rendered) return;
    renderedRef.current = rendered;
    const view = viewRef.current;
    if (view) setPreview(view, rendered);
  }, [rendered]);

  // A new note in the vault makes a link live, so the listings go in whenever the route hands one over.
  // The mount skips them: a reconfigure there costs a phone a full style pass (#972).
  const listedRef = useRef({ paths, images, tags, relations });
  useEffect(() => {
    const listed = listedRef.current;
    if (
      listed.paths === paths &&
      listed.images === images &&
      listed.tags === tags &&
      listed.relations === relations
    ) {
      return;
    }
    listedRef.current = { paths, images, tags, relations };
    const view = viewRef.current;
    if (view) setListings(view, { paths, images, tags, relations });
  }, [paths, images, tags, relations]);

  return <div ref={host} className="h-full overflow-auto" />;
}
