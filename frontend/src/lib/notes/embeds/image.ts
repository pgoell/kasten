/**
 * `![](path)`, the one non-text thing in a note. Pasting, completion and the toggle are here,
 * the paste and drop of a video file and the drop of an image file. Drawing is `live-preview-images.ts`; the request is `api.ts`.
 */

import {
  type CompletionContext,
  type CompletionResult,
  startCompletion,
} from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { EditorSelection, type EditorState, Facet } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { NoteMissing, updateNote, uploadAsset } from "@/lib/core/api";
import { readClock } from "@/lib/core/clock";
import { IMAGE_FOLDER } from "@/lib/core/layout";
import { tracked } from "@/lib/notes/embeds/uploads";
import { encodePath } from "@/lib/notes/links/note-path";
import { vaultPaths } from "@/lib/notes/links/wikilink";
import { saveQueue } from "@/lib/notes/note/save-queue";
import { CLIP_SUFFIXES, IMAGE_SUFFIXES, isClipFile } from "@/lib/vault/file-kind";

/**
 * One folder for all pasted images, not one beside each note: a moved note would strand its
 * references. Set by `KASTEN_IMAGES_PATH` in `layout.ts`.
 */
export { IMAGE_FOLDER };

/** What a pasted image is called, minus the suffix its type names. */
const NAMED = /^image\//;

/**
 * The handler itself, read when a paste starts: an upload's notice comes after its editor may have
 * left, which empties the callbacks `noticeHandler` reads (#1945).
 */
export const noticeSource = Facet.define<
  () => NoticeHandler | undefined,
  () => NoticeHandler | undefined
>({
  combine: (getters) => getters[0] ?? (() => undefined),
});

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
  // `image/svg+xml` names its suffix `.svg`, the one the vault takes.
  const suffix = type.replace(/^\w+\//, "").replace(/\+xml$/, "");
  return `${readClock(new Date()).date}-${unique}.${suffix}`;
}

/** Uploads `file` with its progress on the status bar, and reports a refusal; answers whether it went in. */
async function upload(
  notice: NoticeHandler | undefined,
  path: string,
  file: File,
  failed: string,
): Promise<boolean> {
  try {
    await tracked(path.slice(path.lastIndexOf("/") + 1), file.size, (progress) =>
      uploadAsset(path, file, progress),
    );
    return true;
  } catch (error: unknown) {
    // Typed `unknown`, as `chooseBook` does: a dropped connection has no status to name.
    notice?.(error instanceof Error ? error.message : failed);
    return false;
  }
}

/**
 * Uploads a pasted image, then writes the reference, so a refusal leaves the note alone.
 * The insert goes where the cursor is by then, not where it was.
 */
async function fileImage(view: EditorView, file: File, name: string): Promise<void> {
  const path = `${IMAGE_FOLDER}/${name}`;
  const notice = view.state.facet(noticeSource)();
  if (await upload(notice, path, file, "The image did not go in")) {
    await place(view, notice, `![](${encodePath(path)})`, false);
  }
}

/** The editors open now and the note each holds, and the note each closed one held. */
const live = new Map<EditorView, string | undefined>();
const closed = new WeakMap<EditorView, string | undefined>();
const liveness = (path: string | undefined) =>
  ViewPlugin.define((view) => {
    live.set(view, path);
    return {
      destroy() {
        live.delete(view);
        closed.set(view, path);
      },
    };
  });

/** `text` with `line` on a line of its own after it. */
function appended(text: string, line: string): string {
  return `${text}${text === "" || text.endsWith("\n") ? "" : "\n"}${line}\n`;
}

/**
 * Writes `reference` where the cursor is, or, once the note's editor closed (#1945), at the end
 * of the note: in an editor open on it now, else in its file by a conditional write behind
 * the note's own writes, so text written meanwhile stays.
 */
async function place(
  view: EditorView,
  notice: NoticeHandler | undefined,
  reference: string,
  newline: boolean,
): Promise<void> {
  if (!closed.has(view)) {
    view.dispatch(view.state.replaceSelection(`${newline ? "\n" : ""}${reference}`));
    return;
  }
  const path = closed.get(view);
  const kept = `The file is in ${IMAGE_FOLDER}, but`;
  if (path === undefined) {
    notice?.(`${kept} the note it was pasted into had closed`);
    return;
  }
  const other = [...live].find(([, each]) => each === path)?.[0];
  if (other !== undefined) {
    const doc = other.state.doc.toString();
    other.dispatch({
      changes: { from: doc.length, insert: appended(doc, reference).slice(doc.length) },
    });
    return;
  }
  try {
    await saveQueue.settled(path);
    await updateNote(path, (text) => appended(text, reference));
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    notice?.(error instanceof NoteMissing ? `${kept} ${path} is gone` : `${kept} ${error.message}`);
  }
}

/**
 * Files a pasted image, a pasted or dropped video file or a dropped image file, and references it. Text is left to
 * CodeMirror; the handler must answer at once, so the upload runs after it.
 */
export function imagePaste(path: string | undefined) {
  return [
    liveness(path),
    EditorView.domEventHandlers({
      paste(event, view) {
        const clips = [...(event.clipboardData?.files ?? [])].filter(isClipFile);
        if (clips.length > 0) {
          event.preventDefault();
          void fileClips(view, clips);
          return true;
        }
        const image = [...(event.clipboardData?.files ?? [])].find((file) => NAMED.test(file.type));
        if (image === undefined) return false;

        event.preventDefault();
        void fileImage(view, image, filedName(image.type));
        return true;
      },
      // Ahead of CodeMirror's own drop, which reads a file as text and drops a binary one.
      drop(event, view) {
        const files = [...(event.dataTransfer?.files ?? [])].filter(
          (file) =>
            isClipFile(file) || NAMED.test(file.type) || keepsName(file.name, IMAGE_SUFFIXES),
        );
        if (files.length === 0) return false;
        event.preventDefault();
        const at = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (at !== null) view.dispatch({ selection: { anchor: at } });
        view.focus();
        void fileClips(view, files);
        return true;
      },
    }),
  ];
}

/** What a wikilink cannot carry in a name, as Obsidian refuses them in one (#1922). */
const UNLINKABLE = /[[\]|#^]/g;

/** Whether a name ends in one of the suffixes, any case, after a stem that is not blank. */
function keepsName(name: string, suffixes: string[]): boolean {
  const dot = name.lastIndexOf(".");
  return (
    dot > 0 && suffixes.includes(name.slice(dot).toLowerCase()) && name.slice(0, dot).trim() !== ""
  );
}

/**
 * The file's own name, with ` 1`, ` 2` before the suffix while any folder holds it in any case:
 * the vault overwrites nothing, and `![[name]]` must name this file and no other.
 */
function clipName(file: File, taken: string[]): string {
  const own = file.name.replace(UNLINKABLE, "-");
  const kept = keepsName(own, [...CLIP_SUFFIXES, ...IMAGE_SUFFIXES]);
  const name = kept ? own : filedName(file.type);
  const used = new Set(taken.map((path) => path.slice(path.lastIndexOf("/") + 1).toLowerCase()));
  const stem = name.slice(0, name.lastIndexOf("."));
  const suffix = name.slice(name.lastIndexOf("."));
  let free = name;
  for (let n = 1; used.has(free.toLowerCase()); n++) free = `${stem} ${n}${suffix}`;
  return free;
}

/**
 * Uploads each file in turn, then writes its reference where the cursor is by then, one to a
 * line: `![[name]]` for a video, `![](path)` for an image as a paste writes it. A refusal is
 * reported and leaves the note alone; the next file still goes.
 */
async function fileClips(view: EditorView, files: File[]): Promise<void> {
  const taken = [...(view.state.facet(vaultPaths) ?? []), ...(view.state.facet(imagePaths) ?? [])];
  const notice = view.state.facet(noticeSource)();
  let written = 0;
  for (const file of files) {
    const name = clipName(file, taken);
    taken.push(name);
    const path = `${IMAGE_FOLDER}/${name}`;
    if (!(await upload(notice, path, file, "The file did not go in"))) continue;
    const reference = isClipFile(file) ? `![[${name}]]` : `![](${encodePath(path)})`;
    await place(view, notice, reference, written > 0);
    written++;
  }
}
