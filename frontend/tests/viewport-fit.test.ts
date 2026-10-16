import { readFileSync } from "node:fs";
import path from "node:path";

const FRONTEND = path.resolve(import.meta.dirname, "..");

/**
 * The viewport meta as a browser with this user agent ends up with.
 *
 * Reads index.html and runs every classic script in its head against it, read
 * out of public/ where the build serves them from, rather than importing one
 * script by name: a page that stops loading it has to fail here too.
 */
function viewport(userAgent: string): string[] {
  const html = readFileSync(path.join(FRONTEND, "index.html"), "utf8");
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const script of doc.querySelectorAll("head script[src]")) {
    if (script.getAttribute("type") === "module") continue;
    const code = readFileSync(
      path.join(FRONTEND, "public", script.getAttribute("src") ?? ""),
      "utf8",
    );
    new Function("navigator", "document", code)({ userAgent }, doc);
  }
  const content = doc.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? "";
  return content.split(",").map((part) => part.trim());
}

// Real strings, as each browser sends them. Chrome on Android sends the
// reduced `Android 10; K` whatever the phone; Samsung Internet still names it.
const KEEPS = [
  [
    "Chrome on Linux",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  ],
  [
    "Firefox on Windows",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0",
  ],
  [
    "Safari on an iPhone",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  ],
  [
    "Chrome on an iPhone",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1",
  ],
  [
    "Safari on an iPad, which says it is a Mac",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
  ],
];

const LOSES = [
  [
    "Chrome on Android",
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  ],
  [
    "Samsung Internet on a Galaxy S22 Ultra",
    "Mozilla/5.0 (Linux; Android 14; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36",
  ],
  ["Firefox on Android", "Mozilla/5.0 (Android 14; Mobile; rv:143.0) Gecko/143.0 Firefox/143.0"],
];

describe("viewport-fit=cover by user agent (#364)", () => {
  it.each(KEEPS)("%s keeps it", (_, userAgent) => {
    expect(viewport(userAgent)).toContain("viewport-fit=cover");
  });

  it.each(LOSES)("%s loses it and keeps the rest", (_, userAgent) => {
    expect(viewport(userAgent)).toEqual([
      "width=device-width",
      "initial-scale=1.0",
      "interactive-widget=resizes-content",
    ]);
  });
});
