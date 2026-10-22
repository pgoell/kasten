// Sets data-theme before the first paint, so a reader on dark never sees a
// light flash on load. src/lib/theme.ts does the same once the app is up,
// and must agree with this on the key and on the system's answer.
//
// A classic script in public/ rather than a module in src/: a module runs only
// after the document parses. The policy is `script-src 'self'`, which rules out
// an inline script.
let stored = null;
try {
  stored = localStorage.getItem("kasten.theme");
} catch (error) {
  // Blocked storage reads as no choice made, the same as theme.ts.
  if (!(error instanceof DOMException)) throw error;
}
const system = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
document.documentElement.dataset.theme = stored === "light" || stored === "dark" ? stored : system;
