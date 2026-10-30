import { useEffect, useState } from "react";
import { useViewport } from "@/lib/use-viewport";

const ICON_BUTTON =
  "cursor-pointer rounded-sm p-1 text-k-muted hover:bg-k-surface hover:text-k-accent pointer-coarse:p-3.5";

/** Panel widths, in pixels. The default is the `w-64` the panel used to be. */
const DEFAULT_WIDTH = 256;
const MIN_WIDTH = 160;
const MAX_WIDTH = 480;
/** How far one arrow key press moves the grip. */
const KEY_STEP = 16;

function clampWidth(width: number) {
  return Math.min(Math.max(width, MIN_WIDTH), MAX_WIDTH);
}

interface GripProps {
  width: number;
  dragging: boolean;
  onResizeStart: (clientX: number) => void;
  onResizeBy: (delta: number) => void;
  onReset: () => void;
}

/**
 * The drag handle on the panel's right edge.
 *
 * It straddles the border rather than taking layout space of its own, so the
 * tree keeps the full width the panel reports.
 */
function Grip({ width, dragging, onResizeStart, onResizeBy, onReset }: GripProps) {
  function onKeyDown(event: React.KeyboardEvent) {
    const delta = event.key === "ArrowRight" ? KEY_STEP : event.key === "ArrowLeft" ? -KEY_STEP : 0;
    if (!delta) return;
    event.preventDefault();
    onResizeBy(delta);
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: <hr> is a thematic break in prose, not a handle you can grab.
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize file tree"
      aria-valuenow={width}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      tabIndex={0}
      onPointerDown={(event) => onResizeStart(event.clientX)}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      className={`absolute inset-y-0 -right-0.5 z-10 w-1 cursor-col-resize touch-none focus-visible:outline-none ${
        dragging ? "bg-k-accent" : "hover:bg-k-accent focus-visible:bg-k-accent"
      }`}
    />
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="currentColor">
      <path d="M7.25 3h1.5v4.25H13v1.5H8.75V13h-1.5V8.75H3v-1.5h4.25V3z" />
    </svg>
  );
}

function PanelIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="currentColor">
      <path d="M2 3a1 1 0 011-1h10a1 1 0 011 1v10a1 1 0 01-1 1H3a1 1 0 01-1-1V3zm1 0v10h3V3H3zm4 0v10h6V3H7z" />
    </svg>
  );
}

interface TreePanelProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  onNewNote(): void;
  /** The tree itself, drawn where the panel's body is. */
  children: React.ReactNode;
}

/**
 * The panel the file tree sits in. Below `md` it is a drawer over the page, since a 256px panel
 * would leave a phone 134px of note. The rail stays in the row, so the page does not move when it opens.
 */
export function TreePanel({ open, onOpenChange, onNewNote, children }: TreePanelProps) {
  const { narrow, coarse } = useViewport();
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  /** Where the pointer went down, and how wide the panel was then. */
  const [drag, setDrag] = useState<{ x: number; width: number } | null>(null);

  // The pointer leaves the thin grip the moment the drag speeds up, so the rest
  // of the gesture is followed on the window instead.
  useEffect(() => {
    if (!drag) return;
    const origin = drag;

    function onMove(event: PointerEvent) {
      setWidth(clampWidth(origin.width + event.clientX - origin.x));
    }
    function onUp() {
      setDrag(null);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    // Without this the drag selects text and flickers the I-beam over the editor.
    const { cursor, userSelect } = document.body.style;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = cursor;
      document.body.style.userSelect = userSelect;
    };
  }, [drag]);

  const toggle = (
    <button
      type="button"
      onClick={() => onOpenChange(!open)}
      aria-label={open ? "Hide file tree" : "Show file tree"}
      title={`${open ? "Hide" : "Show"} file tree (Space B)`}
      className={ICON_BUTTON}
    >
      <PanelIcon />
    </button>
  );

  // Narrow and a finger, which is when the route draws its toolbar. A narrow
  // window under a mouse has no toolbar and keeps the rail to click on.
  const rail =
    narrow && coarse ? null : (
      // Inert under an open drawer, where its button would be a second "Hide
      // file tree" that Tab reaches behind the backdrop.
      <div
        inert={open}
        className="flex shrink-0 flex-col items-center border-r border-k-rule bg-k-paper p-1 pointer-coarse:p-0"
      >
        {toggle}
      </div>
    );

  if (!open) return rail;

  const panel = (
    <aside
      // No dragged width in a drawer: it has no grip to have set one, and a
      // width carried over from a wide window could cover the whole phone.
      style={narrow ? undefined : { width }}
      // z-15 puts the drawer over what a pane draws at z-10 and under the
      // prompts at z-20, so a prompt opened from the tree is not behind it.
      className={`flex flex-col border-r border-k-rule bg-k-paper font-mono ${
        // A drawer is `fixed` over the frame and gets none of its padding, so
        // it keeps its rows out from under the notch and the home indicator
        // itself (#355). It never reaches the right edge.
        narrow
          ? "safe-foot fixed inset-y-0 left-0 z-15 w-72 max-w-[85vw] pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)]"
          : "relative shrink-0"
      }`}
    >
      <header className="flex items-center justify-between border-b border-k-rule py-1 pr-1 pl-3 pointer-coarse:py-0 pointer-coarse:pr-0">
        <span className="text-[11px] tracking-wider text-k-muted uppercase">Vault</span>
        <div className="flex items-center">
          <button
            type="button"
            onClick={onNewNote}
            aria-label="New note"
            title="New note (Space C F)"
            className={ICON_BUTTON}
          >
            <PlusIcon />
          </button>
          {toggle}
        </div>
      </header>

      {children}

      {!narrow && (
        <Grip
          width={width}
          dragging={drag !== null}
          onResizeStart={(x) => setDrag({ x, width })}
          onResizeBy={(delta) => setWidth(clampWidth(width + delta))}
          onReset={() => setWidth(DEFAULT_WIDTH)}
        />
      )}
    </aside>
  );

  if (!narrow) return panel;

  return (
    <>
      {rail}
      {/* A button rather than a div with a click handler, so the way out has a
          name and a key. */}
      <button
        type="button"
        aria-label="Close file tree"
        onClick={() => onOpenChange(false)}
        className="fixed inset-0 z-15 bg-black/50"
      />
      {panel}
    </>
  );
}
