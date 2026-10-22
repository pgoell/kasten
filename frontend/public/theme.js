// Sets data-theme and data-palette before the first paint, so a reader on dark
// never sees a light flash on load. src/lib/theme.ts does the same once the app
// is up, and must agree with this on the keys, on the system's answer and on
// the palette ids.
//
// A classic script in public/ rather than a module in src/: a module runs only
// after the document parses. The policy is `script-src 'self'`, which rules out
// an inline script.
let stored = null;
let palette = null;
try {
  stored = localStorage.getItem("kasten.theme");
  palette = localStorage.getItem("kasten.palette");
} catch (error) {
  // Blocked storage reads as no choice made, the same as theme.ts.
  if (!(error instanceof DOMException)) throw error;
}
const system = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
const theme = stored === "light" || stored === "dark" ? stored : system;
document.documentElement.dataset.theme = theme;
const palettes = ["poel", "russet", "peach", "pansy"];
document.documentElement.dataset.palette = palettes.includes(palette) ? palette : "poel";

// The --k-bg of each theme in src/styles/kasten-theme.css, so the browser bar
// is right before that stylesheet's tokens are read. theme.ts takes over from
// the computed token once the app runs.
const pages = { light: "#f6f6f4", dark: "#141414" };
const bar = document.querySelector('meta[name="theme-color"]');
if (bar) bar.content = pages[theme];
