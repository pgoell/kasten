/**
 * A whole `[[target]]`, with an optional `#heading` and `|alias` after the target.
 * Written here rather than imported from the shared link helpers, which would pull the
 * editor's packages into this phone bundle.
 */
const WHOLE_LINK = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]$/;

/**
 * The person an assignee names: the last path segment of its link, so `[[03 Areas/08
 * People/Pascal|P]]` and `[[Pascal]]` are both Pascal. Anything else is the trimmed
 * text, so a plain `Alicia` is itself. The path and the alias are taken off the way
 * #809's chip takes them, so "Ich" and the chip's name agree with the person card on
 * which note is meant.
 */
export function personOf(assignee: string | null): string | null {
  if (assignee === null) return null;
  const text = assignee.trim();
  const target = WHOLE_LINK.exec(text)?.[1];
  if (target === undefined) return text || null;
  return target.slice(target.lastIndexOf("/") + 1).trim() || null;
}

/** The words an assign writes on the line: `[[Name]]`, the link #809's chip reads. */
export const linkFor = (name: string) => `[[${name}]]`;
