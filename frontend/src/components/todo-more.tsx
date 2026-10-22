import type { ReactNode } from "react";

/**
 * A row's touch controls: whatever leads the row, then the `⋯` that opens a
 * strip of every action the row has. One strip at a time, and the caller says
 * which is open.
 */
export function TodoMore({
  name,
  opened,
  onToggle,
  onClose,
  actions,
  children,
}: {
  name: string;
  opened: boolean;
  onToggle: () => void;
  onClose: () => void;
  actions: [string, () => void][];
  children: ReactNode;
}) {
  return (
    <div>
      <div className="flex">
        {children}
        <button
          type="button"
          tabIndex={-1}
          onClick={onToggle}
          aria-label={`more for ${name}`}
          aria-expanded={opened}
          className="min-h-11 min-w-11 shrink-0 text-k-muted"
        >
          ⋯
        </button>
      </div>
      {/* Wrapping, because eight words do not fit one line of a
        phone. Each named with its todo, so `done` here and
        `done` above the list are two different buttons to a
        screen reader. */}
      {opened && (
        <div className="flex flex-wrap px-1 text-[11px] text-k-muted">
          {actions.map(([label, run]) => (
            <button
              key={label}
              type="button"
              tabIndex={-1}
              onClick={() => {
                onClose();
                run();
              }}
              aria-label={`${label} ${name}`}
              className="min-h-11 px-3"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
