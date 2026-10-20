import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import { fireEvent, waitFor } from "@testing-library/react";
import { type EmbedSource, embedSource } from "@/lib/embed";
import { imagePaths } from "@/lib/image";
import { livePreview } from "@/lib/live-preview";
import { pdfRenderer } from "@/lib/pdf-view";
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

  describe("at a #page", () => {
    beforeEach(() => {
      // jsdom lays nothing out, so every offsetTop is 0. Here a slot sits 800
      // below the one before it, as a 600 by 800 page would.
      vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (
        this: HTMLElement,
      ) {
        return [...(this.parentElement?.children ?? [])].indexOf(this) * 800;
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    /** Vim on, the cursor on the line above, on the vault `withPdfs` holds. */
    function withPdfsVim(source: EmbedSource, pdfs: ReturnType<typeof fakePdfs>): Extension[] {
      return [
        vim(),
        livePreview(),
        vaultPaths.of(["b.md", "docs/plan.pdf"]),
        imagePaths.of([]),
        embedSource.of(source),
        pdfRenderer.of(pdfs.renderer),
      ];
    }

    const modes = [
      ["vim off", withPdfs],
      ["vim on", withPdfsVim],
    ] as const;

    /** The pdf box, with a scrollTop that reads back what was set, which jsdom's does not. */
    function boxOf(view: EditorView): HTMLElement {
      const box = view.dom.querySelector(".cm-embed-pdf") as HTMLElement;
      Object.defineProperty(box, "scrollTop", { value: 0, writable: true, configurable: true });
      return box;
    }

    it.each(modes)("A1 draws page 3 at the top of the box, %s", async (_, extra) => {
      const pdfs = fakePdfs({ [PLAN]: 3 });
      const view = mount(`${ABOVE}![[plan.pdf#page=3]]`, extra(fakeVault({}).source, pdfs));
      const box = boxOf(view);

      const slots = await slotsOf(view);
      expect(box.scrollTop).toBe(1600);
      FakeObserver.reveal(slots[2] as HTMLElement);

      await waitFor(() => expect(pdfs.drawn.map(([page]) => page)).toEqual([3]));
    });

    it.each(modes)(
      "A2 opens the pdf at page 3 on ctrl or cmd and a click, %s",
      async (_, extra) => {
        const vault = fakeVault({});
        const view = mount(
          `${ABOVE}![[plan.pdf#page=3]]`,
          extra(vault.source, fakePdfs({ [PLAN]: 3 })),
        );
        const box = boxOf(view);
        await slotsOf(view);

        fireEvent.mouseDown(box, { ctrlKey: true });
        fireEvent.mouseDown(box, { metaKey: true });

        expect(vault.opened).toEqual([
          ["docs/plan.pdf", 3],
          ["docs/plan.pdf", 3],
        ]);
      },
    );

    it.each(modes)(
      "A3 opens the pdf at page 3 on a tap, in a phone-width box, %s",
      async (_, extra) => {
        const vault = fakeVault({});
        const pdfs = fakePdfs({ [PLAN]: 3 });
        const view = mount(`${ABOVE}![[plan.pdf#page=3]]`, extra(vault.source, pdfs));
        const box = boxOf(view);
        Object.defineProperty(box, "clientWidth", { value: 360 });

        const slots = await slotsOf(view);
        fireEvent.pointerDown(box, { pointerType: "touch" });
        fireEvent.click(box);
        expect(vault.opened).toEqual([["docs/plan.pdf", 3]]);

        expect(box.scrollTop).toBe(1600);
        FakeObserver.reveal(slots[2] as HTMLElement);
        await waitFor(() =>
          expect(pdfs.drawn).toEqual([[3, (360 / 600) * window.devicePixelRatio]]),
        );
      },
    );

    it("A1 keeps page 3 at the top when the box changes width, or is hidden and shown", async () => {
      const view = mount(
        `${ABOVE}![[plan.pdf#page=3]]`,
        withPdfs(fakeVault({}).source, fakePdfs({ [PLAN]: 3 })),
      );
      const box = boxOf(view);
      // How tall a page is, and so how far each slot sits below the last.
      let tall = 800;
      const index = (slot: HTMLElement) => [...(slot.parentElement?.children ?? [])].indexOf(slot);
      vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (
        this: HTMLElement,
      ) {
        return index(this) * tall;
      });
      vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(() => tall);
      Object.defineProperty(box, "scrollHeight", { get: () => 3 * tall });
      Object.defineProperty(box, "clientHeight", { value: 512 });
      await slotsOf(view);
      expect(box.scrollTop).toBe(1600);

      // Half as wide, so every page is half as tall, and the browser leaves
      // the scroll in pixels, which is now somewhere else.
      tall = 400;
      box.scrollTop = 9;
      FakeResizer.resize(box);
      expect(box.scrollTop).toBe(800);

      // Scrolled by hand to halfway down page 2, then as wide as before.
      box.scrollTop = 600;
      fireEvent.scroll(box);
      tall = 800;
      FakeResizer.resize(box);
      expect(box.scrollTop).toBe(1200);

      // Hidden, the box has no layout and the browser drops its scroll.
      tall = 0;
      box.scrollTop = 0;
      fireEvent.scroll(box);
      FakeResizer.resize(box);
      tall = 800;
      FakeResizer.resize(box);
      expect(box.scrollTop).toBe(1200);
    });

    it("B2 keeps page 3 when a scroll at 0 arrives before the resize on showing again", async () => {
      const view = mount(
        `${ABOVE}![[plan.pdf#page=3]]`,
        withPdfs(fakeVault({}).source, fakePdfs({ [PLAN]: 3 })),
      );
      const box = boxOf(view);
      let tall = 800;
      const index = (slot: HTMLElement) => [...(slot.parentElement?.children ?? [])].indexOf(slot);
      vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (
        this: HTMLElement,
      ) {
        return index(this) * tall;
      });
      vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(() => tall);
      let high = 512;
      Object.defineProperty(box, "scrollHeight", { get: () => 3 * tall });
      Object.defineProperty(box, "clientHeight", { get: () => high });
      await slotsOf(view);
      expect(box.scrollTop).toBe(1600);

      // Hidden: no layout, and the browser drops the scroll.
      tall = 0;
      high = 0;
      box.scrollTop = 0;
      FakeResizer.resize(box);

      // Shown again, laid out with the scroll still at 0, and a browser that
      // runs its scroll steps before the resize observers says so first.
      tall = 800;
      high = 512;
      fireEvent.scroll(box);
      FakeResizer.resize(box);
      expect(box.scrollTop).toBe(1600);
    });

    it("A1 keeps the last page at the top through a scroll the browser cut short", async () => {
      const view = mount(
        `${ABOVE}![[plan.pdf#page=3]]`,
        withPdfs(fakeVault({}).source, fakePdfs({ [PLAN]: 3 })),
      );
      const box = boxOf(view);
      let tall = 400;
      const index = (slot: HTMLElement) => [...(slot.parentElement?.children ?? [])].indexOf(slot);
      vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (
        this: HTMLElement,
      ) {
        return index(this) * tall;
      });
      vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(() => tall);
      Object.defineProperty(box, "scrollHeight", { get: () => 3 * tall });
      Object.defineProperty(box, "clientHeight", { value: 512 });
      await slotsOf(view);

      // A phone held upright: the last page is shorter than the box, so the
      // browser stops the scroll at its end, inside page 2, and says so.
      box.scrollTop = 3 * 400 - 512;
      fireEvent.scroll(box);

      // Turned, the pages are taller than the box, and page 3 fits at its top.
      tall = 800;
      FakeResizer.resize(box);
      expect(box.scrollTop).toBe(1600);
    });

    it.each(["#page=9", "#page=0", "#page=-1", "#page=abc", "#page=2.5", "#page=", "#", "#intro"])(
      "A4 draws and opens page 1 for %s",
      async (fragment) => {
        const vault = fakeVault({});
        const view = mount(
          `${ABOVE}![[plan.pdf${fragment}]]`,
          withPdfs(vault.source, fakePdfs({ [PLAN]: 3 })),
        );
        const box = boxOf(view);

        await slotsOf(view);
        fireEvent.mouseDown(box, { ctrlKey: true });

        expect(box.scrollTop).toBe(0);
        expect(vault.opened).toEqual([["docs/plan.pdf", undefined]]);
      },
    );

    it("I1 redraws at page 4 when the source says 4, and not on a keystroke elsewhere", async () => {
      const pdfs = fakePdfs({ [PLAN]: 4 });
      const view = mount(`${ABOVE}![[plan.pdf#page=3]]`, withPdfs(fakeVault({}).source, pdfs));
      const first = boxOf(view);
      await slotsOf(view);
      expect(first.scrollTop).toBe(1600);

      const at = view.state.doc.toString().indexOf("page=3") + 5;
      view.dispatch({ changes: { from: at, to: at + 1, insert: "4" } });
      const second = boxOf(view);
      expect(second).not.toBe(first);
      expect(pdfs.opened).toHaveLength(2);
      await waitFor(() => expect(second.querySelectorAll(".cm-pdf-page")).toHaveLength(4));
      expect(second.scrollTop).toBe(2400);

      view.dispatch({ changes: { from: 0, insert: "more " } });
      expect(view.dom.querySelector(".cm-embed-pdf")).toBe(second);
      expect(pdfs.opened).toHaveLength(2);
    });

    it.each(["![[plan.pdf#page=3|the plan]]", "![[Plan.pdf#page=3]]"])(
      "I2 draws and opens %s at page 3",
      async (embed) => {
        const vault = fakeVault({});
        const view = mount(`${ABOVE}${embed}`, withPdfs(vault.source, fakePdfs({ [PLAN]: 3 })));
        const box = boxOf(view);

        await slotsOf(view);
        fireEvent.mouseDown(box, { ctrlKey: true });

        expect(box.scrollTop).toBe(1600);
        expect(vault.opened).toEqual([["docs/plan.pdf", 3]]);
      },
    );

    it.each([
      ["#page=3", 3],
      ["#page=9", 9],
      ["#page=abc", undefined],
    ])("I3 opens %s before the pdf lands at %s", (fragment, page) => {
      const vault = fakeVault({});
      const view = mount(
        `${ABOVE}![[plan.pdf${fragment}]]`,
        withPdfs(vault.source, fakePdfs({ [PLAN]: 3 })),
      );
      const box = view.dom.querySelector(".cm-embed-pdf") as HTMLElement;

      fireEvent.mouseDown(box, { ctrlKey: true });

      expect(box.querySelector(".cm-pdf-page")).toBeNull();
      expect(vault.opened).toEqual([["docs/plan.pdf", page]]);
    });
  });
});
