import type { Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { belowFrontmatter } from "@/lib/frontmatter-language";
import { readPosition, writePosition } from "@/lib/positions";

/**
 * Where one mount of a note keeps its cursor and its scroll, and writes them back.
 *
 * One of these per mount: the saved position, the scroll as last seen and the
 * pending write are the state of this view, and a second note is a second one.
 */
export function notePosition(path: string | undefined, named: boolean) {
  // Where this note was left, unless the open names a line: a search hit or
  // a URL says where to read, and the effect further down puts the cursor
  // there. Read and not restored only to be moved, which would scroll twice.
  const saved = path === undefined || named ? undefined : readPosition(path);
  // The scroller's offset as last seen, kept here and not read at the end:
  // React runs the cleanup after the host has left the page, and a detached
  // element reports 0, which would overwrite every note's scroll with the top.
  let top = saved?.top ?? 0;
  // Whether the saved scroll has reached the screen. A pane hidden behind a
  // zoom mounts with no box, where an offset does not take, and gets it
  // when it first shows. Until then its scroller reads 0, which is not
  // where the reader left it, so nothing it reports counts.
  let shown = saved === undefined;
  // What the store holds for this note as far as this editor knows, so a
  // close that moved nothing writes nothing.
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
  // The offset passed in and not `top` read later: setting it scrolls, and a
  // scroll that lands short on guessed line heights would move `top` there.
  function scrollTo(view: EditorView, offset: number) {
    view.scrollDOM.scrollTop = offset;
    // Again once the lines are measured: until then their heights are
    // guesses, and the offset can land short of where it was.
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
  // Trailing and not reset while pending, so a held `j` or a long scroll
  // writes twice a second and not once per line. The close and `pagehide`
  // write what the timer had not got to.
  function soon(view: EditorView) {
    if (path !== undefined && pending === undefined) {
      pending = setTimeout(() => keep(view), 500);
    }
  }

  return {
    selection(doc: Text): { anchor: number; head?: number } {
      // A note edited elsewhere since can end before the saved cursor, and
      // CodeMirror throws on a selection past the end rather than clamping.
      const length = doc.length;
      // With nothing saved, the note opens below its frontmatter. The block
      // is three fields nobody types, and a new note is nothing else, so the
      // top of the document is between the fences and the first keystroke
      // would land in the dates. Read off the text rather than the syntax
      // tree: the state is being built here and has no tree yet.
      return saved
        ? { anchor: Math.min(saved.anchor, length), head: Math.min(saved.head, length) }
        : { anchor: belowFrontmatter(doc.toString()) };
    },
    // Vim's normal-mode cursor is this same selection, so one listener
    // serves vim on and off.
    listener: EditorView.updateListener.of((update) => {
      if (update.selectionSet) soon(update.view);
      // A hidden pane coming into view is a change of size, which
      // CodeMirror measures and reports as geometry.
      if (update.geometryChanged) reveal(update.view);
    }),
    attach(view: EditorView): () => void {
      reveal(view);
      // A pane zoomed out of sight since it showed, or one a narrow window
      // switched away from. A browser keeps no offset across `display: none`,
      // and the pane comes back at the size it left, so CodeMirror sees no
      // change of geometry and `reveal` has done its one job already. Its height
      // going from none to some is the only sign, and `top` is where it was.
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
        // No height is a pane zoomed out of sight since it showed, whose
        // scroller reads 0 wherever the reader left it.
        if (!shown || view.scrollDOM.clientHeight === 0) return;
        // Back on screen before the observer has said so: a browser runs scroll
        // events ahead of resize observers in a frame, and this one reads 0.
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
