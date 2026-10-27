/**
 * An inline svg block draws only what survives the sanitizer (#952).
 *
 * The attacks go through the mounted editor, so each test reads the picture the
 * page shows, not what the cutter returns.
 */

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { imagePaths } from "@/lib/image";
import { livePreview } from "@/lib/live-preview";
import { noteLanguage } from "@/lib/note-language";
import { vimKeys } from "@/lib/vim-mode";
import { vaultPaths } from "@/lib/wikilink";

/** A value a picture must never carry: a script, a data or http address, an import, or a url outside the block. */
const ATTACK = /javascript:|data:|https?:|@import|url\((?!#)/i;

/** The benign shape every case draws next to its attack. */
const PATH = '<path d="M0 0 L10 10" stroke="currentColor"/>';

let view: EditorView | undefined;

afterEach(() => {
  view?.dom.parentElement?.remove();
  view?.destroy();
  view = undefined;
  document.getElementById("outside")?.remove();
});

function mount(svg: string): EditorView {
  const parent = document.body.appendChild(document.createElement("div"));
  view = new EditorView({
    state: EditorState.create({
      doc: `before\n\n${svg}`,
      extensions: [
        noteLanguage(),
        vimKeys.of(false),
        livePreview(),
        vaultPaths.of([]),
        imagePaths.of([]),
      ],
    }),
    parent,
  });
  return view;
}

/** The picture drawn for an svg block, once it is on the page. */
function drawn(svg: string): Promise<Element> {
  const at = mount(svg);
  return vi.waitFor(() => {
    const picture = at.dom.querySelector(".cm-svg-block svg");
    expect(picture).not.toBeNull();
    return picture as Element;
  });
}

/** Fails on an on* attribute, a script-like value or a banned element anywhere in the picture. */
function expectSafe(picture: Element) {
  for (const el of [picture, ...Array.from(picture.querySelectorAll("*"))]) {
    for (const attr of Array.from(el.attributes)) {
      expect(attr.name.startsWith("on"), attr.name).toBe(false);
      expect(attr.value, attr.name).not.toMatch(ATTACK);
    }
  }
  for (const tag of ["script", "foreignObject", "animate", "set", "style"]) {
    expect(picture.querySelector(tag), tag).toBeNull();
  }
}

it("#952 A5 drops an onload handler on the svg", async () => {
  const picture = await drawn(`<svg viewBox="0 0 20 20" onload="alert(1)">${PATH}</svg>`);

  expect(picture.querySelector("path")).not.toBeNull();
  expectSafe(picture);
});

it("#952 A5 drops a script element inside the svg", async () => {
  const picture = await drawn(`<svg viewBox="0 0 20 20">${PATH}<script>alert(1)</script></svg>`);

  expect(picture.querySelector("path")).not.toBeNull();
  expectSafe(picture);
});

it("#952 A5 drops a foreignObject with its html and handlers", async () => {
  const picture = await drawn(
    `<svg viewBox="0 0 20 20">${PATH}<foreignObject><div onclick="alert(1)">x</div></foreignObject></svg>`,
  );

  expect(picture.querySelector("path")).not.toBeNull();
  expect(picture.querySelector("div")).toBeNull();
  expectSafe(picture);
});

it("#952 A5 drops a use with a javascript href", async () => {
  const picture = await drawn(
    `<svg viewBox="0 0 20 20">${PATH}<use href="javascript:alert(1)"/></svg>`,
  );

  expect(picture.querySelector("path")).not.toBeNull();
  expectSafe(picture);
});

it("#952 A5 drops a use with a data xlink href", async () => {
  const picture = await drawn(
    `<svg xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 20 20">${PATH}<use xlink:href="data:image/svg+xml;base64,PHN2Zz4="/></svg>`,
  );

  expect(picture.querySelector("path")).not.toBeNull();
  expectSafe(picture);
});

it("#952 A5 drops a use with an outside https href", async () => {
  const picture = await drawn(
    `<svg viewBox="0 0 20 20">${PATH}<use href="https://evil.example/x.svg#a"/></svg>`,
  );

  expect(picture.querySelector("path")).not.toBeNull();
  expectSafe(picture);
});

it("#952 A5 drops an animate and a set that aim at an href", async () => {
  const picture = await drawn(
    `<svg viewBox="0 0 20 20">${PATH}<animate attributeName="href" to="javascript:alert(1)"/><set attributeName="href" to="javascript:alert(1)"/></svg>`,
  );

  expect(picture.querySelector("path")).not.toBeNull();
  expectSafe(picture);
});

it("#952 A5 drops a url in a style attribute", async () => {
  const picture = await drawn(
    `<svg viewBox="0 0 20 20">${PATH}<rect style="fill: url(https://evil.example/x)" x="0" y="0" width="5" height="5"/></svg>`,
  );

  expect(picture.querySelector("path")).not.toBeNull();
  expectSafe(picture);
});

it("#952 A5 drops an import in a style attribute", async () => {
  const picture = await drawn(
    `<svg viewBox="0 0 20 20">${PATH}<rect style="@import url(https://evil.example/x.css)" x="0" y="0" width="5" height="5"/></svg>`,
  );

  expect(picture.querySelector("path")).not.toBeNull();
  expectSafe(picture);
});

it("#952 A5 drops a style element inside the svg", async () => {
  const picture = await drawn(
    `<svg viewBox="0 0 20 20">${PATH}<style>body { display: none }</style></svg>`,
  );

  expect(picture.querySelector("path")).not.toBeNull();
  expectSafe(picture);
});

it("#952 A5 drops a use pointing at an id outside the block", async () => {
  const outside = document.body.appendChild(document.createElement("div"));
  outside.id = "outside";

  const picture = await drawn(`<svg viewBox="0 0 20 20">${PATH}<use href="#outside"/></svg>`);

  expect(picture.querySelector("path")).not.toBeNull();
  expect(picture.querySelector("use")?.hasAttribute("href")).toBe(false);
  expectSafe(picture);
});

it("#952 I3 keeps fill from a style attribute but no position", async () => {
  const picture = await drawn(
    `<svg viewBox="0 0 20 20">${PATH}<rect style="position: fixed; inset: 0; fill: red" x="0" y="0" width="5" height="5"/></svg>`,
  );

  expect(picture.querySelector("path")).not.toBeNull();
  expect(picture.querySelector("rect")?.getAttribute("style")).toBe("fill: red");
});

it("#952 A6 keeps the arrowheads of a flow chart", async () => {
  const picture = await drawn(
    `<svg viewBox="0 0 200 60"><defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto"><path d="M0,0 L9,3 L0,6 z" fill="currentColor"/></marker></defs><path d="M10 30 L150 30" stroke="currentColor" marker-end="url(#arrow)"/><text x="10" y="20" fill="currentColor">Start</text></svg>`,
  );

  expect(picture.querySelector("marker")?.getAttribute("id")).toBe("arrow");
  expect(picture.querySelector('path[d="M10 30 L150 30"]')?.getAttribute("marker-end")).toBe(
    "url(#arrow)",
  );
  expect(picture.querySelector("text")?.textContent).toBe("Start");
});

it("#952 A5 a use pointing inside the block keeps its href", async () => {
  const picture = await drawn(
    `<svg viewBox="0 0 20 20"><defs><circle id="dot" r="2"/></defs>${PATH}<use href="#dot"/></svg>`,
  );

  expect(picture.querySelector("path")).not.toBeNull();
  expect(picture.querySelector("use")?.getAttribute("href")).toBe("#dot");
});
