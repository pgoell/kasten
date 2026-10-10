import { useEffect, useRef, useState } from "react";
import { type EditorCommands, heldModifier, leaderAction, leaderPrefix } from "@/lib/key-bindings";

interface ImagePaneProps {
  /** Vault-relative path of the image to show. */
  path: string;
  /** What a leader sequence reaches. The same object every other pane is given. */
  commands: EditorCommands;
  /** Raised when the pane this sits in has been moved to. See `Editor`. */
  focusSignal?: number;
  /**
   * Move this image into the trash, which empties the pane.
   *
   * A callback and not a member of `commands`: every leader command takes
   * nothing, and the image this deletes is the one the pane is holding. The
   * tree's own `d` reaches the same delete through `TreeCommands`.
   */
  onDelete: () => void;
}

const LABEL = "shrink-0 text-[11px] tracking-wide text-one-muted uppercase";

interface Point {
  x: number;
  y: number;
}

/** How far the picture is from fitted: a scale, and an offset in pixels. */
export interface Zoom {
  scale: number;
  x: number;
  y: number;
}

/** The picture fitted to the box, which is how every image starts. */
const FITTED: Zoom = { scale: 1, x: 0, y: 0 };

/** Never below fitted, there being nothing around a picture to see more of. */
const MAX_SCALE = 8;

/**
 * Where one move of the pointers on the picture leaves it.
 *
 * `before` and `after` are the same pointers either side of the move, and
 * `centre` is the middle of the box, which is where the fitted picture's own
 * middle sits and so what its transform is measured from. One pointer drags a
 * picture that has been zoomed into. Two pinch it: the scale follows the
 * distance between them and the point under their midpoint stays under it,
 * which makes a pinch that moves a pan as well.
 */
export function gesture(zoom: Zoom, before: Point[], after: Point[], centre: Point): Zoom {
  const [wasA, wasB] = before;
  const [isA, isB] = after;
  // No pointer down is no move at all.
  if (!wasA || !isA) return zoom;

  if (!wasB || !isB) {
    // A fitted picture has nowhere to go, and dragging it would only lose it.
    if (zoom.scale === 1) return zoom;
    return { scale: zoom.scale, x: zoom.x + isA.x - wasA.x, y: zoom.y + isA.y - wasA.y };
  }

  const spread = Math.hypot(wasA.x - wasB.x, wasA.y - wasB.y);
  // Two pointers on one spot give no ratio to scale by.
  if (spread === 0) return zoom;

  const stretched = Math.hypot(isA.x - isB.x, isA.y - isB.y);
  const scale = Math.min(MAX_SCALE, Math.max(1, (zoom.scale * stretched) / spread));
  // Back at fitted the picture goes back to the middle, wherever the fingers
  // were: an offset kept here is one no drag could undo.
  if (scale === 1) return FITTED;

  const ratio = scale / zoom.scale;
  const from = { x: (wasA.x + wasB.x) / 2 - centre.x, y: (wasA.y + wasB.y) / 2 - centre.y };
  const to = { x: (isA.x + isB.x) / 2 - centre.x, y: (isA.y + isB.y) / 2 - centre.y };
  return {
    scale,
    x: to.x + (zoom.x - from.x) * ratio,
    y: to.y + (zoom.y - from.y) * ratio,
  };
}

/**
 * One image out of the vault, shown whole.
 *
 * The simplest pane there is: an `<img>` fitted to the box, and the path above
 * it. No editing and no next image, because the tree is what walks the folder.
 * A pinch zooms and a drag moves the zoomed picture, a phone having no other
 * way to read a screenshot's small print; no key does either.
 *
 * Its own pane rather than a preview under the tree. A pane already has a size
 * worth looking at a screenshot in, and it costs nothing: `panesOf`, the splits
 * and every key that moves between panes work on this the moment the layout
 * carries an `image`.
 */
export function ImagePane({ path, commands, focusSignal, onDelete }: ImagePaneProps) {
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
  /**
   * The zoom, and the path it was made on, for the reason `failed` is a path:
   * a zoom left on the last picture is not one the next picture was given.
   */
  const [zoomed, setZoomed] = useState({ path, zoom: FITTED });
  const zoom = zoomed.path === path ? zoomed.zoom : FITTED;
  /** Where each pointer that is down was last seen. A ref: nothing draws it. */
  const pointers = useRef(new Map<number, Point>());

  // A freshly focused pane is handed a raised signal and takes the cursor, the
  // way the exam pane and the todo pane do. It has to: the pane holds no
  // CodeMirror, so without this the keys would keep going to whichever pane the
  // browser last left the cursor in, which is a note this image is not in.
  useEffect(() => {
    if (focusSignal) panel.current?.focus();
  }, [focusSignal]);

  // The leader block the exam pane, the todo pane and the file tree each carry
  // their own copy of. `d` is the one bare key, said the way the tree says it,
  // and nothing else is bound: there is nothing in an image to move around, so
  // `q` is spelled `<leader>q` like every other pane's close.
  function onKeyDown(event: React.KeyboardEvent) {
    const { key } = event;

    // A modifier holds itself down before the key it is held for arrives, and
    // a pending sequence that read it as a key would drop the sequence there.
    if (heldModifier(key)) return;

    if (pending) {
      const sequence = pending + key;
      const wanted = sequence.slice(1);
      const run = leaderAction(wanted, commands);
      // A leader key can be more than one letter, so a sequence that still
      // prefixes one waits for the rest instead of being dropped.
      setPending(!run && leaderPrefix(wanted) ? sequence : "");

      if (run) {
        event.preventDefault();
        run();
      }
      return;
    }

    if (event.ctrlKey || event.altKey || event.metaKey) return;

    if (key === " ") {
      setPending(key);
      event.preventDefault();
      return;
    }

    // The tree's own delete key, on the image in front of you. Nothing asks
    // first, for the reason nothing asks in the tree: the picture waits in the
    // trash and `<leader>du` puts it back, so a mistyped key costs a keypress.
    if (key === "d") {
      onDelete();
      event.preventDefault();
    }
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    // Captured so a drag that leaves the box still ends here, and the pointer
    // is not left in the map as a finger that never lifted.
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const held = pointers.current;
    // A mouse moves with no button down, and that is not a drag.
    if (!held.has(event.pointerId)) return;

    const before = [...held.values()];
    held.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const after = [...held.values()];
    const box = event.currentTarget.getBoundingClientRect();
    const centre = { x: box.left + box.width / 2, y: box.top + box.height / 2 };

    setZoomed((last) => ({
      path,
      zoom: gesture(last.path === path ? last.zoom : FITTED, before, after, centre),
    }));
  }

  function onPointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
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

      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        // `touch-none`, or the browser takes the fingers for a scroll and a page
        // zoom and cancels the pointers. Hidden and not scrolling: a transform
        // counts as overflow, and a zoomed picture would grow scrollbars.
        className="flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden p-4"
      >
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
            // A mouse drag would otherwise pick the picture up as a file.
            draggable={false}
            style={{
              transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`,
            }}
            className="max-h-full max-w-full object-contain"
          />
        )}
      </div>
    </section>
  );
}
