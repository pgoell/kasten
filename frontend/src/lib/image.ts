/**
 * `![](path)`, the one non-text thing in a note. Pasting, completion and the toggle are here.
 * Drawing is `live-preview-images.ts`; the request is `api.ts`.
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
import { IMAGE_FOLDER } from "@/lib/layout";
import { encodePath } from "@/lib/note-path";

/**
 * One folder for all pasted images, not one beside each note: a moved note would strand its
 * references. Set by `KASTEN_IMAGES_PATH` in `layout.ts`.
 */
export { IMAGE_FOLDER };

/** What a pasted image is called, minus the suffix its type names. */
const NAMED = /^image\//;

/** Every image in the vault. Null, not empty, when unset. */
export const imagePaths = Facet.define<string[], string[] | null>({
  combine: (values) => values[0] ?? null,
});

/** Called with the sentence a failed paste has to be reported with. */
type NoticeHandler = (message: string) => void;

/**
 * Where a refused paste is reported. A facet: the paste handler is registered once for the module.
 */
export const noticeHandler = Facet.define<NoticeHandler, NoticeHandler | undefined>({
  combine: (handlers) => handlers[0],
});

/**
 * The URL an `![](path)` loads, or null for another scheme. Vault paths use the assets route.
 * Paths are already percent-encoded, so they go in as they stand.
 */
export function imageSource(url: string): string | null {
  if (/^https:\/\//i.test(url)) return url;
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
 * The `![](path)` or `[](path)` the cursor sits in. Looks both ways, since a rendered image is a
 * replaced range the cursor never enters.
 */
function linkAt(state: EditorState, pos: number) {
  return enclosing(state, pos, 1) ?? enclosing(state, pos, -1);
}

/**
 * Turns the link under the cursor into an image and back, or starts one: one `!` in or out.
 * With no link, writes `![]()` and opens the completion list at the path.
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
    // Between the parens, where the completion below writes.
    selection: EditorSelection.cursor(cursor + skeleton.length - 1),
  });
  startCompletion(view);
}

/** What has been typed into an open `![](`, which is what a completion completes. */
const TYPED = /!\[[^[\]\n]*\]\([^()\n]*/;

/**
 * Every image, offered in an open `![](`. Labelled by filename, applied as the path. Unranked.
 */
export function imageCompletions(context: CompletionContext): CompletionResult | null {
  const paths = context.state.facet(imagePaths);
  if (paths === null) return null;

  const open = context.matchBefore(TYPED);
  if (!open) return null;

  return {
    // Replaces the path alone: the `](` is already in the document.
    from: open.from + open.text.indexOf("](") + 2,
    options: paths.map((path) => ({
      label: path.slice(path.lastIndexOf("/") + 1),
      // Encoded here, so the note holds a legal destination: a space or `#` would end or split it.
      apply: encodePath(path),
      detail: path.slice(0, path.lastIndexOf("/")),
      type: "text",
    })),
    validFor: /^[^()\n]*$/,
  };
}

/**
 * Today's date, eight hex digits and the type. The clipboard always calls a screenshot `image.png`,
 * so the digits make it unique. The book reader names its figures this way too.
 */
export function filedName(type: string): string {
  const unique = crypto.randomUUID().slice(0, 8);
  return `${readClock(new Date()).date}-${unique}.${type.replace(NAMED, "")}`;
}

/**
 * Uploads a pasted image, then writes the reference, so a refusal leaves the note alone.
 * The insert goes where the cursor is by then, not where it was.
 */
async function fileImage(view: EditorView, file: File, name: string): Promise<void> {
  const path = `${IMAGE_FOLDER}/${name}`;

  try {
    await uploadAsset(path, file);
  } catch (error: unknown) {
    // Typed `unknown`, as `chooseBook` does: a dropped connection has no status to name.
    view.state.facet(noticeHandler)?.(
      error instanceof Error ? error.message : "The image did not go in",
    );
    return;
  }

  view.dispatch(view.state.replaceSelection(`![](${encodePath(path)})`));
}

/**
 * Files a pasted image and references it. Text is left to CodeMirror. The handler must answer
 * at once, so the upload runs after it.
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
