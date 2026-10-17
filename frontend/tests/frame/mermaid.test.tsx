/**
 * ```` ```mermaid ```` blocks drawn as diagrams (#423).
 *
 * Mermaid lays a diagram out by measuring its text with `getBBox`, which jsdom
 * does not have, so anything that needs a drawing is answered here in a real
 * browser. Mounted bare with what the editor draws a note with.
 */

import { history, undo } from "@codemirror/commands";
import { EditorState, type Extension } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
// For its types alone: the provider is what gives `cdp()` a typed `send`.
import type {} from "@vitest/browser-playwright";
import { createRoot, type Root } from "react-dom/client";
import { cdp, page, userEvent } from "vitest/browser";
import { NotePreview } from "@/components/note-preview";
import { imagePaths } from "@/lib/image";
import { livePreview, renderedMarkdown } from "@/lib/live-preview";
import { noteLanguage } from "@/lib/note-language";
import { vimKeys } from "@/lib/vim-mode";
import { vaultPaths } from "@/lib/wikilink";
import "@/styles/app.css";

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

const FLOW = ["flowchart TD", "  A[Start] --> B[Done]"];
/** A line of prose, a diagram and a line under it, the cursor starting on the prose. */
const NOTE = ["before", "", "```mermaid", ...FLOW, "```", "", "after"].join("\n");

function mount(doc: string, vimOn: boolean, anchor = 0, extra: Extension[] = []): EditorView {
  const parent = document.body.appendChild(document.createElement("div"));
  view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor },
      extensions: [
        noteLanguage(),
        oneDark,
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

function diagram(at: EditorView): SVGSVGElement | null {
  return at.dom.querySelector(".cm-mermaid-block svg");
}

/** The lines on the screen, leaving out the diagram's svg and its style sheet. */
function text(at: EditorView): string {
  return [...at.contentDOM.querySelectorAll(".cm-line")].map((line) => line.textContent).join("\n");
}

describe.each([
  ["off", false],
  ["on", true],
] as const)("mermaid, vim %s", (_, vimOn) => {
  it(`A1 draws a mermaid block as a diagram, vim ${vimOn ? "on" : "off"}`, async () => {
    const at = mount(NOTE, vimOn);

    await expect.poll(() => diagram(at)).not.toBeNull();
    expect(diagram(at)?.textContent).toContain("Start");
    expect(text(at)).not.toContain("flowchart");
    expect(text(at)).not.toContain("```");
  });

  it(`A4 shows the source with the cursor inside, vim ${vimOn ? "on" : "off"}`, async () => {
    // A second diagram nested in a list item: a block widget covers whole
    // lines, and this one starts partway into its first, so it shows its source.
    const nested = ["- item", "", "  ```mermaid", "  flowchart TD", "  X --> Y", "  ```"];
    const at = mount(`${NOTE}\n\n${nested.join("\n")}`, vimOn);
    await expect.poll(() => diagram(at)).not.toBeNull();
    expect(at.dom.querySelectorAll(".cm-mermaid-block")).toHaveLength(1);
    expect(text(at)).toContain("X --> Y");

    at.dispatch({ selection: { anchor: NOTE.indexOf("A[Start]") } });
    expect(at.dom.querySelector(".cm-mermaid-block")).toBeNull();
    expect(text(at)).toContain("A[Start] --> B[Done]");

    at.dispatch({ selection: { anchor: 0 } });
    await expect.poll(() => diagram(at)).not.toBeNull();
  });

  it(`A7 a click on a diagram puts the cursor in it, vim ${vimOn ? "on" : "off"}`, async () => {
    const at = mount(NOTE, vimOn);
    await expect.poll(() => diagram(at)).not.toBeNull();

    await userEvent.click(diagram(at) as SVGSVGElement);

    const from = NOTE.indexOf("```mermaid");
    const to = NOTE.lastIndexOf("```") + 3;
    await expect.poll(() => at.state.selection.main.head).toBeGreaterThanOrEqual(from);
    expect(at.state.selection.main.head).toBeLessThanOrEqual(to);
    expect(at.dom.querySelector(".cm-mermaid-block")).toBeNull();
    expect(text(at)).toContain("A[Start] --> B[Done]");
  });
});

it("A5 shows the error and the source of a bad diagram, never a blank", async () => {
  const unknown = "not a diagram at all";
  const broken = "flowchart TD\n  A[Start --> (";
  const doc = ["before", "", "```mermaid", unknown, "```", "", "```mermaid", broken, "```"];
  const at = mount(doc.join("\n"), false);

  await expect.poll(() => at.dom.querySelectorAll(".cm-mermaid-error").length).toBe(2);
  const errors = [...at.dom.querySelectorAll(".cm-mermaid-error")];
  for (const error of errors) expect(error.textContent?.trim()).not.toBe("");
  const sources = [...at.dom.querySelectorAll(".cm-mermaid-source")].map((pre) => pre.textContent);
  expect(sources).toEqual([unknown, broken]);
  // Mermaid works in a scratch element under the body and draws its own error
  // picture there unless told not to. Neither may be left behind.
  expect(document.body.querySelector('[id^="dkasten-mermaid"], [id^="kasten-mermaid"]')).toBeNull();
  expect(document.body.querySelector(":scope > svg")).toBeNull();
});

it("A9 a read-only preview pane draws a diagram", async () => {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  root.render(<NotePreview text={NOTE} />);

  await expect.poll(() => host?.querySelector(".cm-mermaid-block svg") ?? null).not.toBeNull();
});

it("A10 draws in the dark, centred, with no white box", async () => {
  const at = mount(NOTE, false);
  await expect.poll(() => diagram(at)).not.toBeNull();
  const svg = diagram(at) as SVGSVGElement;
  const block = svg.closest(".cm-mermaid-block") as HTMLElement;

  const white = "rgb(255, 255, 255)";
  expect(getComputedStyle(svg).backgroundColor).not.toBe(white);
  const node = svg.querySelector(".node rect, .node polygon") as SVGElement;
  expect(getComputedStyle(node).fill).not.toBe(white);
  const box = block.getBoundingClientRect();
  const drawn = svg.getBoundingClientRect();
  expect(Math.abs(drawn.left + drawn.width / 2 - (box.left + box.width / 2))).toBeLessThan(2);
});

it("I1 runs no script or click handler an agent wrote into a diagram", async () => {
  const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
  const source = [
    "flowchart TD",
    '  A["<img src=x onerror=alert(1)>"] --> B[Done]',
    "  click A call alert()",
    '  click B href "javascript:alert(2)"',
  ];
  const at = mount(["before", "", "```mermaid", ...source, "```"].join("\n"), false);
  await expect.poll(() => diagram(at)).not.toBeNull();

  const svg = diagram(at) as SVGSVGElement;
  for (const element of svg.querySelectorAll("*")) {
    for (const attribute of element.attributes) {
      expect(attribute.name.startsWith("on"), `${element.tagName} ${attribute.name}`).toBe(false);
      expect(attribute.value).not.toMatch(/^javascript:/i);
    }
  }
  await userEvent.click(svg.querySelector(".node") as Element);
  expect(alert).not.toHaveBeenCalled();
  alert.mockRestore();
});

it("I2 a read-only view draws the diagram its selection sits at the start of", async () => {
  const doc = ["```mermaid", ...FLOW, "```"].join("\n");
  const parent = document.body.appendChild(document.createElement("div"));
  view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [noteLanguage(), renderedMarkdown(), EditorState.readOnly.of(true)],
    }),
    parent,
  });

  await expect.poll(() => diagram(view as EditorView)).not.toBeNull();
});

it("I3 redraws an edited diagram and undo brings the old drawing back", async () => {
  const at = mount(NOTE, false, 0, [history()]);
  await expect.poll(() => diagram(at)?.textContent ?? "").toContain("Start");

  const from = NOTE.indexOf("Start");
  at.dispatch({ changes: { from, to: from + 5, insert: "Begin" } });
  await expect.poll(() => diagram(at)?.textContent ?? "").toContain("Begin");

  undo(at);
  // Drawn once already, so the old drawing is back at once rather than redrawn.
  expect(diagram(at)?.textContent).toContain("Start");
});

it("I7 measures the note again when the svg lands, so no line sits under it", async () => {
  const at = mount(NOTE, false);
  await expect.poll(() => diagram(at)).not.toBeNull();

  const after = NOTE.lastIndexOf("after");
  const line = [...at.contentDOM.querySelectorAll(".cm-line")].at(-1) as HTMLElement;
  expect(line.textContent).toBe("after");
  // The height map is what the gutter and a click read, and it agrees with
  // the screen only once the editor measured the block with the svg in it,
  // which is a hundred pixels and more for this one.
  await expect
    .poll(() =>
      Math.abs(at.lineBlockAt(after).top + at.documentTop - line.getBoundingClientRect().top),
    )
    .toBeLessThan(2);
});

it.runIf(import.meta.env.VITE_KASTEN_SHOTS)("takes screenshots of diagrams and math", async () => {
  const doc = [
    "# Diagrams and math",
    "",
    "```mermaid",
    "flowchart LR",
    "  A[Write] --> B{Draws?}",
    "  B -->|yes| C[Read]",
    "  B -->|no| D[Fix]",
    "```",
    "",
    "Euler: $e^{i\\pi}+1=0$ inline.",
    "",
    "$$\\int_0^1 x^2\\,dx$$",
    "",
    "```mermaid",
    "flowchart TD",
    "  A[Start --> (",
    "```",
    "",
    "A price line: $5 and $6.",
  ].join("\n");
  // Under the test file, which vite's `server.fs` lets the browser write to,
  // and in a folder git ignores.
  const dir = "../../node_modules/.cache/kasten-shots";
  // The runner shrinks the test's frame to fit the box it sits in, and a
  // screenshot comes out at the shrunk size. A window this large holds both.
  await cdp().send("Emulation.setDeviceMetricsOverride", {
    width: 1600,
    height: 1400,
    deviceScaleFactor: 1,
    mobile: false,
  });
  for (const [name, width] of [
    ["desktop", 1200],
    ["phone", 390],
  ] as const) {
    await page.viewport(width, 680);
    // Wrapped, as the editor and the panes are, or the longest line sets the
    // width and a phone shows the left of it.
    const at = mount(doc, false, 0, [EditorView.lineWrapping]);
    at.dom.style.background = "#282c34";
    await expect.poll(() => at.dom.querySelectorAll(".cm-mermaid-block svg").length).toBe(1);
    await expect.poll(() => at.dom.querySelectorAll(".cm-mermaid-error").length).toBe(1);
    await page.screenshot({ path: `${dir}/mermaid-math-${name}.png`, element: at.dom });
    at.dom.parentElement?.remove();
    at.destroy();
    view = undefined;
  }
  await cdp().send("Emulation.clearDeviceMetricsOverride");
});
