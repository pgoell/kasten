/**
 * Pictures of the html pane (#785), to look at by eye: the page in its frame at
 * 1440 by 900 in light and dark; the which-key panel open over it after Space
 * was pressed in the page; the pane at 390 by 844 with touch; and the header in
 * the three accent palettes the app has besides the default.
 *
 * Skipped unless VITE_KASTEN_SHOTS=1; pictures land in node_modules/.cache/kasten-shots.
 */

// The three faces `main.tsx` loads, so the pictures show the app's type.
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/instrument-sans/index.css";
import "@fontsource-variable/jetbrains-mono/index.css";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { commands, page, userEvent } from "vitest/browser";
import { HtmlPane } from "@/components/html-pane";
import { WhichKey } from "@/components/which-key";
import { applyTheme, PALETTE_KEY, THEME_KEY, type Theme } from "@/lib/theme";
import "@/styles/app.css";
import { stubCommands } from "../stub-commands";
import { shot } from "./shots";

const SHOTS = import.meta.env.VITE_KASTEN_SHOTS === "1";
const DESKTOP = { width: 1440, height: 900, touch: false };
const TOUCH = { width: 390, height: 844, touch: true };
type Size = typeof DESKTOP;

const PATH = "replication.html";
/** A nested path with spaces, long enough that the header has to cut it on a phone. */
const LONG_PATH = "30 Research/2026 Replication study/regional lag across three regions.html";

/**
 * A short research report with its own plain styles, the kind a research run
 * leaves in the vault: white, serif, a table, no script of its own. The page
 * script is appended after it by `servePage`, as `read_html` does.
 */
const REPORT = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Replication lag across three regions</title>
<style>
  body { margin: 0; padding: 40px 56px 64px; background: #fff; color: #222;
         font-family: Georgia, "Times New Roman", serif; font-size: 17px; line-height: 1.6; }
  main { max-width: 720px; }
  h1 { font-size: 30px; line-height: 1.2; margin: 0 0 6px; }
  .meta { color: #666; font-size: 14px; margin: 0 0 28px; }
  h2 { font-size: 21px; margin: 30px 0 8px; }
  p { margin: 0 0 14px; }
  table { border-collapse: collapse; width: 100%; font-size: 15px; margin: 14px 0 20px; }
  th, td { border-bottom: 1px solid #ddd; padding: 7px 10px; text-align: left; }
  th { font-weight: 600; border-bottom-color: #888; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
</style>
</head>
<body>
<main>
  <h1>Replication lag across three regions</h1>
  <p class="meta">Research note, 14 October 2026. Six minute read.</p>
  <h2>Summary</h2>
  <p>Replicas in Frankfurt and Virginia stay within one second of the primary at the 99th percentile. The Singapore replicas do not, and the gap grows with write volume rather than with time.</p>
  <table>
    <thead>
      <tr><th>Region</th><th class="num">Median lag</th><th class="num">99th percentile</th><th class="num">Replicas</th></tr>
    </thead>
    <tbody>
      <tr><td>Frankfurt</td><td class="num">38 ms</td><td class="num">212 ms</td><td class="num">4</td></tr>
      <tr><td>Virginia</td><td class="num">52 ms</td><td class="num">340 ms</td><td class="num">6</td></tr>
      <tr><td>Singapore</td><td class="num">97 ms</td><td class="num">611 ms</td><td class="num">3</td></tr>
    </tbody>
  </table>
  <h2>Findings</h2>
  <p>Most of the lag sits in the apply queue, not on the wire. A replica that receives a burst of writes takes longer to apply them than the network takes to deliver them, so the queue is where the seconds go.</p>
  <p>The first thing to check after a failover is which replica holds the last acknowledged write. Two of the three runs promoted a replica that was still behind, which is the case the alerting in the dashboard was written for.</p>
</main>
</body>
</html>`;

/** The pane filling the viewport, with the which-key panel beside it, as the editor mounts them. */
function Fixture({ phone, path }: { phone: boolean; path: string }) {
  return (
    <div className="flex h-dvh flex-col bg-k-bg">
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <HtmlPane path={path} commands={stubCommands()} onFocus={() => {}} />
        </div>
      </div>
      <WhichKey phone={phone} />
    </div>
  );
}

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

function panelOf(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[role='dialog'][aria-label='Leader keys']");
}

/**
 * Sets the pane up at one size and theme and shoots it. With `which`, Space is
 * pressed in the page first, so the panel is open over it.
 */
async function shootPane(
  name: string,
  size: Size,
  theme: Theme,
  options: { palette?: string; which?: boolean; header?: boolean; path?: string } = {},
) {
  const path = options.path ?? PATH;
  await page.viewport(size.width, size.height);
  await commands.emulateMedia({
    touch: size.touch,
    reducedMotion: "no-preference",
    contrast: "no-preference",
    reducedTransparency: "no-preference",
  });
  localStorage.clear();
  localStorage.setItem(THEME_KEY, theme);
  localStorage.setItem(PALETTE_KEY, options.palette ?? "poel");
  applyTheme();
  await commands.servePage(path, REPORT);

  const host = document.body.appendChild(document.createElement("div"));
  const root: Root = createRoot(host);
  try {
    const hello = helloed();
    flushSync(() => root.render(<Fixture phone={size.touch} path={path} />));
    await hello;
    await document.fonts.ready;
    await nextFrame();

    if (options.which) {
      const frame = host.querySelector("iframe") as HTMLIFrameElement;
      await userEvent.click(frame);
      await userEvent.keyboard(" ");
      // The desktop panel fades in, so the picture is taken once it has settled.
      for (let at = 0; at < 60 && Number(panelOf()?.style.opacity ?? 1) < 1; at += 1) {
        await nextFrame();
      }
      await nextFrame();
    }

    const target = options.header ? host.querySelector("header") : host;
    const width = await shot(target as Element, name);
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

for (const theme of ["light", "dark"] as const) {
  shotTest(`html-pane-desktop-1440-${theme}`, () =>
    shootPane(`html-pane-desktop-1440-${theme}`, DESKTOP, theme),
  );
  shotTest(`html-pane-which-key-1440-${theme}`, () =>
    shootPane(`html-pane-which-key-1440-${theme}`, DESKTOP, theme, { which: true }),
  );
  shotTest(`html-pane-touch-390-${theme}`, () =>
    shootPane(`html-pane-touch-390-${theme}`, TOUCH, theme, { path: LONG_PATH }),
  );
  for (const palette of ["russet", "peach", "pansy"]) {
    const name = `html-pane-palette-${palette}-1440-${theme}`;
    shotTest(name, () => shootPane(name, DESKTOP, theme, { palette, header: true }));
  }
}
