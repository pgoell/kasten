import {
  type PageColors,
  type PdfFile,
  type PdfRenderer,
  type PdfView,
  pageColors,
  type ShowOptions,
  showPdf,
} from "@/lib/pdf-view";

/** One draw of a page: which page, at what scale, in which colours. */
interface Draw {
  page: number;
  scale: number;
  colors: PageColors | undefined;
}

let draws: Draw[] = [];
let texts: { page: number; container: HTMLElement }[] = [];
let views: { view: PdfView; box: HTMLElement }[] = [];

/** A two-page pdf of 600 by 800, which records each draw and each text layer. */
function fakeFile(): PdfFile {
  return {
    pages: 2,
    page: async (number) => ({
      width: 600,
      height: 800,
      draw: async (_canvas, scale, colors) => {
        draws.push({ page: number, scale, colors });
      },
      text: async (container) => {
        texts.push({ page: number, container });
      },
    }),
  };
}

const fakeRenderer: PdfRenderer = {
  open: () => ({ file: Promise.resolve(fakeFile()), destroy: () => {} }),
};

/** Sees every slot on screen the moment it is observed, so each page draws. */
class VisibleObserver {
  private readonly callback: (entries: IntersectionObserverEntry[]) => void;
  constructor(callback: (entries: IntersectionObserverEntry[]) => void) {
    this.callback = callback;
  }
  observe(target: Element) {
    this.callback([{ target, isIntersecting: true } as IntersectionObserverEntry]);
  }
  disconnect() {}
}

/** Sees nothing, which is enough for a box that is never resized. */
class QuietObserver {
  observe() {}
  disconnect() {}
}

/** Opens the fake pdf into a box, and waits until its pages are drawn. */
async function open(
  options?: ShowOptions,
  page?: number,
): Promise<{ view: PdfView; box: HTMLElement }> {
  const box = document.createElement("div");
  document.body.append(box);
  const view = showPdf(box, fakeRenderer, "/api/assets/x.pdf", "x.pdf", () => {}, page, options);
  views.push({ view, box });
  await vi.waitFor(() => expect(box.querySelectorAll("canvas")).toHaveLength(2));
  return { view, box };
}

beforeEach(() => {
  draws = [];
  texts = [];
  views = [];
  vi.stubGlobal("IntersectionObserver", VisibleObserver);
  vi.stubGlobal("ResizeObserver", QuietObserver);
});

afterEach(() => {
  for (const { view, box } of views) {
    view();
    box.remove();
  }
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.theme;
  document.documentElement.style.removeProperty("--k-paper");
  document.documentElement.style.removeProperty("--k-ink");
});

const DARK: PageColors = { background: "#1a1a1a", foreground: "#e8e7e4" };
const LIGHT: PageColors = { background: "#f0f0f0", foreground: "#101010" };

describe("the pdf pane's options", () => {
  it("draws each page in the colours read when it is drawn", async () => {
    const read = vi.fn(() => LIGHT);
    await open({ colors: read });
    expect(read).toHaveBeenCalledTimes(2);
    expect(draws.map((draw) => draw.colors)).toEqual([LIGHT, LIGHT]);
  });

  it("redraws the drawn pages in the colours read now, keeping the scroll", async () => {
    let colors: PageColors | undefined = LIGHT;
    const { view, box } = await open({ colors: () => colors });
    box.scrollTop = 300;
    draws = [];
    colors = DARK;
    view.redraw();
    await vi.waitFor(() => expect(draws.map((draw) => draw.colors)).toEqual([DARK, DARK]));
    expect(box.scrollTop).toBe(300);
  });

  it("gives each slot its page number", async () => {
    const { box } = await open();
    const numbers = [...box.querySelectorAll("[data-pdf-page]")].map(
      (slot) => (slot as HTMLElement).dataset.pdfPage,
    );
    expect(numbers).toEqual(["1", "2"]);
  });

  it("draws the embed as before: no colours and no text layer", async () => {
    const { box } = await open();
    expect(draws.map((draw) => draw.colors)).toEqual([undefined, undefined]);
    expect(texts).toEqual([]);
    expect(box.querySelector(".textLayer")).toBeNull();
  });

  it("builds a text layer over each drawn page and reports it", async () => {
    const onText = vi.fn();
    await open({ textLayer: true, onText });
    await vi.waitFor(() => expect(onText).toHaveBeenCalledTimes(2));
    expect(
      onText.mock.calls.map(([number, layer]) => [number, (layer as HTMLElement).className]),
    ).toEqual([
      [1, "textLayer"],
      [2, "textLayer"],
    ]);
    expect(texts.map((text) => text.page)).toEqual([1, 2]);
  });

  it("draws the pages at the zoom it is given, and widens the slots to match", async () => {
    const { box } = await open({ zoom: 2 });
    expect(draws.map((draw) => draw.scale)).toEqual([2, 2]);
    expect(
      [...box.querySelectorAll("[data-pdf-page]")].map((slot) => (slot as HTMLElement).style.width),
    ).toEqual(["200%", "200%"]);
  });

  it("setZoom draws the drawn pages again at the new width", async () => {
    const { view, box } = await open();
    draws = [];
    view.setZoom(2);
    await vi.waitFor(() => expect(draws.map((draw) => draw.scale)).toEqual([2, 2]));
    expect(
      [...box.querySelectorAll("[data-pdf-page]")].map((slot) => (slot as HTMLElement).style.width),
    ).toEqual(["200%", "200%"]);
  });

  it("reports the page at the top when it opens and when goTo moves the box", async () => {
    const onPage = vi.fn();
    const { view } = await open({ onPage }, 1);
    expect(onPage).toHaveBeenLastCalledWith(1);
    view.goTo(2);
    expect(onPage).toHaveBeenLastCalledWith(2);
  });

  it("hands the open pdf to onFile", async () => {
    const onFile = vi.fn();
    await open({ onFile });
    expect(onFile).toHaveBeenCalledWith(expect.objectContaining({ pages: 2 }));
  });

  it("gives the page colours of the dark theme, and none in the light", () => {
    expect(pageColors()).toBeUndefined();
    document.documentElement.dataset.theme = "dark";
    document.documentElement.style.setProperty("--k-paper", DARK.background);
    document.documentElement.style.setProperty("--k-ink", DARK.foreground);
    expect(pageColors()).toEqual(DARK);
  });
});
