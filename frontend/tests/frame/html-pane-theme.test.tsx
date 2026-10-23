/**
 * The html pane's theme on screen, in a real browser (#786).
 *
 * The pane is the real one, its frame served by `servePage`, which runs the
 * backend's own page writer, so a page opens in the look the pane sends it. A
 * frame has an opaque origin, so each page answers a `probe` with what it shows,
 * and the test reads that answer rather than the frame's DOM.
 */

import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { commands as browser, page, userEvent } from "vitest/browser";
import { HtmlPane } from "@/components/html-pane";
import { Toolbar } from "@/components/toolbar";
import { WhichKey } from "@/components/which-key";
import { PALETTE_KEY, pickPalette, THEME_KEY, toggleTheme } from "@/lib/theme";
import "@/styles/app.css";
import { stubCommands } from "../stub-commands";

type Spy = ReturnType<typeof stubCommands>;

/** What a page shows, as its own script reports it. */
interface Probe {
  theme: string | null;
  palette: string | null;
  scrollY: number;
  open: boolean | null;
  loads: number;
  bg: string;
  font: boolean;
}

/** One message the window heard, from whatever window sent it. */
interface Heard {
  source: MessageEventSource | null;
  data: { kasten?: string; key?: string; fixture?: string; probe?: Probe };
}

const heard: Heard[] = [];
window.addEventListener("message", (event: MessageEvent) => {
  heard.push({ source: event.source, data: event.data ?? {} });
});

/**
 * The page's answer to `{probe: true}`, and its scroll to `{scroll: y}`. `up` is
 * read before any page code runs, so a page whose own script sets `parent` still
 * answers. `loads` is set once per load, so a reload shows as a new number.
 */
const PROBE = `<script>
const up = parent;
window.loadId = Math.random();
addEventListener("message", async (event) => {
  if (event.source !== up) return;
  if (event.data?.scroll !== undefined) scrollTo(0, event.data.scroll);
  if (event.data?.probe !== true) return;
  await document.fonts.ready;
  const html = document.documentElement;
  up.postMessage({ fixture: "probe", probe: {
    theme: html.dataset.theme ?? null,
    palette: html.dataset.palette ?? null,
    scrollY,
    open: document.querySelector("details")?.open ?? null,
    loads: window.loadId,
    bg: getComputedStyle(document.body).backgroundColor,
    font: [...document.fonts].some((face) => face.family.includes("Newsreader") && face.status === "loaded"),
  } }, "*");
});
</script>`;

/** Tokens only, the way an opted-in page writes its look. */
const SHEET = `body { margin: 0; padding: 24px; background: var(--k-bg); color: var(--k-ink); font-family: var(--k-sans); }
h1 { font-family: var(--k-serif); font-weight: 500; }
a { color: var(--k-link); }`;

/** Tall enough to scroll, with a details open above the fold, which must stay open. */
const BODY = `<h1>Report</h1><details open><summary>more</summary>text</details><div style="height:3000px"></div>`;

const OPTED = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="kasten-theme" content="tokens"><title>opted</title><style>${SHEET}</style></head><body>${BODY}${PROBE}</body></html>`;

/** An opted-in page with no `<head>`, so kasten puts its styles after the meta tag. */
const NO_HEAD = `<!doctype html><meta name="kasten-theme" content="tokens"><style>${SHEET}</style><body>${BODY}${PROBE}</body>`;

/** An opted-in page whose own script sets `parent` once the probe has taken its reference. */
const OWN_PARENT = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="kasten-theme" content="tokens"><title>own parent</title><style>${SHEET}</style></head><body>${BODY}${PROBE}<script>var parent = null;</script></body></html>`;

/** A page that sets nothing: no meta, no tokens, its own default look. */
const PLAIN = `<!doctype html><title>plain</title><h1>Plain</h1><div style="height:3000px"></div>${PROBE}`;

const OPTED_PATH = "opted.html";
const PLAIN_PATH = "plain.html";

let host: HTMLDivElement;
let root: Root;
let spy: Spy;

beforeEach(async () => {
  await page.viewport(1440, 900);
  heard.length = 0;
  localStorage.removeItem(THEME_KEY);
  localStorage.removeItem(PALETTE_KEY);
  spy = stubCommands();
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});

afterEach(async () => {
  flushSync(() => root.unmount());
  host.remove();
  localStorage.removeItem(THEME_KEY);
  localStorage.removeItem(PALETTE_KEY);
  await browser.unservePages();
  await page.viewport(1440, 900);
  await browser.emulateMedia({});
});

/** A layout of one pane per path, and the toolbar when the test is on a phone. */
function Layout({ paths, phone = false }: { paths: string[]; phone?: boolean }) {
  return (
    <div className="flex h-dvh flex-col">
      <div className="flex min-h-0 flex-1">
        {paths.map((path) => (
          <div key={path} data-pane className="min-w-0 flex-1">
            <HtmlPane path={path} commands={spy} onFocus={() => {}} />
          </div>
        ))}
      </div>
      {phone && <Toolbar commands={spy} split={paths.length > 1} />}
      <WhichKey phone={phone} />
    </div>
  );
}

function render(paths: string[], phone = false) {
  flushSync(() => root.render(<Layout paths={paths} phone={phone} />));
}

function frameOf(index: number): HTMLIFrameElement {
  return host.querySelectorAll("iframe")[index] as HTMLIFrameElement;
}

function panelOf(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[role='dialog'][aria-label='Leader keys']");
}

/** The look the pane opens the page in: the theme and palette the reader has chosen. */
function look(theme: "light" | "dark", palette = "poel") {
  localStorage.setItem(THEME_KEY, theme);
  localStorage.setItem(PALETTE_KEY, palette);
}

/** Waits for the page's own script to say hello, which it does once it has run. */
async function ready(frame: HTMLIFrameElement) {
  await expect
    .poll(() => heard.some((h) => h.source === frame.contentWindow && h.data.kasten === "hello"))
    .toBe(true);
}

/** The page's probe answer, asked for and waited on, since a frame's DOM is out of reach. */
async function probeOf(frame: HTMLIFrameElement): Promise<Probe | undefined> {
  const before = heard.length;
  frame.contentWindow?.postMessage({ probe: true }, "*");
  const answered = () =>
    heard.slice(before).find((h) => h.source === frame.contentWindow && h.data.fixture === "probe");
  await expect.poll(() => answered() !== undefined).toBe(true);
  return answered()?.data.probe;
}

it("an opted-in page opens in the theme and the palette on screen", async () => {
  look("dark", "russet");
  await browser.servePage(OPTED_PATH, OPTED);
  render([OPTED_PATH]);
  const frame = frameOf(0);
  await ready(frame);

  const seen = await probeOf(frame);

  expect({
    theme: seen?.theme,
    palette: seen?.palette,
    bg: seen?.bg,
    font: seen?.font,
  }).toEqual({ theme: "dark", palette: "russet", bg: "rgb(20, 20, 20)", font: true });
});

it("a theme switch half way down reaches an opted-in page with no reload: scroll and open details stay", async () => {
  look("light");
  await browser.emulateMedia({ reducedMotion: "reduce" });
  await browser.servePage(OPTED_PATH, OPTED);
  render([OPTED_PATH]);
  const frame = frameOf(0);
  await ready(frame);
  frame.contentWindow?.postMessage({ scroll: 1000 }, "*");
  const before = await probeOf(frame);

  toggleTheme();
  pickPalette("pansy");
  const after = await probeOf(frame);

  expect({
    theme: after?.theme,
    palette: after?.palette,
    scrollY: after?.scrollY,
    open: after?.open,
    loads: after?.loads,
  }).toEqual({
    theme: "dark",
    palette: "pansy",
    scrollY: before?.scrollY,
    open: true,
    loads: before?.loads,
  });
  expect(before?.scrollY).toBeGreaterThan(0);
  expect(after?.bg).toBe("rgb(20, 20, 20)");
});

it("a plain page gets nothing about colour or fonts", async () => {
  look("dark");
  await browser.servePage(PLAIN_PATH, PLAIN);
  render([PLAIN_PATH]);
  const frame = frameOf(0);
  await ready(frame);

  const seen = await probeOf(frame);

  expect({
    theme: seen?.theme,
    palette: seen?.palette,
    bg: seen?.bg,
    font: seen?.font,
  }).toEqual({ theme: null, palette: null, bg: "rgba(0, 0, 0, 0)", font: false });
});

it("an opted-in page with no head tag takes the theme too", async () => {
  look("dark");
  await browser.servePage(OPTED_PATH, NO_HEAD);
  render([OPTED_PATH]);
  const frame = frameOf(0);
  await ready(frame);

  const seen = await probeOf(frame);

  expect({
    theme: seen?.theme,
    font: seen?.font,
    bg: seen?.bg,
  }).toEqual({ theme: "dark", font: true, bg: "rgb(20, 20, 20)" });
});

it("a page with its own var parent still gets the theme and keeps Space", async () => {
  look("light");
  await browser.emulateMedia({ reducedMotion: "reduce" });
  await browser.servePage(OPTED_PATH, OWN_PARENT);
  render([OPTED_PATH]);
  const frame = frameOf(0);
  await ready(frame);

  toggleTheme();
  const seen = await probeOf(frame);
  expect(seen?.theme).toBe("dark");

  await userEvent.click(frame);
  await userEvent.keyboard(" ");
  await expect.poll(panelOf).not.toBeNull();

  expect(seen?.bg).toBe("rgb(20, 20, 20)");
});

it("two opted-in pages side by side both follow a switch", async () => {
  look("light");
  await browser.emulateMedia({ reducedMotion: "reduce" });
  await browser.servePage("left.html", OPTED);
  await browser.servePage("right.html", OPTED);
  render(["left.html", "right.html"]);
  await ready(frameOf(0));
  await ready(frameOf(1));

  toggleTheme();
  const left = await probeOf(frameOf(0));
  const right = await probeOf(frameOf(1));

  expect([left?.theme, right?.theme]).toEqual(["dark", "dark"]);
  expect([left?.bg, right?.bg]).toEqual(["rgb(20, 20, 20)", "rgb(20, 20, 20)"]);
});

it("at 390x844 with touch, an opted-in page follows a switch", async () => {
  await page.viewport(390, 844);
  await browser.emulateMedia({ touch: true, reducedMotion: "reduce" });
  look("light");
  await browser.servePage(OPTED_PATH, OPTED);
  render([OPTED_PATH], true);
  const frame = frameOf(0);
  await ready(frame);

  toggleTheme();
  const seen = await probeOf(frame);

  expect(seen?.theme).toBe("dark");
  expect(seen?.bg).toBe("rgb(20, 20, 20)");
});
