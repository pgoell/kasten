/**
 * The app's own `@font-face` rules for the families a book is set in, for the book's frame.
 *
 * A face is a rule in one of the app's stylesheets, and the book is its own
 * document, which none of them reach. So the rules are copied across, the ones
 * for the families named. Each url is made absolute first: a relative url in the
 * frame resolves against the frame's own address, which is `blob:` and holds no
 * font.
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

/**
 * Every `url(...)` in `css` made absolute against `base`.
 *
 * A `data:` url is already absolute and comes back as it was.
 */
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
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch (error) {
      // A stylesheet from another origin has no rules this page may read, and
      // throws a `SecurityError` for them. Its faces are not ours to copy.
      if (error instanceof DOMException && error.name === "SecurityError") continue;
      throw error;
    }
    const base = sheet.href ?? document.baseURI;
    for (const rule of Array.from(rules)) {
      if (!rule.cssText.startsWith("@font-face")) continue;
      const family = (rule as CSSFontFaceRule).style.getPropertyValue("font-family");
      if (!wanted.has(familyOf(family))) continue;
      css.push(absoluteUrls(rule.cssText, base));
    }
  }

  return css.join("\n");
}
