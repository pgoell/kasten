/// <reference types="node" />

import { readFileSync } from "node:fs";
import { EditorSelection } from "@codemirror/state";
import { vim } from "@replit/codemirror-vim";
import { fireEvent, waitFor } from "@testing-library/react";
import { pdfRenderer } from "@/lib/book/pdf-view";
import { embedSource } from "@/lib/embed";
import { imagePaths } from "@/lib/image";
import { livePreview } from "@/lib/live/live-preview";
import { vaultPaths } from "@/lib/wikilink";
import {
  ABOVE,
  FakeObserver,
  FakeResizer,
  fakePdfs,
  fakeVault,
  liveHooks,
  mount,
  PLAN,
  slotsOf,
  stalled,
  withPdfs,
} from "./live-preview-fixture";

liveHooks();

describe("a pdf embed", () => {
  beforeEach(() => {
    FakeObserver.all = [];
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    FakeResizer.all = [];
    vi.stubGlobal("ResizeObserver", FakeResizer);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("draws the pdf's pages in place in a viewer box", async () => {
    const pdfs = fakePdfs({ [PLAN]: 3 });
    const view = mount(`${ABOVE}![[plan.pdf]]`, withPdfs(fakeVault({}).source, pdfs));

    const slots = await slotsOf(view);
    expect(slots).toHaveLength(3);
    FakeObserver.reveal(slots[0] as HTMLElement);

    await waitFor(() => expect(slots[0]?.querySelector("canvas")).not.toBeNull());
    expect(view.contentDOM.textContent).not.toContain("![[");
  });

  it("finds docs/plan.pdf by the wikilink rule", () => {
    const vault = fakeVault({});
    const pdfs = fakePdfs({ [PLAN]: 1 });
    mount(`${ABOVE}![[Plan.pdf]]`, withPdfs(vault.source, pdfs));

    expect(pdfs.opened).toEqual([PLAN]);
    expect(vault.watched).toEqual([]);
  });

  it("keeps the pdf in a fixed-height box that scrolls", () => {
    const css = readFileSync("src/styles/app.css", "utf8");

    expect(css).toMatch(/\.cm-embed-pdf\s*{[^}]*\bheight:\s*\d/s);
    expect(css).toMatch(/\.cm-embed-pdf\s*{[^}]*overflow-y:\s*auto/s);
  });

  it("draws pages as they come into view, not all at once", async () => {
    const pdfs = fakePdfs({ [PLAN]: 3 });
    const view = mount(`${ABOVE}![[plan.pdf]]`, withPdfs(fakeVault({}).source, pdfs));
    const slots = await slotsOf(view);
    expect(pdfs.drawn).toEqual([]);

    FakeObserver.reveal(slots[1] as HTMLElement);

    await waitFor(() => expect(pdfs.drawn.map(([page]) => page)).toEqual([2]));
  });

  it("opens the pdf on ctrl or cmd and a click", () => {
    const vault = fakeVault({});
    const view = mount(`${ABOVE}![[plan.pdf]]`, withPdfs(vault.source, fakePdfs({ [PLAN]: 1 })));
    const box = view.dom.querySelector(".cm-embed-pdf") as HTMLElement;

    fireEvent.mouseDown(box, { ctrlKey: true });
    fireEvent.mouseDown(box, { metaKey: true });

    expect(vault.opened).toEqual([
      ["docs/plan.pdf", undefined],
      ["docs/plan.pdf", undefined],
    ]);
  });

  it("does nothing on a plain click", () => {
    const vault = fakeVault({});
    const view = mount(`${ABOVE}![[plan.pdf]]`, withPdfs(vault.source, fakePdfs({ [PLAN]: 1 })));
    const box = view.dom.querySelector(".cm-embed-pdf") as HTMLElement;

    fireEvent.pointerDown(box, { pointerType: "mouse" });
    fireEvent.mouseDown(box);
    fireEvent.click(box);

    expect(vault.opened).toEqual([]);
  });

  it("opens the pdf on a tap, and fits its pages to a phone-width box", async () => {
    const vault = fakeVault({});
    const pdfs = fakePdfs({ [PLAN]: 1 });
    const view = mount(`${ABOVE}![[plan.pdf]]`, withPdfs(vault.source, pdfs));
    const box = view.dom.querySelector(".cm-embed-pdf") as HTMLElement;

    fireEvent.pointerDown(box, { pointerType: "touch" });
    fireEvent.click(box);
    expect(vault.opened).toEqual([["docs/plan.pdf", undefined]]);

    Object.defineProperty(box, "clientWidth", { value: 360 });
    const [slot] = await slotsOf(view);
    FakeObserver.reveal(slot as HTMLElement);
    await waitFor(() => expect(pdfs.drawn).toEqual([[1, (360 / 600) * window.devicePixelRatio]]));
    await waitFor(() => expect(slot?.querySelector("canvas")?.style.width).toBe("100%"));
  });

  it("reads Not found where the vault holds no such pdf", () => {
    const vault = fakeVault({});
    const pdfs = fakePdfs({});
    const view = mount(`${ABOVE}![[x.pdf]]`, withPdfs(vault.source, pdfs));

    expect(view.dom.querySelector(".cm-embed-missing")?.textContent).toBe("Not found: x.pdf");
    expect(vault.watched).toEqual([]);
    expect(pdfs.opened).toEqual([]);
  });

  it("reads an error in the box where the pdf will not load", async () => {
    const view = mount(`${ABOVE}![[plan.pdf]]`, withPdfs(fakeVault({}).source, fakePdfs({})));

    await waitFor(() =>
      expect(view.dom.querySelector(".cm-embed-pdf")?.textContent).toBe("Could not read plan.pdf"),
    );
  });

  it("frees its pdf when it leaves the screen, and not on a keystroke", async () => {
    const pdfs = fakePdfs({ [PLAN]: 1 });
    const view = mount(`${ABOVE}![[plan.pdf]]`, withPdfs(fakeVault({}).source, pdfs));
    const box = view.dom.querySelector(".cm-embed-pdf");

    view.dispatch({ changes: { from: 0, insert: "more " } });
    expect(view.dom.querySelector(".cm-embed-pdf")).toBe(box);
    expect(pdfs.freed()).toBe(0);

    view.dispatch({ changes: { from: view.state.doc.length - 2, insert: "x" } });
    expect(view.dom.querySelector(".cm-embed-pdf")).toBeNull();
    expect(pdfs.freed()).toBe(1);
  });

  it("frees a page's drawing when it leaves view, and draws it again on return", async () => {
    const pdfs = fakePdfs({ [PLAN]: 2 });
    const view = mount(`${ABOVE}![[plan.pdf]]`, withPdfs(fakeVault({}).source, pdfs));
    const [slot] = (await slotsOf(view)) as [HTMLElement];

    FakeObserver.reveal(slot);
    await waitFor(() => expect(slot.querySelector("canvas")).not.toBeNull());
    const canvas = slot.querySelector("canvas") as HTMLCanvasElement;

    FakeObserver.hide(slot);
    expect(slot.querySelector("canvas")).toBeNull();
    expect(canvas.width).toBe(0);
    // The slot keeps the page's shape, so the box does not jump.
    expect(slot.style.aspectRatio).toBe("600 / 800");

    FakeObserver.reveal(slot);
    await waitFor(() => expect(slot.querySelector("canvas")).not.toBeNull());
    expect(pdfs.drawn).toEqual([
      [1, window.devicePixelRatio],
      [1, window.devicePixelRatio],
    ]);
  });

  it("frees every page's drawing when it leaves the screen", async () => {
    const pdfs = fakePdfs({ [PLAN]: 1 });
    const view = mount(`${ABOVE}![[plan.pdf]]`, withPdfs(fakeVault({}).source, pdfs));
    const [slot] = (await slotsOf(view)) as [HTMLElement];
    FakeObserver.reveal(slot);
    await waitFor(() => expect(slot.querySelector("canvas")).not.toBeNull());
    const canvas = slot.querySelector("canvas") as HTMLCanvasElement;

    view.dispatch({ changes: { from: view.state.doc.length - 2, insert: "x" } });

    expect(canvas.width).toBe(0);
  });

  it("opens only the pdf, not the note around it, from inside a note embed", () => {
    const vault = fakeVault({ "b.md": "b\n\n![[plan.pdf]]" });
    const view = stalled(() =>
      mount(`${ABOVE}![[b]]`, withPdfs(vault.source, fakePdfs({ [PLAN]: 1 }))),
    );
    const box = view.dom.querySelector(".cm-embed .cm-embed-pdf");
    expect(box).not.toBeNull();

    fireEvent.mouseDown(box as HTMLElement, { ctrlKey: true });
    fireEvent.pointerDown(box as HTMLElement, { pointerType: "touch" });
    fireEvent.click(box as HTMLElement);

    expect(vault.opened).toEqual([
      ["docs/plan.pdf", undefined],
      ["docs/plan.pdf", undefined],
    ]);
  });

  it("shows its source with the cursor on the line, vim off", () => {
    const pdfs = fakePdfs({ [PLAN]: 1 });
    const view = mount(`${ABOVE}![[plan.pdf]]`, withPdfs(fakeVault({}).source, pdfs));
    expect(view.dom.querySelector(".cm-embed-pdf")).not.toBeNull();

    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });

    expect(view.dom.querySelector(".cm-embed-pdf")).toBeNull();
    expect(view.contentDOM.textContent).toContain("![[plan.pdf]]");
  });

  it("keeps the cursor out of the source it hides, vim on", () => {
    const pdfs = fakePdfs({ [PLAN]: 1 });
    const doc = "![[plan.pdf]]\nplain";
    const view = mount(
      doc,
      [
        vim(),
        livePreview(),
        vaultPaths.of(["docs/plan.pdf"]),
        imagePaths.of([]),
        embedSource.of(fakeVault({}).source),
        pdfRenderer.of(pdfs.renderer),
      ],
      doc.indexOf("plain"),
    );
    expect(view.dom.querySelector(".cm-embed-pdf")).not.toBeNull();

    view.dispatch({ selection: EditorSelection.cursor(2) });

    expect(view.state.selection.main.head).toBe("![[plan.pdf]]".length);
  });
});
