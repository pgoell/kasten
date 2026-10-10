import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { previewMove } from "@/lib/api";
import { type MoveMode, moveAndCache } from "@/lib/move";
import {
  BACKDROP,
  HEADER_ROW,
  LABEL,
  PANEL,
  PANEL_NARROW,
  STATUS,
  TAP,
} from "@/lib/overlay-styles";

interface MoveConfirmProps {
  mode: MoveMode;
  /** Where the note or folder is now. */
  startPath: string;
  /** Where the drop puts it. */
  target: string;
  /** Called with the path it landed on, once the vault has moved it. */
  onMoved: (path: string) => void;
  onClose: () => void;
}

/** What the status line says while it has nothing better. */
function summary(rewrites: string[] | undefined, failed: boolean): string {
  if (failed) return "could not move it, Esc closes";
  if (rewrites === undefined) return "counting links…";
  const files = `${rewrites.length} file${rewrites.length === 1 ? "" : "s"}`;
  return rewrites.length === 0
    ? "no links to update, Enter moves"
    : `updates links in ${files}, Enter moves`;
}

/**
 * Asks before a drop in the tree moves anything, and says how far it reaches.
 *
 * A drag is easy to make by accident and a move rewrites notes you are not
 * looking at, so the files it would rewrite are listed first, the way the
 * vault counts them. Enter moves, Escape or a click outside does not.
 */
export function MoveConfirm({ mode, startPath, target, onMoved, onClose }: MoveConfirmProps) {
  const queryClient = useQueryClient();
  const dialog = useRef<HTMLDivElement>(null);
  /** Set while the move is in flight, so a held Enter sends the one request. */
  const sending = useRef(false);
  const [failed, setFailed] = useState(false);
  // No cache worth keeping: the answer is stale the moment any note changes,
  // and the dialog asks once per drop.
  const preview = useQuery({
    queryKey: ["move-preview", startPath, target],
    queryFn: () => previewMove(startPath, target),
    gcTime: 0,
  });

  // The focus comes here so Enter and Escape reach the dialog, and goes back
  // to the tree row the drag started from on the way out.
  useEffect(() => {
    const opener = document.activeElement;
    dialog.current?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  // A preview the vault refused is a move it would refuse too.
  const blocked = failed || preview.isError;

  function accept() {
    if (sending.current || blocked) return;
    sending.current = true;
    void moveAndCache(queryClient, mode, startPath, target).then(
      (landed) => {
        queryClient.invalidateQueries({ queryKey: ["files"] });
        onMoved(landed);
      },
      () => {
        sending.current = false;
        setFailed(true);
      },
    );
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter") accept();
    else if (event.key === "Escape") onClose();
    else return;
    event.preventDefault();
  }

  return (
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-label={mode === "folder" ? "Move folder" : "Move note"}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className={BACKDROP}
    >
      <div className={`${PANEL} ${PANEL_NARROW}`}>
        <div className={HEADER_ROW}>
          <span className={LABEL}>{mode === "folder" ? "move folder" : "move note"}</span>
          <span className="min-w-0 flex-1 truncate text-[13px] text-one-fg" title={target}>
            {startPath} → {target}
          </span>
        </div>

        {preview.data !== undefined && preview.data.length > 0 && (
          <ul aria-label="Files to update" className="overflow-auto py-1">
            {preview.data.map((path) => (
              <li key={path} className="truncate px-3 py-[3px] text-[13px] text-one-muted">
                {path}
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-2 border-t border-one-line px-3 py-2">
          <output className={`${STATUS} flex-1 border-none p-0`}>
            {summary(preview.data, blocked)}
          </output>
          <button
            type="button"
            onClick={onClose}
            className={`${TAP} cursor-pointer rounded-sm px-2 py-1 text-[12px] text-one-muted hover:bg-one-hover pointer-coarse:px-4`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={accept}
            disabled={blocked}
            className={`${TAP} cursor-pointer rounded-sm px-2 py-1 text-[12px] text-one-accent hover:bg-one-hover disabled:cursor-default disabled:opacity-50 pointer-coarse:px-4`}
          >
            Move
          </button>
        </div>
      </div>
    </div>
  );
}
