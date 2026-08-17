/**
 * `![](path)`, the one thing in a note that is not text.
 *
 * Four pieces: where a pasted image lands, the listing an open `![](` completes
 * against, the key that writes the pair of brackets, and the paste that puts an
 * image in the vault. The rendering is not here, `live-preview.ts` drawing every
 * decoration the editor has, and neither is the request, `api.ts` owning those.
 */

import {
  type CompletionContext,
  type CompletionResult,
  startCompletion,
} from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { EditorSelection, type EditorState, Facet } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { uploadAsset } from "@/lib/api";
import { readClock } from "@/lib/clock";

/**
 * Where a pasted image is written.
 *
 * One folder for the lot of them rather than one beside each note. An image is
 * referenced by path and moves with nothing, so a note that moves would leave a
 * broken reference behind if the two travelled together, and the sidecar
 * convention a book gets does not stretch to the several images one note holds.
 */
export const IMAGE_FOLDER = "99 Misc/02 Assets/01 Images";

/** What a pasted image is called, minus the suffix its type names. */
const NAMED = /^image\//;

/**
 * Every image in the vault, carried on the editor state.
 *
 * The note listing's opposite number, and separate from it for the reason
 * `/api/images` is separate from `/api/files`: an image is not a note. Null is
 * the default rather than an empty vault, so a view that was told nothing offers
 * nothing, which is what the finder's preview pane is.
 */
export const imagePaths = Facet.define<string[], string[] | null>({
  combine: (values) => values[0] ?? null,
});

/** Called with the sentence a failed paste has to be reported with. */
type NoticeHandler = (message: string) => void;

/**
 * Carries the callback a refused paste is reported through.
 *
 * A facet for the reason `saveHandler` is one: the paste handler is registered
 * once for the whole module and cannot close over one view's props. The upload
 * is the only thing the editor does that the vault can refuse without a key
 * having been pressed, so this is the only message it has to pass up.
 */
export const noticeHandler = Facet.define<NoticeHandler, NoticeHandler | undefined>({
  combine: (handlers) => handlers[0],
});

/**
 * The URL of the vault image an `![](path)` names, or null for anything else.
 *
 * A path and not a URL is the rule: `img-src` allows this origin alone, so a
 * remote address would draw a broken image where the source at least says what
 * was meant. The path is already percent-encoded, the toggle and the
 * completion both writing it that way, so it goes into the URL as it stands.
 */
export function imageSource(url: string): string | null {
  if (/^[a-z][a-z\d+.-]*:|^\/\//i.test(url)) return null;
  return `/api/assets/${url}`;
}

/** The `Image` or `Link` node enclosing the position, looking one way only. */
function enclosing(state: EditorState, pos: number, side: -1 | 1) {
  let node = syntaxTree(state).resolveInner(pos, side);
  for (; node.parent; node = node.parent) {
    if (node.name === "Image" || node.name === "Link") return node;
  }
  return null;
}

/**
 * The `![](path)` or `[](path)` the cursor sits in, or null outside both.
 *
 * Both ways round the position, the way `wikiLinkAt` reads a link: a rendered
 * image is a replaced range the cursor cannot enter, so the cursor asking about
 * one is always beside it rather than inside it.
 */
function linkAt(state: EditorState, pos: number) {
  return enclosing(state, pos, 1) ?? enclosing(state, pos, -1);
}

/**
 * Turn the link under the cursor into an image and back, or start a new one.
 *
 * The whole difference between a link and an image is the `!`, so the toggle is
 * one character in and one character out. With the cursor on neither, there is
 * nothing to toggle and the key writes the empty pair instead, leaving the
 * cursor where the path goes and the completion list already open: that is the
 * only way to an image that does not involve typing four brackets by hand.
 */
export function toggleImageAtCursor(view: EditorView): void {
  const { state } = view;
  const cursor = state.selection.main.head;
  const node = linkAt(state, cursor);

  if (node?.name === "Image") {
    view.dispatch({ changes: { from: node.from, to: node.from + 1 } });
    return;
  }
  if (node?.name === "Link") {
    view.dispatch({ changes: { from: node.from, insert: "!" } });
    return;
  }

  const skeleton = "![]()";
  view.dispatch({
    changes: { from: cursor, insert: skeleton },
    // Between the parens, which is what the completion below completes into.
    selection: EditorSelection.cursor(cursor + skeleton.length - 1),
  });
  startCompletion(view);
}

/** What has been typed into an open `![](`, which is what a completion completes. */
const TYPED = /!\[[^[\]\n]*\]\([^()\n]*/;

/**
 * Every image in the vault, offered inside an open `![](`.
 *
 * Labelled by filename and applied as the whole path, so the list reads as the
 * names you gave the pictures while the note gets the path the backend answers
 * to. Unranked for the reason `wikiLinkCompletions` is: CodeMirror scores the
 * labels against what has been typed, which is the fuzzy match the finder does
 * by hand and one this does not have to write.
 */
export function imageCompletions(context: CompletionContext): CompletionResult | null {
  const paths = context.state.facet(imagePaths);
  if (paths === null) return null;

  const open = context.matchBefore(TYPED);
  if (!open) return null;

  return {
    // Past the `](`, which is in the document already: what a completion
    // replaces is the path alone.
    from: open.from + open.text.indexOf("](") + 2,
    options: paths.map((path) => ({
      label: path.slice(path.lastIndexOf("/") + 1),
      // Encoded here rather than on the way out, so what the note holds is a
      // legal markdown destination: a space in `99 Misc` ends one that is not.
      apply: encodeURI(path),
      detail: path.slice(0, path.lastIndexOf("/")),
      type: "text",
    })),
    validFor: /^[^()\n]*$/,
  };
}

/**
 * The name an image is filed under: today, eight hex digits, and the type.
 *
 * The clipboard hands over `image.png` for every image ever copied and the vault
 * overwrites nothing, so the name has to be one nothing else can claim. The date
 * is for whoever browses the folder later; the digits are what make it unique.
 *
 * The suffix comes off the MIME type, so `image/png` files as `.png`. A type the
 * backend does not hold a magic for is refused there rather than sorted out
 * here, which is one list of formats instead of two.
 *
 * Exported for the reader, which files a figure out of a book the same way: one
 * naming rule for everything that lands in `IMAGE_FOLDER`.
 */
export function filedName(type: string): string {
  const unique = crypto.randomUUID().slice(0, 8);
  return `${readClock(new Date()).date}-${unique}.${type.replace(NAMED, "")}`;
}

/**
 * Put a pasted image in the vault and write the reference to it.
 *
 * The upload goes first and the text is written when it lands, so a refusal
 * leaves the note as it was rather than holding a reference to nothing. The
 * insertion goes wherever the cursor is by then rather than where it was: the
 * round trip is one user's local network away, and a position saved across it
 * would be the wrong one the moment anything else was typed.
 */
async function fileImage(view: EditorView, file: File, name: string): Promise<void> {
  const path = `${IMAGE_FOLDER}/${name}`;

  try {
    await uploadAsset(path, file);
  } catch (error: unknown) {
    // A typed `unknown` and not an untyped catch, the way `chooseBook` in the
    // route catches: a `fetch` rejects with no response at all on a dropped
    // connection, and there is no status to name.
    view.state.facet(noticeHandler)?.(
      error instanceof Error ? error.message : "The image did not go in",
    );
    return;
  }

  view.dispatch(view.state.replaceSelection(`![](${encodeURI(path)})`));
}

/**
 * The clipboard's image, filed in the vault and referenced in the note.
 *
 * Pasted text is left alone: CodeMirror's own paste is what puts it in, and
 * `clipboardData.files` is empty for it. A screenshot is the case this is for,
 * and every browser hands that over as one `image/png` file.
 *
 * Nothing here awaits: a DOM handler says whether it took the event and cannot
 * wait for a round trip to answer. So the upload is started, the event is taken,
 * and the text arrives when it arrives.
 */
export function imagePaste() {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const image = [...(event.clipboardData?.files ?? [])].find((file) => NAMED.test(file.type));
      if (image === undefined) return false;

      event.preventDefault();
      void fileImage(view, image, filedName(image.type));
      return true;
    },
  });
}
