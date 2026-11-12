import type { EditorView } from "@codemirror/view";
import { fileClips, noticeSource, vaultTakes } from "@/lib/notes/embeds/image";
import { whenKeysUp } from "@/lib/ui/input/last-input";
import { CLIP_SUFFIXES, IMAGE_SUFFIXES } from "@/lib/vault/file-kind";

/**
 * Types as well as suffixes: Android's picker filters by type. Naming no HEIC has iOS hand a
 * photo over as a JPEG. It filters the default view only, so `vaultTakes` checks again.
 */
const PICKABLE = [
  ...IMAGE_SUFFIXES,
  ...CLIP_SUFFIXES,
  ...["gif", "jpeg", "png", "svg+xml", "webp"].map((type) => `image/${type}`),
  ...CLIP_SUFFIXES.map((suffix) => `video/${suffix.slice(1)}`),
].join(",");

/** One input for every editor, and the editor its next pick goes into. */
let picker: HTMLInputElement | undefined;
let pickingInto: EditorView | undefined;

function picked(this: HTMLInputElement) {
  const files = [...(this.files ?? [])];
  const view = pickingInto;
  if (view === undefined) return;
  const notice = view.state.facet(noticeSource)();
  for (const file of files.filter((each) => !vaultTakes(each))) {
    notice?.(`${file.name} is not an image or a video file the vault takes`);
  }
  const taken = files.filter(vaultTakes);
  if (taken.length > 0) void fileClips(view, taken);
}

/**
 * Opens the system's file picker, and files what is picked as a drop does (#1946). No await
 * before the click: the picker needs the press's user activation, which jsdom does not model.
 */
export function pickFiles(view: EditorView): void {
  if (!picker?.isConnected) {
    picker = document.createElement("input");
    picker.type = "file";
    picker.multiple = true;
    picker.accept = PICKABLE;
    picker.hidden = true;
    picker.addEventListener("change", picked);
    document.body.append(picker);
  }
  pickingInto = view;
  // Cleared, or picking the same file again would fire no change.
  picker.value = "";
  const input = picker;
  // After a key, on its keyup, as `<leader>cb` does (#692).
  whenKeysUp(() => input.click());
}
