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
// CSS white space only: `\s` also matches a no-break space, which a browser does not read as one.
const URL_REF = /^url\([ \t\n\r\f]*#([A-Za-z_][\w.-]*)[ \t\n\r\f]*\)$/i;
const HREF = /^#([A-Za-z_][\w.-]*)$/;
const ID = /^[A-Za-z_][\w.-]*$/;

/** Every `name(` in a value, so a function the drawing does not need is caught. */
const FUNCTION = /([A-Za-z-]+)\(/g;
/** The functions a drawing may use. `url` is checked on its own; var(), env(), attr() and -moz-element() are not here. */
const FUNCTIONS = new Set(
  "translate translatex translatey rotate scale scalex scaley skewx skewy matrix rgb rgba hsl hsla oklch oklab lab lch hwb color-mix calc light-dark".split(
    " ",
  ),
);
/** The shapes and text a picture must hold to be worth drawing. */
const DRAWN = "path, rect, circle, ellipse, line, polyline, polygon, text, use";
/** The root is the page's own box: a move or an offset here would carry the app with it. */
const ROOT_DROPS = ["transform", "x", "y"];

/** Each block gets its own id prefix: getElementById finds the first match on the page, and a bare id like `process` would shadow a window global. */
let blocks = 0;

/** An attribute to set once every id in the block is known: element, name, value. */
type Deferred = [Element, string, string];

/** One svg being cleaned: the prefix its ids take, the element behind each id, and the attributes still to set. */
type Block = { prefix: string; ids: Map<string, Element>; deferred: Deferred[] };

/**
 * The value with its refs moved to the block's prefixed ids, or null when it may
 * not stay. Every `name(` must be a function a drawing needs, and a `url(...)`
 * must be one ref to an id in the block.
 */
function clean(value: string, block: Block): string | null {
  if (UNSAFE.test(value)) return null;
  const names = Array.from(value.matchAll(FUNCTION), (m) => (m[1] ?? "").toLowerCase());
  if (!names.includes("url")) return names.every((n) => FUNCTIONS.has(n)) ? value : null;
  const id = URL_REF.exec(value)?.[1];
  return id !== undefined && block.ids.has(id) ? `url(#${block.prefix}${id})` : null;
}

/** Sets the id now, since the refs checked later need every id in the block; defers the rest. */
function keepAttributes(el: Element, from: Element, block: Block) {
  for (const attr of Array.from(from.attributes)) {
    if (attr.name === "id") {
      // The first element with an id keeps it, as the browser resolves an id to its first match; a later duplicate would be a decoy that no guard checks.
      if (ID.test(attr.value) && !block.ids.has(attr.value)) {
        el.setAttribute("id", block.prefix + attr.value);
        block.ids.set(attr.value, el);
      }
    } else if (
      attr.localName === "href" &&
      (attr.namespaceURI === null || attr.namespaceURI === XLINK)
    ) {
      block.deferred.push([el, "href", attr.value]);
    } else if (attr.name === "style" || ATTRIBUTES.has(attr.name)) {
      block.deferred.push([el, attr.name, attr.value]);
    }
  }
}

/** Copies an allowed svg element and its text into `document`; anything else, subtree and all, is dropped. */
function copy(from: Element, block: Block): Element | null {
  if (from.namespaceURI !== SVG || !ELEMENTS.has(from.localName)) return null;
  const el = document.createElementNS(SVG, from.localName);
  keepAttributes(el, from, block);

  for (const node of Array.from(from.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      el.appendChild(document.createTextNode(node.textContent ?? ""));
    } else if (node instanceof Element) {
      const child = copy(node, block);
      if (child) el.appendChild(child);
    }
  }
  return el;
}

/**
 * The style declarations that may stay, written back as `prop: value`. Each is
 * checked on its own, so `position: fixed` goes and the `fill` beside it stays.
 */
function styleOf(value: string, block: Block): string {
  const kept: string[] = [];
  for (const piece of value.split(";")) {
    const colon = piece.indexOf(":");
    if (colon < 0) continue;
    const prop = piece.slice(0, colon).trim().toLowerCase();
    const val = piece.slice(colon + 1).trim();
    const cleaned = PRESENTATION.has(prop) ? clean(val, block) : null;
    if (cleaned !== null) kept.push(`${prop}: ${cleaned}`);
  }
  return kept.join("; ");
}

/** An href to an id in the block, kept unless it is a use of a use. */
function settleHref(el: Element, value: string, block: Block) {
  const id = HREF.exec(value)?.[1];
  const target = id === undefined ? undefined : block.ids.get(id);
  if (id === undefined || target === undefined) return;
  // A use of a group that holds a use loses its href: stripTargets clears the refs
  // inside the group, not this use, and each use level would multiply the work.
  if (el.localName === "use" && (target.localName === "use" || target.querySelector("use"))) return;
  el.setAttribute("href", `#${block.prefix}${id}`);
}

/** Sets one deferred attribute, now that every id in the block is known. */
function settle(el: Element, name: string, value: string, block: Block) {
  if (name === "href") {
    settleHref(el, value, block);
  } else if (name === "style") {
    const style = styleOf(value, block);
    if (style) el.setAttribute("style", style);
  } else {
    const cleaned = clean(value, block);
    if (cleaned !== null) el.setAttribute(name, cleaned);
  }
}

/** Ids a kept ref names inside an attribute or style value, as `url(#id)`. */
const NAMED = /url\(#([^)]+)\)/g;
/** Inside these a shape draws only when something refers to it, so it does not count as a drawing. */
const HIDDEN = "defs, marker, clipPath, mask, pattern, symbol";

/** Drops every ref on one element: its href, its url-valued attributes, and its url declarations in a style. */
function stripRefs(el: Element) {
  el.removeAttribute("href");
  for (const attr of Array.from(el.attributes)) {
    if (!attr.value.includes("url(")) continue;
    if (attr.name !== "style") {
      el.removeAttribute(attr.name);
      continue;
    }
    const rest = attr.value
      .split(";")
      .map((d) => d.trim())
      .filter((d) => d !== "" && !d.includes("url("))
      .join("; ");
    if (rest) el.setAttribute("style", rest);
    else el.removeAttribute("style");
  }
}

/**
 * A target that some kept ref points at keeps no refs on itself or beneath it.
 * Each ref then draws a picture with no refs in it, so a chain of uses, masks,
 * patterns or markers costs one copy per level, not a tree of copies.
 */
function stripTargets(root: Element) {
  const all = [root, ...Array.from(root.querySelectorAll("*"))];
  const byId = new Map(
    all.filter((el) => el.id !== "").map((el): [string, Element] => [el.id, el]),
  );
  for (const target of refTargets(all, byId)) {
    for (const el of [target, ...Array.from(target.querySelectorAll("*"))]) stripRefs(el);
  }
}

/** The elements that a kept href or url(#id) in `all` points at. */
function refTargets(all: Element[], byId: Map<string, Element>): Set<Element> {
  const targets = new Set<Element>();
  for (const el of all) {
    const href = el.getAttribute("href") ?? "";
    const hrefTarget = href.startsWith("#") ? byId.get(href.slice(1)) : undefined;
    if (hrefTarget) targets.add(hrefTarget);
    for (const attr of Array.from(el.attributes)) addNamed(attr.value, byId, targets);
  }
  return targets;
}

/** Adds the element each `url(#id)` in `value` names. */
function addNamed(value: string, byId: Map<string, Element>, targets: Set<Element>) {
  for (const m of value.matchAll(NAMED)) {
    const target = byId.get(m[1] ?? "");
    if (target) targets.add(target);
  }
}

/** Whether something outside the hidden parts draws: a shape, or a use still pointing at one. */
function drawsSomething(root: Element): boolean {
  return Array.from(root.querySelectorAll(DRAWN)).some(
    (el) => (el.localName !== "use" || el.hasAttribute("href")) && el.closest(HIDDEN) === null,
  );
}

/**
 * The one svg in `source`, cleaned, or null when the source is anything but one
 * svg or the cleaned svg has nothing to draw. The page inserts it as a node,
 * never as markup.
 */
export function sanitizeSvg(source: string): SVGSVGElement | null {
  const body = new DOMParser().parseFromString(source, "text/html").body;
  // A second svg, or a word beside the first, would draw as part of this picture.
  const parts = Array.from(body.childNodes).filter(
    (n) => n.nodeType !== Node.TEXT_NODE || (n.textContent ?? "").trim() !== "",
  );
  const only = parts[0];
  if (parts.length !== 1 || !(only instanceof Element) || only.localName !== "svg") return null;

  const block: Block = { prefix: `kasten-svg-${++blocks}-`, ids: new Map(), deferred: [] };
  const root = copy(only, block);
  if (!root) return null;

  for (const [el, name, value] of block.deferred) settle(el, name, value, block);
  stripTargets(root);
  for (const name of ROOT_DROPS) root.removeAttribute(name);
  return drawsSomething(root) ? (root as SVGSVGElement) : null;
}
