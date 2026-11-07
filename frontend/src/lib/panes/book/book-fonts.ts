/**
 * The app's `@font-face` rules for the book's families, copied into its frame, which reaches
 * none of the app's stylesheets. Urls are made absolute: relative ones resolve against `blob:`.
 */

/** A family name as a stylesheet's `font-family` list gives it: no quotes, no case. */
function familyOf(name: string): string {
  return name.replace(/["']/g, "").trim().toLowerCase();
}

/** The families a `font-family` value names, in the order it names them. */
export function familiesOf(value: string): string[] {
  return value
    .split(",")
    .map(familyOf)
    .filter((family) => family !== "");
}

/** Every `url(...)` in `css` made absolute against `base`. A `data:` url is already absolute. */
export function absoluteUrls(css: string, base: string): string {
  return css.replace(/url\((['"]?)([^'")]+)\1\)/g, (_, _quote: string, url: string) => {
    const href = url.startsWith("data:") ? url : new URL(url, base).href;
    return `url("${href}")`;
  });
}

/** The `@font-face` rules of every app stylesheet whose family is one of `families`. */
export function fontFaces(families: readonly string[]): string {
  const wanted = new Set(families.flatMap(familiesOf));
  const css: string[] = [];

  for (const sheet of Array.from(document.styleSheets)) {
    const rules = readableRules(sheet);
    if (rules === null) continue;
    const base = sheet.href ?? document.baseURI;
    for (const rule of Array.from(rules)) {
      if (wantedFace(rule, wanted)) css.push(absoluteUrls(rule.cssText, base));
    }
  }

  return css.join("\n");
}

/**
 * The rules of `sheet`, or null for a stylesheet from another origin, which has no rules this page
 * may read and throws a `SecurityError` for them. Its faces are not ours to copy.
 */
function readableRules(sheet: CSSStyleSheet): CSSRuleList | null {
  try {
    return sheet.cssRules;
  } catch (error) {
    if (error instanceof DOMException && error.name === "SecurityError") return null;
    throw error;
  }
}

/** Whether `rule` is an `@font-face` of one of the `wanted` families. */
function wantedFace(rule: CSSRule, wanted: Set<string>): boolean {
  if (!rule.cssText.startsWith("@font-face")) return false;
  const family = (rule as CSSFontFaceRule).style.getPropertyValue("font-family");
  return wanted.has(familyOf(family));
}
