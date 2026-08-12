import { useEffect, useRef, useState } from "react";
import { type EditorCommands, LEADER } from "@/lib/key-bindings";

interface ImagePaneProps {
  /** Vault-relative path of the image to show. */
  path: string;
  /** What a leader sequence reaches. The same object every other pane is given. */
  commands: EditorCommands;
  /** Raised when the pane this sits in has been moved to. See `Editor`. */
  focusSignal?: number;
}

const LABEL = "shrink-0 text-[11px] tracking-wide text-one-muted uppercase";

/**
 * One image out of the vault, shown whole.
 *
 * The simplest pane there is: an `<img>` fitted to the box, and the path above
 * it. No editing, no zoom and no next image, because the tree is what walks the
 * folder and the browser is what a picture worth studying belongs in.
 *
 * Its own pane rather than a preview under the tree. A pane already has a size
 * worth looking at a screenshot in, and it costs nothing: `panesOf`, the splits
 * and every key that moves between panes work on this the moment the layout
 * carries an `image`.
 */
export function ImagePane({ path, commands, focusSignal }: ImagePaneProps) {
  const panel = useRef<HTMLElement>(null);
  /** The keys of an unfinished leader sequence, starting with the space. */
  const [pending, setPending] = useState("");
  /**
   * The path whose picture would not load, rather than a flag saying one did not.
   *
   * The pane is not remounted when another row of the tree is clicked, so a flag
   * would carry the last failure onto the next image and draw "No image at" over
   * a picture that is there. Holding the path answers the question the drawing
   * actually asks, and no effect has to reset anything.
   */
  const [failed, setFailed] = useState<string>();

  // A freshly focused pane is handed a raised signal and takes the cursor, the
  // way the exam pane and the todo pane do. It has to: the pane holds no
  // CodeMirror, so without this the keys would keep going to whichever pane the
  // browser last left the cursor in, which is a note this image is not in.
  useEffect(() => {
    if (focusSignal) panel.current?.focus();
  }, [focusSignal]);

  // The leader block the exam pane, the todo pane and the file tree each carry
  // their own copy of. Nothing else is bound here: there is nothing in an image
  // to move around, so `q` is spelled `<leader>q` like every other pane's close.
  function onKeyDown(event: React.KeyboardEvent) {
    const { key } = event;

    if (pending) {
      const sequence = pending + key;
      const wanted = sequence.slice(1);
      const binding = LEADER.find((entry) => entry.key === wanted);
      const partial = !binding && LEADER.some((entry) => entry.key.startsWith(wanted));
      setPending(partial ? sequence : "");

      if (binding) {
        event.preventDefault();
        commands[binding.command]();
      }
      return;
    }

    if (event.ctrlKey || event.altKey || event.metaKey) return;

    if (key === " ") {
      setPending(key);
      event.preventDefault();
    }
  }

  return (
    <section
      ref={panel}
      data-image-pane
      // Focusable but out of the tab order, the way every other pane holds the
      // cursor.
      tabIndex={-1}
      onKeyDown={onKeyDown}
      aria-label="image"
      className="flex h-full flex-col bg-one-bg font-mono outline-none"
    >
      <header className="flex items-center gap-3 border-b border-one-line px-3 py-1">
        <span className={LABEL}>image</span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-one-fg" title={path}>
          {path}
        </span>
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
        {failed === path ? (
          <p role="alert" className="text-[13px] text-one-muted">
            No image at <span className="text-one-fg">{path}</span>
          </p>
        ) : (
          <img
            // Percent-encoded on the way out, the paths in the vault carrying
            // spaces and the listing handing them over raw. `encodeURI` and not
            // `encodeURIComponent`, which would spell the slashes `%2F` too.
            src={`/api/assets/${encodeURI(path)}`}
            // The filename, which is the most an alt can honestly say about an
            // image nothing in the vault has described.
            alt={path.slice(path.lastIndexOf("/") + 1)}
            onError={() => setFailed(path)}
            className="max-h-full max-w-full object-contain"
          />
        )}
      </div>
    </section>
  );
}
