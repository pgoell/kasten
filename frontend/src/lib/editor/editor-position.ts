import type { Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { readPosition, writePosition } from "@/lib/editor/positions";
import { belowFrontmatter } from "@/lib/frontmatter-language";

/**
 * Where one mount of a note keeps its cursor and scroll, and writes them back.
 * Each mount has its own state, so a second note is a second one.
 */
export function notePosition(path: string | undefined, named: boolean) {
  // Skipped when the open names a line, since the effect below moves the cursor there.
  const saved = path === undefined || named ? undefined : readPosition(path);
  // Kept, not read at cleanup: a detached element reads 0 and would overwrite the scroll.
  let top = saved?.top ?? 0;
  // Whether the saved scroll has landed. A hidden pane reads 0 until it shows.
  let shown = saved === undefined;
  // What the store holds, so closing a note that did not move writes nothing.
  let written = saved;
  let pending: ReturnType<typeof setTimeout> | undefined;
  function keep(view: EditorView) {
    clearTimeout(pending);
    pending = undefined;
    if (path === undefined) return;
    const { anchor, head } = view.state.selection.main;
    if (written?.anchor === anchor && written.head === head && written.top === top) return;
    written = { anchor, head, top };
    writePosition(path, written);
  }
  function scrollTo(view: EditorView, offset: number) {
    view.scrollDOM.scrollTop = offset;
    // Set again once lines are measured, since guessed heights can land it short.
    view.requestMeasure({
      read: () => {},
      write: () => {
        view.scrollDOM.scrollTop = offset;
      },
    });
  }
  function reveal(view: EditorView) {
    if (shown || saved === undefined || view.scrollDOM.clientHeight === 0) return;
    shown = true;
    scrollTo(view, saved.top);
  }
  // Trailing, not reset while pending, so a held `j` writes twice a second, not per line.
  function soon(view: EditorView) {
    if (path !== undefined && pending === undefined) {
      pending = setTimeout(() => keep(view), 500);
    }
  }

  return {
    selection(doc: Text): { anchor: number; head?: number } {
      // The note may have shrunk since the cursor was saved, and CodeMirror throws past the end.
      const length = doc.length;
      // With nothing saved, open below the frontmatter, or the first keystroke lands in the dates.
      return saved
        ? { anchor: Math.min(saved.anchor, length), head: Math.min(saved.head, length) }
        : { anchor: belowFrontmatter(doc.toString()) };
    },
    // Vim's normal-mode cursor is this same selection.
    listener: EditorView.updateListener.of((update) => {
      if (update.selectionSet) soon(update.view);
      // A hidden pane showing is a size change, reported as geometry.
      if (update.geometryChanged) reveal(update.view);
    }),
    attach(view: EditorView): () => void {
      reveal(view);
      // A pane hidden by a zoom keeps no offset, and CodeMirror sees no geometry change,
      // so its height returning from none is the only sign.
      let away = false;
      const resize = new ResizeObserver(() => {
        if (view.scrollDOM.clientHeight === 0) away = shown;
        else if (away) {
          away = false;
          scrollTo(view, top);
        }
      });
      resize.observe(view.scrollDOM);
      function onScroll() {
        if (!shown || view.scrollDOM.clientHeight === 0) return;
        // Scroll events can fire a frame before the resize observer, reading 0.
        if (away) return;
        top = view.scrollDOM.scrollTop;
        soon(view);
      }
      view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });
      // A closed tab or a reload never runs the cleanup below.
      const hide = () => keep(view);
      window.addEventListener("pagehide", hide);

      return () => {
        resize.disconnect();
        view.scrollDOM.removeEventListener("scroll", onScroll);
        window.removeEventListener("pagehide", hide);
        keep(view);
      };
    },
  };
}
