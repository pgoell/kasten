/** As much of foliate's own toc item as the walk reads. */
export interface TocItem {
  /**
   * Stamped on the item by foliate's `assignIDs` (`progress.js:2-10`), which
   * `TOCProgress.init` runs over the very array `book.toc` holds. So this is
   * the same number `lastLocation.tocItem` hands back, and it is what the
   * cursor's starting row is found by. A label or an href could not do the job:
   * a book is free to repeat either.
   */
  id?: number;
  label?: string | null;
  href?: string | null;
  subitems?: TocItem[] | null;
}

/** One line of the contents, flattened out of the tree. */
export interface TocRow {
  id: number | undefined;
  /** The label, or the href where the book gave no label. */
  label: string;
  /** Where Enter goes, or null for a heading the book gave no link. */
  href: string | null;
  depth: number;
}

/**
 * The publisher's contents as one flat list, in reading order.
 *
 * A depth-first walk, which is what `flatten` in `progress.js:12-16` does with
 * the same tree, written out here because that function is module-local.
 *
 * An entry the book named nowhere and labelled nothing gets no row, and its
 * children still get theirs at the depth they were found at: the nav parser
 * answers that shape for an `<li>` holding only a nested `<ol>`
 * (`epub.js:318-328`), so pruning there would take a whole part of the book off
 * the list.
 */
export function tocRows(toc: TocItem[] | null | undefined): TocRow[] {
  const rows: TocRow[] = [];

  function walk(items: TocItem[], depth: number) {
    for (const item of items) {
      // Falsiness rather than `=== ""`: the ncx gives `""` (`epub.js:352`) and
      // the nav path gives null or undefined (`epub.js:322`).
      const label = item.label?.trim() || item.href;
      if (label) rows.push({ id: item.id, label, href: item.href ?? null, depth });
      walk(item.subitems ?? [], depth + 1);
    }
  }

  walk(toc ?? [], 0);
  return rows;
}
