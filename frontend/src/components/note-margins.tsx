import type { Outline as OutlineState } from "@/lib/note/note-head";

/**
 * The start inset of a margin's text: the outline row's base padding plus its 2 px
 * rule. Labels and the link rows take it too, so every text in the margin starts
 * on one line.
 */
export const INSET = "pl-[calc(var(--k-space-8)+2px)]";
export const LABEL = `${INSET} text-k-13 text-k-muted`;

/**
 * The note's headings, the current one marked, a click puts the cursor there.
 *
 * Indented by level from the shallowest heading, so a note that starts at
 * `##` does not begin with a gap.
 */
export function Outline({ outline }: { outline?: OutlineState }) {
  if (outline === undefined || outline.headings.length === 0) return null;

  const shallowest = Math.min(...outline.headings.map((heading) => heading.level));

  return (
    <nav aria-label="Outline" className="flex flex-col gap-1">
      <p className={LABEL}>On this page</p>
      {outline.headings.map((heading, index) => {
        const current = index === outline.current;
        return (
          <button
            key={heading.from}
            type="button"
            aria-current={current ? "location" : undefined}
            onClick={() => outline.jump(index)}
            // The base 8 px keeps the text off the 2 px rule at the shallowest level.
            style={{
              paddingLeft: `calc(var(--k-space-8) + ${12 * (heading.level - shallowest)}px)`,
            }}
            // The 2 px rule is there for every row, so the current one
            // turns on its colour and nothing else moves.
            className={`k-margin-row border-l-2 py-1 pr-2 text-left text-k-13 ${
              current ? "border-k-accent text-k-accent" : "border-transparent text-k-muted"
            }`}
          >
            {heading.text}
          </button>
        );
      })}
    </nav>
  );
}
