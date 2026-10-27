/**
 * A raw `<svg>` in a note, drawn as its picture (#952). Mounted bare with what
 * the editor draws a note with, as the mermaid frame test is.
 */

import { history, undo } from "@codemirror/commands";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import { createRoot, type Root } from "react-dom/client";
import { page, userEvent } from "vitest/browser";
import { NotePreview } from "@/components/note-preview";
import { kastenTheme } from "@/lib/editor/editor-theme";
import { vimKeys } from "@/lib/editor/vim-mode";
import { imagePaths } from "@/lib/image";
import { livePreview, renderedMarkdown } from "@/lib/live/live-preview";
import { noteLanguage } from "@/lib/note-language";
import { applyTheme, THEME_KEY } from "@/lib/theme";
import { vaultPaths } from "@/lib/wikilink";
import "@/styles/app.css";
import { shot } from "./shots";

let view: EditorView | undefined;
let root: Root | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  view?.dom.parentElement?.remove();
  view?.destroy();
  view = undefined;
  root?.unmount();
  root = undefined;
  host?.remove();
  host = undefined;
});

// A made-up chart, three boxes and two arrows. The open tag stands alone on its
// first line, which is what makes the parser read it as a block.
const CHART = [
  '<svg viewBox="0 0 420 80" width="420" height="80">',
  "  <defs>",
  '    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">',
  '      <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />',
  "    </marker>",
  "  </defs>",
  '  <rect x="5" y="20" width="100" height="40" rx="6" fill="none" stroke="currentColor" stroke-width="2" />',
  '  <text x="55" y="45" text-anchor="middle" fill="currentColor">Plan</text>',
  '  <path d="M 105 40 L 155 40" fill="none" stroke="currentColor" stroke-width="2" marker-end="url(#arrow)" />',
  '  <rect x="160" y="20" width="100" height="40" rx="6" fill="none" stroke="currentColor" stroke-width="2" />',
  '  <text x="210" y="45" text-anchor="middle" fill="currentColor">Build</text>',
  '  <path d="M 260 40 L 310 40" fill="none" stroke="currentColor" stroke-width="2" marker-end="url(#arrow)" />',
  '  <rect x="315" y="20" width="100" height="40" rx="6" fill="none" stroke="currentColor" stroke-width="2" />',
  '  <text x="365" y="45" text-anchor="middle" fill="currentColor">Ship</text>',
  "</svg>",
].join("\n");
const ONE_LINE =
  '<svg viewBox="0 0 40 40" width="40" height="40"><circle cx="20" cy="20" r="15" fill="currentColor" /></svg>';
const NESTED =
  '<svg viewBox="0 0 40 40" width="40" height="40"><circle cx="20" cy="20" r="8" fill="currentColor" /></svg>';
const TWO_LINES = [
  '<svg viewBox="0 0 40 40"',
  '  width="40" height="40">',
  '  <circle cx="20" cy="20" r="6" fill="currentColor" />',
  "</svg>",
].join("\n");
/** A line of prose, the chart between blank lines, the cursor starting on the prose. */
const NOTE = ["before", "", CHART, "", "after"].join("\n");

function mount(doc: string, vimOn: boolean, anchor = 0, extra: Extension[] = []): EditorView {
  const parent = document.body.appendChild(document.createElement("div"));
  view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor },
      extensions: [
        noteLanguage(),
        kastenTheme,
        vimOn ? vim() : vimKeys.of(false),
        livePreview(),
        vaultPaths.of([]),
        imagePaths.of([]),
        extra,
      ],
    }),
    parent,
  });
  return view;
}

function picture(within: ParentNode | null | undefined): SVGSVGElement | null {
  return within?.querySelector<SVGSVGElement>(".cm-svg-block svg") ?? null;
}

/** The lines on the screen, leaving out the drawn pictures. */
function text(at: EditorView): string {
  return [...at.contentDOM.querySelectorAll(".cm-line")].map((line) => line.textContent).join("\n");
}

it.each([
  ["off", false],
  ["on", true],
] as const)("#952 A1 draws an svg block as its picture, vim %s", async (_, vimOn) => {
  const doc = [
    "before",
    "",
    CHART,
    "",
    ONE_LINE,
    "",
    TWO_LINES,
    "",
    "- item",
    "",
    `  ${NESTED}`,
    "",
    `text ${NESTED} text`,
  ].join("\n");
  const at = mount(doc, vimOn);

  await expect.poll(() => at.dom.querySelectorAll(".cm-svg-block svg").length).toBe(3);
  expect(at.dom.querySelectorAll(".cm-svg-block")).toHaveLength(3);
  // The nested svg and the one mid-paragraph are source on the lines.
  expect(text(at)).toContain(NESTED);
  expect(text(at)).toContain(`text ${NESTED} text`);
  // The top-level one-line svg is drawn, so its source is not on any line.
  expect(text(at)).not.toContain('r="15"');
  expect(text(at)).not.toContain("Plan");
});

it.each([
  ["off", false],
  ["on", true],
] as const)("#952 A2 shows the source with the cursor inside, vim %s", async (_, vimOn) => {
  const at = mount(NOTE, vimOn);
  await expect.poll(() => picture(at.dom)).not.toBeNull();

  at.dispatch({ selection: { anchor: NOTE.indexOf("Build") } });
  expect(picture(at.dom)).toBeNull();
  expect(text(at)).toContain('marker-end="url(#arrow)"');

  at.dispatch({ selection: { anchor: 0 } });
  await expect.poll(() => picture(at.dom)).not.toBeNull();
});

it.each([
  ["off", false],
  ["on", true],
] as const)("#952 A2 a click on the picture puts the cursor in it, vim %s", async (_, vimOn) => {
  const at = mount(NOTE, vimOn);
  await expect.poll(() => picture(at.dom)).not.toBeNull();

  await userEvent.click(picture(at.dom) as SVGSVGElement);

  const from = NOTE.indexOf(CHART);
  const to = from + CHART.length;
  await expect.poll(() => at.state.selection.main.head).toBeGreaterThanOrEqual(from);
  expect(at.state.selection.main.head).toBeLessThanOrEqual(to);
  expect(picture(at.dom)).toBeNull();
  expect(text(at)).toContain('marker-end="url(#arrow)"');
});

it("#952 A3 a read-only preview pane draws the svg", async () => {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  root.render(<NotePreview text={NOTE} />);

  await expect.poll(() => picture(host)).not.toBeNull();
});

it("#952 A3 a read-only view draws the svg", async () => {
  const parent = document.body.appendChild(document.createElement("div"));
  view = new EditorView({
    state: EditorState.create({
      doc: CHART,
      extensions: [noteLanguage(), renderedMarkdown(), EditorState.readOnly.of(true)],
    }),
    parent,
  });

  await expect.poll(() => picture(view?.dom)).not.toBeNull();
});

it("#952 A4 currentColor follows the ink token in light and dark", async () => {
  const at = mount(NOTE, false);
  await expect.poll(() => picture(at.dom)).not.toBeNull();
  const connector = picture(at.dom)?.querySelector("path[marker-end]") as SVGElement;
  const probe = document.body.appendChild(document.createElement("span"));
  probe.style.color = "var(--k-ink)";

  const seen: { theme: string; stroke: string; ink: string }[] = [];
  try {
    for (const theme of ["light", "dark"] as const) {
      localStorage.setItem(THEME_KEY, theme);
      applyTheme();
      seen.push({
        theme,
        stroke: getComputedStyle(connector).stroke,
        ink: getComputedStyle(probe).color,
      });
    }
  } finally {
    probe.remove();
    localStorage.removeItem(THEME_KEY);
    applyTheme();
  }
  for (const { stroke, ink } of seen) expect(stroke).toBe(ink);
  expect(new Set(seen.map(({ stroke }) => stroke)).size).toBe(2);
});

it("#952 A7 the picture fits the note at phone width", async () => {
  try {
    await page.viewport(414, 896);
    const at = mount(NOTE, false, 0, [EditorView.lineWrapping]);
    await expect.poll(() => picture(at.dom)).not.toBeNull();

    const svg = picture(at.dom) as SVGSVGElement;
    const block = svg.closest(".cm-svg-block") as HTMLElement;
    expect(svg.getBoundingClientRect().width).toBeGreaterThan(0);
    expect(svg.getBoundingClientRect().width).toBeLessThanOrEqual(
      block.getBoundingClientRect().width,
    );
  } finally {
    await page.viewport(414, 896);
  }
});

it("#952 I1 an svg with nothing to draw shows its source", async () => {
  const bare = "<svg><script>alert(1)</script></svg>";
  const at = mount(["before", "", bare, "", "after"].join("\n"), false);

  await expect.poll(() => at.dom.querySelector(".cm-svg-error")).not.toBeNull();
  expect(at.dom.querySelector(".cm-svg-source")?.textContent).toBe(bare);
  expect(picture(at.dom)).toBeNull();
});

it("#952 I2 redraws an edited svg and undo brings the old picture back", async () => {
  const at = mount(NOTE, false, 0, [history()]);
  await expect.poll(() => picture(at.dom)?.textContent ?? "").toContain("Plan");

  const from = NOTE.indexOf("Plan");
  at.dispatch({ changes: { from, to: from + 4, insert: "Draft" } });
  await expect.poll(() => picture(at.dom)?.textContent ?? "").toContain("Draft");

  undo(at);
  await expect.poll(() => picture(at.dom)?.textContent ?? "").toContain("Plan");
});

it("#952 A5 no alert fires from an attack svg in a real browser", async () => {
  const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
  try {
    const attack = [
      '<svg viewBox="0 0 200 80" width="200" height="80" onload="alert(1)">',
      "  <script>alert(2)</script>",
      '  <foreignObject width="200" height="40"><div xmlns="http://www.w3.org/1999/xhtml" onclick="alert(3)">x</div></foreignObject>',
      '  <use href="javascript:alert(4)" />',
      '  <rect width="20" height="20" fill="currentColor"><animate attributeName="href" to="javascript:alert(5)" dur="1s" /></rect>',
      '  <path d="M 10 70 L 190 70" stroke="currentColor" stroke-width="2" />',
      "</svg>",
    ].join("\n");
    const at = mount(["before", "", attack, "", "after"].join("\n"), false);
    await expect.poll(() => picture(at.dom)).not.toBeNull();

    await userEvent.click(picture(at.dom) as SVGSVGElement);
    expect(alert).not.toHaveBeenCalled();
  } finally {
    alert.mockRestore();
  }
});

it.runIf(import.meta.env.VITE_KASTEN_SHOTS)(
  "#952 A7 takes pictures of the svg in Read mode in light and dark at 414 and 1440",
  async () => {
    try {
      for (const width of [1440, 414]) {
        await page.viewport(width, 900);
        for (const theme of ["light", "dark"] as const) {
          localStorage.setItem(THEME_KEY, theme);
          applyTheme();
          const box = document.body.appendChild(document.createElement("div"));
          box.style.background = "var(--k-bg)";
          host = box;
          root = createRoot(box);
          root.render(<NotePreview text={NOTE} />);
          await expect.poll(() => picture(box)).not.toBeNull();
          expect(await shot(box, `inline-svg-${theme}-${width}`)).toBe(width);
          root.unmount();
          root = undefined;
          box.remove();
          host = undefined;
        }
      }
    } finally {
      localStorage.removeItem(THEME_KEY);
      applyTheme();
      await page.viewport(414, 896);
    }
  },
);
