/**
 * Inline `<svg>` blocks, cleaned before the page draws them (#952).
 *
 * A note is text an agent may have written, so the picture keeps only what
 * paints shapes and text, plus the refs between them. The tree is rebuilt from
 * allow lists instead of cut in place: a block list misses the next element a
 * browser adds, and a string cleaned then parsed again is one more place to get
 * wrong. The lists are MDN's SVG element and presentation attribute references,
 * pruned to static drawing; cross-checked against DOMPurify's svg profile.
 */

const SVG = "http://www.w3.org/2000/svg";
const XLINK = "http://www.w3.org/1999/xlink";

const ELEMENTS = new Set(
  "svg g defs symbol use path rect circle ellipse line polyline polygon text tspan textPath title desc marker linearGradient radialGradient stop clipPath mask pattern".split(
    " ",
  ),
);

const PRESENTATION = new Set(
  "fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset stroke-miterlimit opacity color stop-color stop-opacity font-family font-size font-weight font-style font-variant text-anchor dominant-baseline alignment-baseline baseline-shift letter-spacing word-spacing text-decoration writing-mode clip-path clip-rule mask marker-start marker-mid marker-end visibility display paint-order vector-effect shape-rendering text-rendering".split(
    " ",
  ),
);

const GEOMETRY = new Set(
  "id x y x1 y1 x2 y2 cx cy r rx ry fx fy fr d points width height viewBox preserveAspectRatio transform pathLength dx dy rotate textLength lengthAdjust startOffset method spacing side markerWidth markerHeight markerUnits refX refY orient offset gradientUnits gradientTransform spreadMethod patternUnits patternContentUnits patternTransform clipPathUnits maskUnits maskContentUnits".split(
    " ",
  ),
);

const ATTRIBUTES = new Set([...GEOMETRY, ...PRESENTATION]);

/** Markup, a quote or a script hook in a value; the value is dropped. */
const UNSAFE = /[\\<>@&"']|\/\*|expression|javascript:/i;
const URL_REF = /^url\(\s*#([A-Za-z_][\w.-]*)\s*\)$/i;
const HREF = /^#([A-Za-z_][\w.-]*)$/;
const ID = /^[A-Za-z_][\w.-]*$/;

/** A value the drawing may keep: no unsafe text, and any `url(...)` names an id in the block. */
function valueOk(value: string, ids: Set<string>): boolean {
  if (UNSAFE.test(value)) return false;
  if (!/url\(/i.test(value)) return true;
  const id = URL_REF.exec(value)?.[1];
  return id !== undefined && ids.has(id);
}

/** An attribute to set once every id in the block is known: element, name, value. */
type Deferred = [Element, string, string];

/** Sets the id now, since the refs checked later need every id in the block; defers the rest. */
function keepAttributes(el: Element, from: Element, ids: Set<string>, deferred: Deferred[]) {
  for (const attr of Array.from(from.attributes)) {
    if (attr.name === "id") {
      if (ID.test(attr.value)) {
        el.setAttribute("id", attr.value);
        ids.add(attr.value);
      }
    } else if (
      attr.localName === "href" &&
      (attr.namespaceURI === null || attr.namespaceURI === XLINK)
    ) {
      deferred.push([el, "href", attr.value]);
    } else if (attr.name === "style" || ATTRIBUTES.has(attr.name)) {
      deferred.push([el, attr.name, attr.value]);
    }
  }
}

/** Copies an allowed svg element and its text into `document`; anything else, subtree and all, is dropped. */
function copy(from: Element, ids: Set<string>, deferred: Deferred[]): Element | null {
  if (from.namespaceURI !== SVG || !ELEMENTS.has(from.localName)) return null;
  const el = document.createElementNS(SVG, from.localName);
  keepAttributes(el, from, ids, deferred);

  for (const node of Array.from(from.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      el.appendChild(document.createTextNode(node.textContent ?? ""));
    } else if (node instanceof Element) {
      const child = copy(node, ids, deferred);
      if (child) el.appendChild(child);
    }
  }
  return el;
}

/**
 * The style declarations that may stay, written back as `prop: value`. Each is
 * checked on its own, so `position: fixed` goes and the `fill` beside it stays.
 */
function styleOf(value: string, ids: Set<string>): string {
  const kept: string[] = [];
  for (const piece of value.split(";")) {
    const colon = piece.indexOf(":");
    if (colon < 0) continue;
    const prop = piece.slice(0, colon).trim().toLowerCase();
    const val = piece.slice(colon + 1).trim();
    if (PRESENTATION.has(prop) && valueOk(val, ids)) kept.push(`${prop}: ${val}`);
  }
  return kept.join("; ");
}

/** Sets one deferred attribute, now that every id in the block is known. */
function settle(el: Element, name: string, value: string, ids: Set<string>) {
  if (name === "href") {
    const id = HREF.exec(value)?.[1];
    if (id !== undefined && ids.has(id)) el.setAttribute("href", value);
  } else if (name === "style") {
    const style = styleOf(value, ids);
    if (style) el.setAttribute("style", style);
  } else if (valueOk(value, ids)) {
    el.setAttribute(name, value);
  }
}

/**
 * The first svg in `source` as a fresh, cleaned element, or null when there is
 * nothing to draw. The page inserts it as a node, never as markup.
 */
export function sanitizeSvg(source: string): SVGSVGElement | null {
  const found = new DOMParser().parseFromString(source, "text/html").querySelector("svg");
  if (!found) return null;

  const ids = new Set<string>();
  const deferred: Deferred[] = [];
  const root = copy(found, ids, deferred);
  if (!root || root.children.length === 0) return null;

  for (const [el, name, value] of deferred) settle(el, name, value, ids);
  return root as SVGSVGElement;
}
