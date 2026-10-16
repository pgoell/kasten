import { readFileSync } from "node:fs";
import path from "node:path";

// Safari answers `env(safe-area-inset-*)` with zero unless the page asks to be
// drawn under the notch and the home indicator, in a tab and on the home
// screen alike. Chromium's emulation does not gate on it, so the frame tests
// that pad by those insets cannot catch this meta going missing; this does.
it("the viewport meta carries viewport-fit=cover", () => {
  const html = readFileSync(path.resolve(import.meta.dirname, "../index.html"), "utf8");
  const doc = new DOMParser().parseFromString(html, "text/html");
  const content = doc.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? "";
  expect(content.split(",").map((part) => part.trim())).toContain("viewport-fit=cover");
});
