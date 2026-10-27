/**
 * An inline svg block draws only what survives the sanitizer (#952).
 *
 * The attacks go through the mounted editor, so each test reads the picture the
 * page shows, not what the cutter returns.
 */

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { vimKeys } from "@/lib/editor/vim-mode";
import { imagePaths } from "@/lib/image";
import { livePreview } from "@/lib/live/live-preview";
import { noteLanguage } from "@/lib/note-language";
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
  document.getElementById("icon")?.remove();
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

  // Ids carry the block's prefix, so the marker is found by its name's end, and the ref is checked against that id.
  const id = picture.querySelector("marker")?.getAttribute("id");
  expect(id).toMatch(/arrow$/);
  expect(picture.querySelector('path[d="M10 30 L150 30"]')?.getAttribute("marker-end")).toBe(
    `url(#${id})`,
  );
  expect(picture.querySelector("text")?.textContent).toBe("Start");
});

it("#952 A5 a use pointing inside the block keeps its href", async () => {
  const picture = await drawn(
    `<svg viewBox="0 0 20 20"><defs><circle id="dot" r="2"/></defs>${PATH}<use href="#dot"/></svg>`,
  );

  expect(picture.querySelector("path")).not.toBeNull();
  const dot = picture.querySelector("circle")?.getAttribute("id");
  expect(dot).toMatch(/dot$/);
  expect(picture.querySelector("use")?.getAttribute("href")).toBe(`#${dot}`);
});

it("#952 A5 a use whose id also sits outside the block draws the block's own", async () => {
  const outside = document.body.appendChild(document.createElement("div"));
  outside.id = "icon";

  const picture = await drawn(
    `<svg viewBox="0 0 20 20"><defs><circle id="icon" r="2"/></defs><use href="#icon"/></svg>`,
  );

  const href = picture.querySelector("use")?.getAttribute("href") ?? "";
  const id = href.slice(1);
  expect(href.startsWith("#")).toBe(true);
  expect(id).not.toBe("icon");
  expect(picture.querySelector(`[id="${id}"]`)).not.toBeNull();
});

it("#952 A5 an id in the svg does not clobber a window global", async () => {
  await drawn(`<svg viewBox="0 0 20 20"><g id="process"><path d="M0 0"/></g></svg>`);

  expect(document.getElementById("process")).toBeNull();
  expect(Reflect.get(window, "process") instanceof Element).toBe(false);
});

it("#952 A5 drops a transform on the root svg", async () => {
  const picture = await drawn(
    `<svg viewBox="0 0 20 20" transform="translate(50 50)" x="10" y="10">${PATH}</svg>`,
  );

  expect(picture.querySelector("path")).not.toBeNull();
  expect(picture.hasAttribute("transform")).toBe(false);
  expect(picture.hasAttribute("x")).toBe(false);
  expect(picture.hasAttribute("y")).toBe(false);
});

it("#952 A5 drops a use that points at another use", async () => {
  const picture = await drawn(
    `<svg viewBox="0 0 20 20"><g id="a">${PATH}</g><g id="b"><use href="#a"/><use href="#a"/></g><use href="#b"/></svg>`,
  );

  const top = Array.from(picture.children).find((el) => el.localName === "use");
  expect(top?.hasAttribute("href")).toBe(false);
  const inner = Array.from(picture.querySelectorAll("g > use"));
  expect(inner.length).toBe(2);
  for (const use of inner) expect(use.hasAttribute("href")).toBe(true);
});

it("#952 A5 drops a url ref with a no-break space", async () => {
  const picture = await drawn(
    `<svg viewBox="0 0 20 20"><mask id="m"><path d="M0 0 L5 5"/></mask>${PATH}<rect x="0" y="0" width="5" height="5" mask="url( #m)"/></svg>`,
  );

  expect(picture.querySelector("rect")?.hasAttribute("mask")).toBe(false);
});

it("#952 A5 drops element and var functions in a style", async () => {
  const picture = await drawn(
    `<svg viewBox="0 0 20 20">${PATH}<rect style="fill: var(--k-ink); mask: -moz-element(#x)" x="0" y="0" width="5" height="5"/></svg>`,
  );

  expect(picture.querySelector("rect")?.getAttribute("style") ?? "").not.toMatch(
    /var\(|moz-element/,
  );
});

it("#952 A1 two svgs in one block show the source", async () => {
  const one = `<svg viewBox="0 0 20 20">${PATH}</svg>`;
  const two = `<svg viewBox="0 0 20 20"><circle r="2"/></svg>`;
  const at = mount(`${one}\n${two}`);

  await vi.waitFor(() => expect(at.dom.querySelector(".cm-svg-error")).not.toBeNull());
  expect(at.dom.querySelector(".cm-svg-source")?.textContent).toBe(`${one}\n${two}`);
  expect(at.dom.querySelector(".cm-svg-block svg")).toBeNull();
});

it("#952 I1 an svg whose only content is a nested script shows its source", async () => {
  const at = mount(`<svg><g><script>alert(1)</script></g></svg>`);

  await vi.waitFor(() => expect(at.dom.querySelector(".cm-svg-error")).not.toBeNull());
});

it("#952 I1 an svg that only draws inside defs shows its source", async () => {
  const at = mount(`<svg viewBox="0 0 9 9"><defs><path d="M0 0h9v9z"/></defs></svg>`);

  await vi.waitFor(() => expect(at.dom.querySelector(".cm-svg-error")).not.toBeNull());
});

it("#952 A5 a duplicate id cannot hide a use chain", async () => {
  const picture = await drawn(
    `<svg viewBox="0 0 9 9"><g id="l0"><path d="M0 0h9v9z"/></g><g id="l1"><use href="#l0"/><use href="#l0"/></g><rect id="l1" width="1" height="1"/><use href="#l1"/></svg>`,
  );

  const uses = Array.from(picture.children).filter((el) => el.localName === "use");
  expect(uses[uses.length - 1]?.hasAttribute("href")).toBe(false);
  const named = Array.from(picture.querySelectorAll("[id]")).filter((el) =>
    (el.getAttribute("id") ?? "").endsWith("l1"),
  );
  expect(named).toHaveLength(1);
});

it("#952 A5 drops a mask chain", async () => {
  const picture = await drawn(
    `<svg viewBox="0 0 9 9"><defs><mask id="m2"><rect width="9" height="9" fill="white"/></mask><mask id="m1"><rect width="9" height="9" fill="white" mask="url(#m2)"/></mask></defs><rect width="9" height="9" mask="url(#m1)"/></svg>`,
  );

  const inner = picture.querySelectorAll("mask rect");
  expect(inner).toHaveLength(2);
  expect(inner[1]?.hasAttribute("mask")).toBe(false);
  const top = Array.from(picture.children).find((el) => el.localName === "rect");
  expect(top?.hasAttribute("mask")).toBe(true);
});

it("#952 A5 keeps an oklch fill", async () => {
  const picture = await drawn(
    `<svg viewBox="0 0 9 9"><rect width="9" height="9" fill="oklch(70% 0.1 200)"/></svg>`,
  );

  expect(picture.querySelector("rect")?.getAttribute("fill")).toBe("oklch(70% 0.1 200)");
});
