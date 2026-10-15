import { EditorState } from "@codemirror/state";
import { waitFor } from "@testing-library/react";
import "@/lib/live-preview";
import { pdfRenderer, showPdf } from "@/lib/pdf-view";

// pdf.js as the vendored build hands it over: a module whose loading sets
// `globalThis.pdfjsLib`. Counted, so a test can tell whether anything loaded
// it.
const pdfjs = vi.hoisted(() => ({
  loads: 0,
  getDocument: vi.fn(),
  destroyed: 0,
}));

vi.mock("foliate-pdfjs", () => {
  pdfjs.loads += 1;
  (globalThis as { pdfjsLib?: unknown }).pdfjsLib = {
    GlobalWorkerOptions: { workerSrc: "" },
    getDocument: pdfjs.getDocument,
  };
  return {};
});

/** A two-page pdf of 600 by 800, as `getDocument` hands one back. */
function fakeTask() {
  return {
    promise: Promise.resolve({
      numPages: 2,
      getPage: async () => ({
        getViewport: ({ scale }: { scale: number }) => ({
          width: 600 * scale,
          height: 800 * scale,
        }),
        render: () => ({ promise: Promise.resolve() }),
      }),
    }),
    destroy: async () => {
      pdfjs.destroyed += 1;
    },
  };
}

/** Sees nothing, which is enough for slots to be laid out. */
class FakeObserver {
  observe() {}
  disconnect() {}
}

// Read once the static imports above have run, before any test resets the count.
const loadsByImports = pdfjs.loads;

const defaultRenderer = () => EditorState.create({}).facet(pdfRenderer);

describe("pdf.js in the editor", () => {
  beforeEach(() => {
    pdfjs.destroyed = 0;
    pdfjs.getDocument.mockReset();
    pdfjs.getDocument.mockImplementation(fakeTask);
    vi.stubGlobal("IntersectionObserver", FakeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is never loaded by an editor with no pdf embed", () => {
    expect(loadsByImports).toBe(0);
    expect(defaultRenderer()).toBeDefined();
    expect(pdfjs.loads).toBe(0);
  });

  it("is loaded when a pdf embed opens its file, which draws as before", async () => {
    const box = document.createElement("div");
    showPdf(box, defaultRenderer(), "/api/assets/x.pdf", "x.pdf", () => {});
    await waitFor(() => expect(box.querySelectorAll(".cm-pdf-page")).toHaveLength(2));
    expect(pdfjs.loads).toBe(1);
    expect(pdfjs.getDocument).toHaveBeenCalledWith(
      expect.objectContaining({ url: "/api/assets/x.pdf", isEvalSupported: false }),
    );
  });

  it("never opens the pdf when the embed leaves before pdf.js lands", async () => {
    const opening = defaultRenderer().open("/api/assets/x.pdf");
    opening.destroy();
    await expect(opening.file).rejects.toThrow();
    expect(pdfjs.getDocument).not.toHaveBeenCalled();
  });

  it("frees the task when the embed leaves after pdf.js lands", async () => {
    const opening = defaultRenderer().open("/api/assets/x.pdf");
    await opening.file;
    opening.destroy();
    expect(pdfjs.destroyed).toBe(1);
  });

  // Last: the module stays mocked this way for whatever runs after it.
  it("fails the file when pdf.js will not load, and the box says so", async () => {
    vi.doMock("foliate-pdfjs", () => {
      throw new Error("chunk failed to load");
    });
    await expect(defaultRenderer().open("/api/assets/x.pdf").file).rejects.toThrow();
    const box = document.createElement("div");
    showPdf(box, defaultRenderer(), "/api/assets/x.pdf", "x.pdf", () => {});
    await waitFor(() => expect(box.textContent).toBe("Could not read x.pdf"));
    expect(pdfjs.getDocument).not.toHaveBeenCalled();
  });
});
