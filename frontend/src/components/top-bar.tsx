import type { TreeCommands } from "@/lib/key-bindings";
import { useViewport } from "@/lib/use-viewport";

/**
 * The strip across the top: every control runs a command the keys already run.
 * Arrow functions, since `createNote` takes a path and a click would pass it the event.
 */
export function TopBar({
  commands,
  count,
  inert,
}: {
  commands: TreeCommands;
  count: number;
  inert?: boolean;
}) {
  const links: [string, () => void][] = [
    ["Vault", () => commands.toggleTree()],
    ["Graph", () => commands.openGraph()],
    ["Search", () => commands.searchNotes()],
  ];

  // Until the listing arrives the count is 0, which would read as an empty vault.
  const label = count === 0 ? "Search notes" : `Search ${count.toLocaleString("en-GB")} notes`;

  // A phone has no room for the words beside the field, so New note is a plus
  // there. The name stays, so a screen reader hears the same command.
  const { narrow, coarse } = useViewport();
  const phone = narrow && coarse;

  return (
    <header
      data-top-bar
      inert={inert}
      className="k-glass k-hairline sticky top-0 z-20 flex h-14 shrink-0 items-center gap-4 px-4"
    >
      <span className="font-serif text-k-23 text-k-ink">kasten</span>
      {/* Hidden on a phone, where the window has no room for three words beside the field. */}
      <nav aria-label="Main" className="hidden gap-3 md:flex">
        {links.map(([label, run]) => (
          <button
            key={label}
            type="button"
            onClick={run}
            className="font-sans text-k-13 text-k-muted transition-[color,background-color,transform] duration-(--k-hover) hover:text-k-ink"
          >
            {label}
          </button>
        ))}
      </nav>
      {/* Drawn as a button, not an input: the field opens the finder, and typing starts there. */}
      <button
        type="button"
        aria-label={label}
        onClick={() => commands.findNote()}
        className={`min-w-0 max-w-[420px] flex-1 rounded-[var(--k-radius-6)] bg-k-surface px-3 py-1.5 pointer-coarse:min-h-11 text-left font-sans text-k-muted transition-[color,background-color,transform] duration-(--k-hover) hover:text-k-ink ${
          phone ? "text-k-15" : "text-k-13"
        }`}
      >
        {label}
      </button>
      <button
        type="button"
        aria-label={phone ? "New note" : undefined}
        onClick={() => commands.createNote()}
        className={
          phone
            ? "flex size-11 shrink-0 items-center justify-center rounded-[var(--k-radius-6)] bg-k-accent-wash text-k-accent transition-[color,background-color,transform] duration-(--k-hover) hover:text-k-ink"
            : "shrink-0 rounded-[var(--k-radius-6)] bg-k-accent-wash px-3 py-1.5 font-sans text-k-13 text-k-accent pointer-coarse:min-h-11 transition-[color,background-color,transform] duration-(--k-hover) hover:text-k-ink"
        }
      >
        {phone ? (
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="size-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        ) : (
          "New note"
        )}
      </button>
    </header>
  );
}
