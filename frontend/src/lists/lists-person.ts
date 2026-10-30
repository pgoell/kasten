/**
 * A whole `[[target]]`, with an optional `#heading` and `|alias` after the target.
 * Written here rather than imported from the shared link helpers, which would pull the
 * editor's packages into this phone bundle.
 */
const WHOLE_LINK = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]$/;

/**
 * The person an assignee names: the last path segment of its link, with any alias dropped as
 * #809's chip drops it, so both name the same note. Plain text is itself.
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
