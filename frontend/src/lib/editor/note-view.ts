import { acceptCompletion } from "@codemirror/autocomplete";
import { indentWithTab } from "@codemirror/commands";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { Compartment, EditorState, type Extension, type Text } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import { basicSetup } from "codemirror";
import { backticks } from "@/lib/editor/backticks";
import { FORMAT } from "@/lib/editor/buffer-keys";
import { fromVault } from "@/lib/editor/buffer-writes";
import { editorCommands, forwardCommands, leaderPanel } from "@/lib/editor/editor-commands";
import { byName, reloadHandler, save, saveHandler } from "@/lib/editor/editor-ex";
import {
  type FileTarget,
  followHandler,
  followOnClick,
  followOnTap,
  highlightHandler,
} from "@/lib/editor/editor-follow";
import { kastenTheme } from "@/lib/editor/editor-theme";
import { toggleMark } from "@/lib/editor/format-commands";
import { moveCell } from "@/lib/editor/table";
import { tableLineup } from "@/lib/editor/table-lineup";
import { tableSource } from "@/lib/editor/table-source";
import { vimKeys } from "@/lib/editor/vim-mode";
import { type EmbedSource, embedSource } from "@/lib/embed";
import { imageCompletions, imagePaste, imagePaths, noticeHandler } from "@/lib/image";
import type { EditorCommands } from "@/lib/key-bindings";
import { keyboardUnasked } from "@/lib/last-input";
import { livePreview } from "@/lib/live/live-preview";
import { timeSeek } from "@/lib/live/live-preview-times";
import { logCard } from "@/lib/log/log-card";
import { graphHandler, noteHead, type Outline, readMode } from "@/lib/note/note-head";
import { weatherCard } from "@/lib/note/weather-card";
import { noteLanguage } from "@/lib/note-language";
import { relationCompletions, vaultRelations } from "@/lib/ontology";
import { slashCompletions } from "@/lib/palette";
import { periodicReview, type ReviewSource, reviewSource } from "@/lib/review/periodic-review";
import { tagCompletions, vaultTags } from "@/lib/tag";
import { type CycleHandler, idElsewhere, notePath, todoCycled } from "@/lib/todo/todo-commands";
import { todoCompletions } from "@/lib/todo/todo-suggest";
import { vaultPaths, wikiLinkCompletions } from "@/lib/wikilink";

/**
 * The callbacks a view calls, held where the view can read them at the moment
 * it calls one. A re-render replaces this, and the view never has to be rebuilt
 * to see the new one.
 */
export interface NoteViewLatest {
  commands?: EditorCommands;
  onChange?: (doc: string) => void;
  onSave?: (doc: string) => void;
  onFollow?: (target: string, file?: FileTarget) => void;
  onOpenHighlight?: (quote: string[]) => void;
  onCycleTodo?: CycleHandler;
  elsewhere?: (id: string) => boolean;
  onNotice?: (message: string) => void;
  onReload?: (force: boolean) => Promise<string | null>;
  embeds?: EmbedSource;
  review?: ReviewSource;
  allowReload?: (text: string) => boolean;
  onOutline?: (outline: Outline) => void;
  onGraph?: () => void;
  onSeek?: (seconds: number, id?: string) => void;
}

/** The four listings the vault carries. Any of them absent means told nothing. */
export interface NoteListings {
  paths?: string[];
  images?: string[];
  tags?: string[];
  relations?: string[];
}

/**
 * Holds live preview, so `<leader>p` can swap it out. A compartment, not a rebuilt view,
 * which would lose the undo history and the cursor.
 */
const preview = new Compartment();

/**
 * Holds vim, so the setting can take it out and put it back. Rebuilding would drop text
 * typed in the autosave's second of lag.
 */
const modal = new Compartment();

/**
 * vim's `number relativenumber`. Adds a formatter to basicSetup's gutter rather than a second one,
 * and it redraws on a line change because `highlightActiveLineGutter` moves its marker then.
 */
const relativeNumbers = lineNumbers({
  formatNumber: (line, state) => {
    const cursor = state.doc.lineAt(state.selection.main.head).number;
    return `${line === cursor ? line : Math.abs(line - cursor)}`;
  },
});

/**
 * The formatting chords as plain bindings, for the editor without vim. CodeMirror wants
 * `Ctrl-Shift-h` where `FORMAT` has `<C-S-H>`, and without these ctrl+i selects a syntax node.
 */
const formatKeys = keymap.of(
  FORMAT.map(({ key, spec }) => ({
    key: key
      .slice(1, -1)
      .replace("C-", "Ctrl-")
      .replace("S-", "Shift-")
      .replace(/.$/, (letter) => letter.toLowerCase()),
    run: (view: EditorView) => toggleMark(view, spec),
    preventDefault: true,
  })),
);

/**
 * What the compartment holds: vim and the gutter that counts for it, or the
 * word that there is none, which live preview reads as always typing, and the
 * chords vim would have resolved.
 */
function modalKeys(on: boolean): Extension {
  return on ? [vim(), relativeNumbers] : [vimKeys.of(false), formatKeys];
}

/**
 * Holds the vault listing, which changes while a note is open. A compartment, not a rebuild,
 * which would drop the undo history and the cursor.
 */
const vault = new Compartment();

/**
 * The four vault listings. Any one absent is a view told nothing, which offers nothing and calls
 * no link dead; it is not an empty vault.
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
 * Builds one note's view. The extensions come in the order they always have,
 * because whichever keymap is registered earliest wins.
 */
export function createNoteView(o: {
  parent: HTMLElement;
  doc: Text;
  selection: { anchor: number; head?: number };
  path?: string;
  vim: boolean;
  preview: boolean;
  listings: NoteListings;
  latest: { readonly current: NoteViewLatest };
  position: Extension;
}): EditorView {
  const { latest } = o;
  const view = new EditorView({
    state: EditorState.create({
      doc: o.doc,
      selection: o.selection,
      extensions: [
        // Must come first: whichever keymap is registered earliest wins, and
        // vim's bindings have to beat the ones basicSetup installs.
        modal.of(modalKeys(o.vim)),
        // Ahead of basicSetup for the same reason: ctrl+s must reach us
        // rather than open the browser's save dialog.
        keymap.of([
          { key: "Mod-s", run: save, preventDefault: true },
          // The terminal's chord for the palette, here as well: `<leader>:`
          // is a vim mapping, and with vim off no other key opens it.
          {
            // Ctrl on every platform and not `Mod`, which is cmd on a Mac:
            // `TERMINAL_CHORD` is ctrl there too, and one chord has to mean
            // one thing in both panes.
            key: "Ctrl-Shift-p",
            run: (view) => {
              view.state.facet(editorCommands)?.openPalette();
              return true;
            },
            preventDefault: true,
          },
        ]),
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
        saveHandler.of((doc) => latest.current.onSave?.(doc)),
        // Forwarded as the editor called it: a wikilink passes its name alone.
        followHandler.of((...args) => latest.current.onFollow?.(...args)),
        timeSeek.of((seconds, id) => latest.current.onSeek?.(seconds, id)),
        // Only a view told about a graph draws the Graph button, so an editor with
        // no graph to open (the todo pane's, say) keeps the header it had.
        ...(latest.current.onGraph === undefined
          ? []
          : [graphHandler.of(() => latest.current.onGraph?.())]),
        highlightHandler.of((quote) => latest.current.onOpenHighlight?.(quote)),
        todoCycled.of((cycle) => latest.current.onCycleTodo?.(cycle)),
        idElsewhere.of((id) => latest.current.elsewhere?.(id) === true),
        ...(o.path === undefined ? [] : [notePath.of(o.path)]),
        // Outside every compartment, so a vim toggle or a new listing never
        // takes it out. The ref and not the prop, for the reason the
        // handlers above read theirs.
        ...(latest.current.embeds === undefined
          ? []
          : [
              embedSource.of({
                watch: (target, listener) =>
                  latest.current.embeds?.watch(target, listener) ?? (() => {}),
                // The box cancels its mousedown, so the focus stays in the
                // pane it was in and the open would land off that one: the
                // focus moves here first, as on a ctrl+click on a link
                // (#361). This view and not the box's, an embed inside an
                // embed being drawn in a nested view that cannot take the
                // focus but carries this same source. Not on a phone's tap,
                // where it would raise a keyboard nobody asked for.
                open: (target, line) => {
                  if (!keyboardUnasked()) view.focus();
                  latest.current.embeds?.open(target, line);
                },
              }),
            ]),
        // A pane with nothing to reload answers the way a refusal does, so
        // `:e` in one is a key that does nothing rather than a key that
        // throws.
        reloadHandler.of((force) => latest.current.onReload?.(force) ?? Promise.resolve(null)),
        forwardCommands(() => latest.current.commands),
        leaderPanel,
        basicSetup,
        noteLanguage(),
        markdownLanguage.data.of({ autocomplete: wikiLinkCompletions }),
        markdownLanguage.data.of({ autocomplete: todoCompletions }),
        markdownLanguage.data.of({ autocomplete: imageCompletions }),
        markdownLanguage.data.of({ autocomplete: tagCompletions }),
        markdownLanguage.data.of({ autocomplete: relationCompletions }),
        markdownLanguage.data.of({ autocomplete: slashCompletions }),
        // The clipboard's image goes into the vault and the note gets the
        // path. Ahead of nothing in particular: CodeMirror's own paste is a
        // handler on the same event and runs when this one declines, which is
        // every paste that carries text.
        imagePaste(),
        noticeHandler.of((message) => latest.current.onNotice?.(message)),
        followOnClick(),
        followOnTap(),
        byName,
        vault.of(
          listings(o.listings.paths, o.listings.images, o.listings.tags, o.listings.relations),
        ),
        noteHead({
          toggle: () => latest.current.commands?.togglePreview(),
          outline: (outline) => latest.current.onOutline?.(outline),
        }),
        preview.of(o.preview ? [livePreview(), weatherCard, logCard, readMode.of(true)] : []),
        // Outside the preview compartment: the source of a table is marked in
        // Edit too, where preview is off, and the line-up has to be there either way.
        tableSource,
        tableLineup,
        // The same for the review block, which reads from the view's own state, so
        // the ref is read here and not the prop, as the embeds' source is above.
        ...(latest.current.review === undefined
          ? []
          : [
              reviewSource.of({
                client: latest.current.review.client,
                open: (path, line) => latest.current.review?.open(path, line),
              }),
            ]),
        periodicReview,
        kastenTheme,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          // `every` and not `some`: an update carrying the reload alongside
          // something the user typed is an update whose text has to be
          // written, and the keystroke in it would go unreported otherwise.
          if (update.docChanged && !update.transactions.every((tr) => tr.annotation(fromVault))) {
            latest.current.onChange?.(update.state.doc.toString());
          }
        }),
        o.position,
      ],
    }),
  });
  // Joined to the page after the constructor, not through `parent`: the constructor
  // reads fonts and styles, which forces a style pass over the tree it is still
  // building. Detached, that pass covers nothing, and the tree takes one pass when
  // it joins.
  o.parent.append(view.dom);
  return view;
}

export function setVim(view: EditorView, on: boolean): void {
  view.dispatch({ effects: modal.reconfigure(modalKeys(on)) });
}

export function setPreview(view: EditorView, on: boolean): void {
  // The scroll is read first and put back in the same transaction: a table drawn
  // or un-drawn changes the heights above the line at the top, which would
  // otherwise move that line off the top.
  view.dispatch({
    effects: [
      view.scrollSnapshot(),
      preview.reconfigure(on ? [livePreview(), weatherCard, logCard, readMode.of(true)] : []),
    ],
  });
}

export function setListings(view: EditorView, l: NoteListings): void {
  view.dispatch({ effects: vault.reconfigure(listings(l.paths, l.images, l.tags, l.relations)) });
}
