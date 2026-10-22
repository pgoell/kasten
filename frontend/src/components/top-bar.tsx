import type { TreeCommands } from "@/lib/key-bindings";

/**
 * The strip across the top of the window: the wordmark, the three places a
 * reader goes from anywhere, the note field and New note.
 *
 * Every control runs a command the keys already run, so the bar teaches
 * nothing new. The commands are called inside arrow functions, because
 * `createNote` takes a path and a click would hand it the event.
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
        aria-label={`Search ${count.toLocaleString("en-GB")} notes`}
        onClick={() => commands.findNote()}
        className="min-w-0 max-w-[420px] flex-1 rounded-[var(--k-radius-6)] bg-k-surface px-3 py-1.5 text-left font-sans text-k-13 text-k-muted transition-[color,background-color,transform] duration-(--k-hover) hover:text-k-ink"
      >
        {`Search ${count.toLocaleString("en-GB")} notes`}
      </button>
      <button
        type="button"
        onClick={() => commands.createNote()}
        className="shrink-0 rounded-[var(--k-radius-6)] bg-k-accent-wash px-3 py-1.5 font-sans text-k-13 text-k-accent transition-[color,background-color,transform] duration-(--k-hover) hover:text-k-ink"
      >
        New note
      </button>
    </header>
  );
}
