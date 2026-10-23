import { readFileSync } from "node:fs";
import { act, cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { PdfThumbs, type ThumbsHandle } from "@/components/pdf-thumbs";
import type { PdfFile } from "@/lib/pdf-view";

/** An IntersectionObserver that sees a page's slot come into view only when a test says so. */
class FakeObserver {
  static all: FakeObserver[] = [];
  readonly observed = new Set<Element>();
  private readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    FakeObserver.all.push(this);
  }

  observe(target: Element) {
    this.observed.add(target);
  }

  disconnect() {
    this.observed.clear();
  }

  static reveal(target: Element) {
    FakeObserver.report(target, true);
  }

  static leave(target: Element) {
    FakeObserver.report(target, false);
  }

  private static report(target: Element, isIntersecting: boolean) {
    for (const observer of FakeObserver.all) {
      if (!observer.observed.has(target)) continue;
      const entry = { isIntersecting, target } as IntersectionObserverEntry;
      observer.callback([entry], observer as unknown as IntersectionObserver);
    }
  }
}

/**
 * A pdf whose draws stay in flight until a test finishes them, and which refuses a
 * draw onto a canvas that is still rendering, as pdf.js does.
 */
function fakeFile(height = 800) {
  const canvases: HTMLCanvasElement[] = [];
  const live = new Set<HTMLCanvasElement>();
  const finishers: Array<() => void> = [];
  let rejected = 0;
  const file: PdfFile = {
    pages: 2,
    page: async () => ({
      width: 600,
      height,
      draw: async (canvas: HTMLCanvasElement) => {
        if (live.has(canvas)) {
          rejected += 1;
          throw new Error("Cannot use the same canvas during multiple render() operations");
        }
        live.add(canvas);
        canvases.push(canvas);
        await new Promise<void>((resolve) => {
          finishers.push(() => {
            live.delete(canvas);
            resolve();
          });
        });
      },
    }),
  };
  return { file, canvases, finishers, rejected: () => rejected };
}

/** Lets the promises a draw waits on run on. */
async function flush() {
  await act(async () => {
    for (let round = 0; round < 10; round += 1) await Promise.resolve();
  });
}

describe("the pdf pane's thumbnails", () => {
  beforeEach(() => {
    FakeObserver.all = [];
    vi.stubGlobal("IntersectionObserver", FakeObserver);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("a thumbnail that is not the current page shows a focus ring when the keyboard reaches it", () => {
    render(<PdfThumbs file={fakeFile().file} current={1} onGoTo={() => {}} />);

    expect(screen.getByRole("button", { name: "Page 2" })).toHaveClass("focus-visible:outline-2");
  });

  it("a thumbnail takes its own page's shape, so drawing and freeing it does not move the column", async () => {
    const fake = fakeFile(1000);
    render(<PdfThumbs file={fake.file} current={1} onGoTo={() => {}} />);
    const first = screen.getByRole("button", { name: "Page 1" });

    act(() => FakeObserver.reveal(first));
    await flush();
    act(() => {
      for (const finish of fake.finishers) finish();
    });
    await flush();
    expect(first.style.aspectRatio).toBe("600 / 1000");

    act(() => FakeObserver.leave(first));
    expect(first.style.aspectRatio).toBe("600 / 1000");
  });

  it("a thumbnail's canvas is laid out as a block, so no line gap sits under it", async () => {
    const fake = fakeFile();
    render(<PdfThumbs file={fake.file} current={1} onGoTo={() => {}} />);
    const first = screen.getByRole("button", { name: "Page 1" });

    act(() => FakeObserver.reveal(first));
    await flush();
    act(() => {
      for (const finish of fake.finishers) finish();
    });
    await flush();

    expect(first.querySelector("canvas")?.style.display).toBe("block");
  });

  it("the dark theme outlines each thumbnail's page, as it outlines the pages", () => {
    const paneCss = readFileSync("src/styles/pdf-pane.css", "utf8");
    expect(paneCss).toMatch(/\[data-thumb\] canvas\s*\{[^}]*outline: 1px solid var\(--k-rule\)/);
  });

  it("a thumbnail is drawn only while in view, and freed when it leaves", async () => {
    const fake = fakeFile();
    render(<PdfThumbs file={fake.file} current={1} onGoTo={() => {}} />);
    const first = screen.getByRole("button", { name: "Page 1" });
    const second = screen.getByRole("button", { name: "Page 2" });

    act(() => FakeObserver.reveal(first));
    await flush();
    act(() => {
      for (const finish of fake.finishers) finish();
    });
    await flush();
    const canvas = first.querySelector("canvas");
    expect(canvas).not.toBeNull();
    // Page 2 never came into view, so it was never drawn.
    expect(fake.canvases).toHaveLength(1);
    expect(second.querySelector("canvas")).toBeNull();

    act(() => FakeObserver.leave(first));

    expect(canvas?.width).toBe(0);
    expect(first.querySelector("canvas")).toBeNull();
  });

  it("a redraw while a draw is in flight draws a new canvas, and the thumbnail ends drawn", async () => {
    const fake = fakeFile();
    const handle = createRef<ThumbsHandle>();
    render(<PdfThumbs file={fake.file} current={1} onGoTo={() => {}} ref={handle} />);
    const slot = screen.getByRole("button", { name: "Page 1" });

    act(() => FakeObserver.reveal(slot));
    await flush();
    act(() => handle.current?.redraw());
    await flush();
    act(() => {
      for (const finish of fake.finishers) finish();
    });
    await flush();

    expect(fake.rejected()).toBe(0);
    expect(fake.canvases).toHaveLength(2);
    expect(fake.canvases[0]).not.toBe(fake.canvases[1]);
    expect(slot.querySelector("canvas")).toBe(fake.canvases[1]);
  });
});
