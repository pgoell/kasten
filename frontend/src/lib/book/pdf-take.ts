/**
 * The PDF take's link, quote and the marks a text layer keeps, as character offsets.
 * A page is drawn again when it scrolls back, so a `Range` would point into a layer that is gone.
 */

import { aliasOf, fileLink, fileOf, quoteBlock } from "@/lib/html-take";

/** The highlight's name in the document, which the stylesheet paints with `::highlight`. */
const TAKEN = "kasten-taken";

/**
 * `[[<path>#page=<page>|<file>, page <page>]]`, the link back to the page, or the markdown
 * form `fileLink` picks for a path with a bracket, bar or hash. The file name is alias-escaped.
 */
export function pdfLink(path: string, page: number, from: string): string {
  return fileLink(path, `page=${page}`, `${aliasOf(fileOf(path))}, page ${page}`, from);
}

/** The dump paragraph for a PDF passage: the text quoted, then the link to its page. */
export function pdfQuote(path: string, page: number, text: string, from: string): string {
  return quoteBlock(text, pdfLink(path, page, from));
}

/**
 * The selection's text, each line break and the white space round it made one space. pdf.js ends
 * each printed line with a break, and a passage is one paragraph.
 */
export function oneLine(text: string): string {
  return text.replace(/\s*[\n\r]\s*/g, " ");
}

/**
 * Where `range` sits in the text of `layer`, as UTF-16 offsets, or null when the two do not meet.
 * Only the covered text counts, so a range running past the layer is clipped to it.
 */
export function offsetsIn(layer: Element, range: Range): { start: number; end: number } | null {
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  let total = 0;
  let start = -1;
  let end = -1;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node as Text;
    const length = text.data.length;
    const covered = coveredIn(text, range);
    if (covered !== null) {
      if (start === -1) start = total + covered.from;
      end = total + covered.to;
    }
    total += length;
  }
  return start === -1 ? null : { start, end };
}

/** The offsets of `text` that `range` covers, or null where it covers none of it. */
function coveredIn(text: Text, range: Range): { from: number; to: number } | null {
  if (!range.intersectsNode(text)) return null;
  const from = text === range.startContainer ? range.startOffset : 0;
  const to = text === range.endContainer ? range.endOffset : text.data.length;
  return to > from ? { from, to } : null;
}

/**
 * The `Range` over offsets `start` to `end` of `layer`'s text, the inverse of
 * `offsetsIn`, or null when the layer holds no text there.
 */
export function rangeIn(layer: Element, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  let total = 0;
  let from: { text: Text; offset: number } | null = null;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node as Text;
    const length = text.data.length;
    if (from === null && start <= total + length) {
      from = { text, offset: Math.max(0, start - total) };
    }
    if (from !== null && end <= total + length) {
      const range = document.createRange();
      range.setStart(from.text, from.offset);
      range.setEnd(text, end - total);
      return range;
    }
    total += length;
  }
  return null;
}

/**
 * The one highlight every PDF pane adds its ranges to, kept under `TAKEN` so a pane reads it back
 * by name. Null where the browser has no CSS highlights.
 */
export function takenHighlight(): Highlight | null {
  if (typeof CSS === "undefined" || !("highlights" in CSS)) return null;
  const registered = CSS.highlights.get(TAKEN);
  if (registered !== undefined) return registered;
  const made = new Highlight();
  CSS.highlights.set(TAKEN, made);
  return made;
}
