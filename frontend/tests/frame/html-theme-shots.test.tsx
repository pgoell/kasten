/**
 * Pictures of the html theme (#786), to look at by eye: an opted-in page that
 * writes its look in tokens only, and a plain page, each at 1440 by 900 and at
 * 390 by 844 with touch, in light and dark; the opted-in page in the three accent
 * palettes; and the two plugin pages, when `VITE_KASTEN_SHOT_NEWS` and
 * `VITE_KASTEN_SHOT_INSIGHTS` name them, served from disk as they are.
 *
 * Skipped unless VITE_KASTEN_SHOTS=1; pictures land in node_modules/.cache/kasten-shots.
 */

// The three faces `main.tsx` loads, so the pictures show the app's type.
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/instrument-sans/index.css";
import "@fontsource-variable/jetbrains-mono/index.css";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { commands, page } from "vitest/browser";
import { HtmlPane } from "@/components/html-pane";
import { applyTheme, PALETTE_KEY, THEME_KEY, type Theme } from "@/lib/theme";
import "@/styles/app.css";
import { stubCommands } from "../stub-commands";
import { shot } from "./shots";

const SHOTS = import.meta.env.VITE_KASTEN_SHOTS === "1";
const NEWS = import.meta.env.VITE_KASTEN_SHOT_NEWS;
const INSIGHTS = import.meta.env.VITE_KASTEN_SHOT_INSIGHTS;
const DESKTOP = { width: 1440, height: 900, touch: false };
const TOUCH = { width: 390, height: 844, touch: true };
type Size = typeof DESKTOP;

/** Where a page is served, from the html it is given or from a file on disk. */
type Source = { path: string; html: string } | { path: string; file: string };

/** A report that writes its look in tokens only, with a table, a code block and an accent kicker. */
const OPTED = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="kasten-theme" content="tokens">
<title>Replication lag across three regions</title>
<style>
  body { margin: 0; padding: 40px 56px 64px; background: var(--k-bg); color: var(--k-ink);
         font-family: var(--k-sans); font-size: 15px; line-height: 1.6; }
  main { max-width: 680px; }
  .kicker { margin: 0 0 8px; color: var(--k-accent); font-size: 12px; letter-spacing: .08em; text-transform: uppercase; }
  h1 { font-family: var(--k-serif); font-weight: 500; font-size: 36px; line-height: 1.1; margin: 0 0 8px; }
  .meta { margin: 0 0 28px; color: var(--k-muted); font-size: 13px; }
  h2 { font-family: var(--k-serif); font-weight: 500; font-size: 23px; margin: 30px 0 8px; }
  p { margin: 0 0 14px; font-family: var(--k-serif); font-size: 19px; color: var(--k-ink-soft); }
  a { color: var(--k-link); }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin: 14px 0 20px; border-top: 1px solid var(--k-rule-strong); }
  th, td { padding: 7px 10px; text-align: left; border-bottom: 1px solid var(--k-rule); }
  th { font-weight: 600; border-bottom-color: var(--k-rule-strong); }
  td.num { text-align: right; font-family: var(--k-mono); }
  pre { margin: 0 0 20px; padding: 12px 14px; border-radius: 6px; background: var(--k-inset); font-family: var(--k-mono); font-size: 13px; }
</style>
</head>
<body>
<main>
  <p class="kicker">Research note</p>
  <h1>Replication lag across three regions</h1>
  <p class="meta">14 October 2026. Six minute read.</p>
  <h2>Summary</h2>
  <p>Replicas in Frankfurt and Virginia stay within one second of the primary at the 99th percentile. The Singapore replicas do not, and <a href="#findings">the gap grows with write volume</a>.</p>
  <table>
    <thead><tr><th>Region</th><th class="num">Median lag</th><th class="num">99th percentile</th><th class="num">Replicas</th></tr></thead>
    <tbody>
      <tr><td>Frankfurt</td><td class="num">38 ms</td><td class="num">212 ms</td><td class="num">4</td></tr>
      <tr><td>Virginia</td><td class="num">52 ms</td><td class="num">340 ms</td><td class="num">6</td></tr>
      <tr><td>Singapore</td><td class="num">97 ms</td><td class="num">611 ms</td><td class="num">3</td></tr>
    </tbody>
  </table>
  <h2 id="findings">Findings</h2>
  <pre>replica_lag_ms{region="singapore"} 611</pre>
  <p>Most of the lag sits in the apply queue, not on the wire. A replica that receives a burst of writes takes longer to apply them than the network takes to deliver them.</p>
</main>
</body>
</html>`;

/** A page of its own: white, serif, its own colours, and no kasten meta. */
const PLAIN = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Replication lag across three regions</title>
<style>
  body { margin: 0; padding: 40px 56px 64px; background: #fff; color: #222;
         font-family: Georgia, "Times New Roman", serif; font-size: 17px; line-height: 1.6; }
  main { max-width: 720px; }
  h1 { font-size: 30px; line-height: 1.2; margin: 0 0 6px; }
  p { margin: 0 0 14px; }
  table { border-collapse: collapse; width: 100%; font-size: 15px; margin: 14px 0 20px; }
  th, td { border-bottom: 1px solid #ddd; padding: 7px 10px; text-align: left; }
  td.num { text-align: right; }
</style>
</head>
<body>
<main>
  <h1>Replication lag across three regions</h1>
  <p>Replicas in Frankfurt and Virginia stay within one second of the primary at the 99th percentile. The Singapore replicas do not.</p>
  <table>
    <thead><tr><th>Region</th><th class="num">Median lag</th><th class="num">99th percentile</th></tr></thead>
    <tbody>
      <tr><td>Frankfurt</td><td class="num">38 ms</td><td class="num">212 ms</td></tr>
      <tr><td>Virginia</td><td class="num">52 ms</td><td class="num">340 ms</td></tr>
      <tr><td>Singapore</td><td class="num">97 ms</td><td class="num">611 ms</td></tr>
    </tbody>
  </table>
</main>
</body>
</html>`;

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Resolves once the page's own script has said hello, so the frame is up and has asked for its look. */
function helloed(): Promise<void> {
  return new Promise((resolve) => {
    const listen = (event: MessageEvent) => {
      if (event.data?.kasten !== "hello") return;
      window.removeEventListener("message", listen);
      resolve();
    };
    window.addEventListener("message", listen);
  });
}

/** The pane filling the viewport, as the editor mounts it. */
function Fixture({ path }: { path: string }) {
  return (
    <div className="flex h-dvh flex-col bg-k-bg">
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <HtmlPane path={path} commands={stubCommands()} onFocus={() => {}} />
        </div>
      </div>
    </div>
  );
}

/**
 * Sets the pane up at one size, theme and palette, serves the page and shoots it.
 * The pane is the real one, so the page opens in the look the pane sends it.
 */
async function shootPane(name: string, size: Size, theme: Theme, source: Source, palette = "poel") {
  await page.viewport(size.width, size.height);
  await commands.emulateMedia({
    touch: size.touch,
    reducedMotion: "no-preference",
    contrast: "no-preference",
    reducedTransparency: "no-preference",
  });
  localStorage.clear();
  localStorage.setItem(THEME_KEY, theme);
  localStorage.setItem(PALETTE_KEY, palette);
  applyTheme();
  if ("html" in source) await commands.servePage(source.path, source.html);
  else await commands.serveFile(source.path, source.file);

  const host = document.body.appendChild(document.createElement("div"));
  const root: Root = createRoot(host);
  try {
    const hello = helloed();
    flushSync(() => root.render(<Fixture path={source.path} />));
    await hello;
    await document.fonts.ready;
    await nextFrame();

    const width = await shot(host, name);
    expect(width).toBe(size.width);
  } finally {
    flushSync(() => root.unmount());
    host.remove();
    await commands.unservePages();
    await commands.emulateMedia({});
  }
}

function shotTest(name: string, run: () => Promise<void>) {
  it.skipIf(!SHOTS)(name, run, 300_000);
}

const OPTED_PATH = "theme-opted.html";
const PLAIN_PATH = "theme-plain.html";

for (const theme of ["light", "dark"] as const) {
  shotTest(`html-theme-opted-1440-${theme}`, () =>
    shootPane(`html-theme-opted-1440-${theme}`, DESKTOP, theme, { path: OPTED_PATH, html: OPTED }),
  );
  shotTest(`html-theme-opted-390-${theme}`, () =>
    shootPane(`html-theme-opted-390-${theme}`, TOUCH, theme, { path: OPTED_PATH, html: OPTED }),
  );
  shotTest(`html-theme-plain-1440-${theme}`, () =>
    shootPane(`html-theme-plain-1440-${theme}`, DESKTOP, theme, { path: PLAIN_PATH, html: PLAIN }),
  );
  shotTest(`html-theme-plain-390-${theme}`, () =>
    shootPane(`html-theme-plain-390-${theme}`, TOUCH, theme, { path: PLAIN_PATH, html: PLAIN }),
  );
  for (const palette of ["russet", "peach", "pansy"]) {
    const name = `html-theme-palette-${palette}-1440-${theme}`;
    shotTest(name, () =>
      shootPane(name, DESKTOP, theme, { path: OPTED_PATH, html: OPTED }, palette),
    );
  }
}

// The plugin pages are not in the repo, so each is shot only when its path is given.
// Named by the file's base name, so two insights pages never share a picture.
for (const file of [NEWS, INSIGHTS]) {
  if (file === undefined) continue;
  const base = file.replace(/^.*\//, "").replace(/\.html$/, "");
  for (const theme of ["light", "dark"] as const) {
    for (const size of [DESKTOP, TOUCH]) {
      const name = `html-theme-${base}-${size.width}-${theme}`;
      shotTest(name, () => shootPane(name, size, theme, { path: `${base}.html`, file }));
    }
  }
}
