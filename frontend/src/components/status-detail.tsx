import type { DiffLine } from "@/lib/diff";

/**
 * The changed lines of a diff and one line either side, each other run of
 * unchanged lines folded into one that says how many.
 *
 * A whole note under the bar would be the note again, and the two lines that
 * differ would be as hard to find in it as they were in the editor. A run of
 * one is shown rather than folded: the fold would take as much room.
 */
function folded(diff: readonly DiffLine[]): (DiffLine | { skip: number })[] {
  const changed = (at: number) => (diff[at]?.op ?? " ") !== " ";
  const near = (at: number) => changed(at - 1) || changed(at) || changed(at + 1);
  const rows: (DiffLine | { skip: number })[] = [];
  let skipped: DiffLine[] = [];
  const flush = () => {
    if (skipped.length === 1) rows.push(...skipped);
    else if (skipped.length > 1) rows.push({ skip: skipped.length });
    skipped = [];
  };
  diff.forEach((line, at) => {
    if (near(at)) {
      flush();
      rows.push(line);
    } else skipped.push(line);
  });
  flush();
  return rows;
}

interface StatusDetailProps {
  detail: string;
  diff: readonly DiffLine[] | undefined;
  actions: { action: string; label: string; call(): void }[];
  onClose(): void;
}

/**
 * The panel opened out above the bar, with the sentence, the diff and the ways out.
 */
export function StatusDetail({ detail, diff, actions, onClose }: StatusDetailProps) {
  return (
    // Over the page and not inside the bar, whose height is fixed. Out of
    // the tab order like the two that open it: a keyboard has the `title`.
    <div className="absolute inset-x-0 bottom-full z-10 border-t border-k-rule bg-k-paper text-[11px]">
      {/* Only the words scroll, and the buttons sit under them: a long
          diff on a phone would otherwise push the way out off the top. */}
      <div className="max-h-[50dvh] overflow-y-auto">
        <button
          type="button"
          tabIndex={-1}
          data-testid="status-detail"
          onClick={onClose}
          className="block w-full px-3 py-2 text-left whitespace-pre-line text-k-danger"
        >
          {detail}
        </button>
        {diff && (
          // Beside the sentence and not inside its button, so a tap to
          // read a line does not shut the panel.
          <div
            data-testid="conflict-diff"
            className="border-t border-k-rule px-3 py-2 font-mono whitespace-pre-wrap"
          >
            {folded(diff).map((row, at) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: lines repeat, and the list is redrawn whole.
                key={at}
                className={
                  "skip" in row || row.op === " "
                    ? "text-k-muted"
                    : row.op === "-"
                      ? "text-k-danger"
                      : "text-k-ok"
                }
              >
                {"skip" in row ? `⋯ ${row.skip} lines` : `${row.op} ${row.text}`}
              </div>
            ))}
          </div>
        )}
      </div>
      {actions.length > 0 && (
        <div className="flex gap-px border-t border-k-rule">
          {actions.map(({ action, label, call }) => (
            <button
              key={action}
              type="button"
              tabIndex={-1}
              onClick={() => {
                onClose();
                call();
              }}
              className="min-h-6 flex-1 px-3 text-k-muted active:bg-k-surface active:text-k-accent pointer-coarse:min-h-11"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
