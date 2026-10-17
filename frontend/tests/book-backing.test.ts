import { BACKING, backImages, INK, treatmentFor } from "@/lib/book-backing";

interface Shape {
  /** The computed `object-fit`. jsdom's cssstyle does not know the property. */
  fit?: string;
  /** The rendered height, which jsdom lays out at zero. */
  height?: number;
  /** The rendered width, the same as the height unless given. */
  width?: number;
  /** The parent's computed font size in pixels. */
  font?: number;
  /** The intrinsic width and height. Zero is a broken image. */
  natural?: number;
  complete?: boolean;
}

/** An img in a paragraph, with the layout jsdom cannot give it stubbed in. */
function image({
  fit = "fill",
  height = 200,
  width = height,
  font = 16,
  natural = 64,
  complete = true,
}: Shape = {}) {
  const parent = document.createElement("p");
  const img = document.createElement("img");
  parent.append(img);
  document.body.append(parent);
  Object.defineProperty(img, "complete", { value: complete });
  Object.defineProperty(img, "naturalWidth", { value: natural, writable: true });
  Object.defineProperty(img, "naturalHeight", { value: natural, writable: true });
  img.getBoundingClientRect = () => ({ width, height }) as DOMRect;
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    (element) =>
      ({ objectFit: element === img ? fit : "fill", fontSize: `${font}px` }) as CSSStyleDeclaration,
  );
  return img;
}

/** Two pixels, both opaque. */
const opaque = () => new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
/** Two pixels, the second see-through, the way line art on a transparent png reads. */
const transparent = () => new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 0]);
/** Pixels on a transparent ground: one opaque pixel of each colour given, then one of nothing. */
const onClear =
  (...colours: [number, number, number, number][]) =>
  () =>
    new Uint8ClampedArray([...colours.flat(), 0, 0, 0, 0]);

/** The size of a glyph in a line of 16px text. */
const SMALL = { height: 16, font: 16 };

describe("an image's white page", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("puts white behind line art on a transparent png", async () => {
    expect(await treatmentFor(image(), transparent)).toBe("white");
  });

  it("puts none behind an opaque image", async () => {
    expect(await treatmentFor(image(), opaque)).toBe("plain");
  });

  it("puts none behind a letterboxed image, whatever its pixels", async () => {
    // A square picture in a box twice as wide. The transparent reader, so a
    // skipped check would answer white.
    expect(await treatmentFor(image({ fit: "contain", width: 400 }), transparent)).toBe("plain");
    expect(await treatmentFor(image({ fit: "scale-down", width: 400 }), transparent)).toBe("plain");
  });

  it("keeps white behind letterboxed line art in a chapter with text", async () => {
    const img = image({ fit: "contain", width: 400 });
    img.before("A diagram of the engine:");

    expect(await treatmentFor(img, transparent)).toBe("white");
  });

  it("keeps white behind line art fitted with contain at its own shape", async () => {
    expect(await treatmentFor(image({ fit: "contain" }), transparent)).toBe("white");
  });

  it("puts none behind a small image in a line of text", async () => {
    // The black glyph on transparent is inverted rather than backed (#478).
    expect(await treatmentFor(image({ height: 24, font: 16 }), transparent)).toBe("ink");
  });

  it("keeps white behind an image one size larger than a line", async () => {
    expect(await treatmentFor(image({ height: 25, font: 16 }), transparent)).toBe("white");
  });

  it("keeps white behind an image another origin keeps from being read", async () => {
    const tainted = () => {
      throw new DOMException("tainted", "SecurityError");
    };

    expect(await treatmentFor(image(), tainted)).toBe("white");
  });

  it("lets any other failure to read through", async () => {
    const failing = () => {
      throw new DOMException("gone", "InvalidStateError");
    };

    await expect(treatmentFor(image(), failing)).rejects.toThrow("gone");
  });

  it("keeps white behind a broken image, for its alt text", async () => {
    expect(await treatmentFor(image({ natural: 0 }), opaque)).toBe("white");
  });

  it("decides an image that finishes loading after the section", async () => {
    const img = image({ complete: false });
    const answer = treatmentFor(img, transparent);

    img.dispatchEvent(new Event("load"));

    expect(await answer).toBe("white");
  });

  it("keeps white behind an image that fails to load after the section", async () => {
    const img = image({ complete: false });
    const answer = treatmentFor(img, opaque);

    img.dispatchEvent(new Event("error"));

    expect(await answer).toBe("white");
  });

  it("measures a small image again once it loads, having laid out at zero", async () => {
    const img = image({ complete: false, height: 0 });
    const answer = treatmentFor(img, transparent);

    img.getBoundingClientRect = () => ({ height: 12 }) as DOMRect;
    img.dispatchEvent(new Event("load"));

    // Small once measured, so a glyph to invert and not line art to back.
    expect(await answer).toBe("ink");
  });

  it("marks each image of a section the stylesheet should put white behind", async () => {
    const img = image({ natural: 0 });

    backImages(document);

    await vi.waitFor(() => expect(img.hasAttribute(BACKING)).toBe(true));
  });
});

describe("a small glyph on the dark page", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("inverts a small black glyph on transparent", async () => {
    expect(await treatmentFor(image(SMALL), onClear([0, 0, 0, 255]))).toBe("ink");
  });

  it("leaves a small coloured icon on transparent alone", async () => {
    expect(await treatmentFor(image(SMALL), onClear([220, 20, 20, 255]))).toBe("plain");
    expect(await treatmentFor(image(SMALL), onClear([20, 40, 220, 255]))).toBe("plain");
    // Dark but not grey: inverted, a navy would turn a garish yellow.
    expect(await treatmentFor(image(SMALL), onClear([10, 20, 90, 255]))).toBe("plain");
  });

  it("leaves a small white glyph on transparent alone", async () => {
    expect(await treatmentFor(image(SMALL), onClear([255, 255, 255, 255]))).toBe("plain");
    expect(await treatmentFor(image(SMALL), onClear([200, 200, 200, 255]))).toBe("plain");
  });

  it("leaves a small opaque dark image alone", async () => {
    const dark = () => new Uint8ClampedArray([0, 0, 0, 255, 30, 30, 30, 255]);

    expect(await treatmentFor(image(SMALL), dark)).toBe("plain");
  });

  it("leaves a small image another origin keeps from being read alone", async () => {
    const tainted = () => {
      throw new DOMException("tainted", "SecurityError");
    };

    expect(await treatmentFor(image(SMALL), tainted)).toBe("plain");
  });

  it("keeps large black line art white and not inverted", async () => {
    expect(await treatmentFor(image(), onClear([0, 0, 0, 255]))).toBe("white");
  });

  it("counts a glyph's grey half-transparent edges as ink", async () => {
    // Un-premultiplied, a black glyph's antialiased edge reads black at partial
    // alpha, and a canvas may round it a few steps grey.
    const edged = () =>
      new Uint8ClampedArray([
        0, 0, 0, 255, 0, 0, 0, 128, 40, 40, 40, 64, 70, 70, 70, 20, 0, 0, 0, 0,
      ]);

    expect(await treatmentFor(image(SMALL), edged)).toBe("ink");
  });

  it("counts a glyph's light matte fringe by its alpha", async () => {
    // Saved against a white matte, a glyph's edge reads light grey at partial
    // alpha. Counted whole, two such pixels in ten would sink the glyph under
    // the share; weighed by alpha, they are the faint edge they look.
    const black: [number, number, number, number] = [0, 0, 0, 255];
    const fringe: [number, number, number, number] = [200, 200, 200, 64];
    const matted = onClear(...Array(8).fill(black), fringe, fringe);

    expect(await treatmentFor(image(SMALL), matted)).toBe("ink");
  });

  it("leaves a small image with no visible pixel alone", async () => {
    const spacer = () => new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 0]);

    expect(await treatmentFor(image(SMALL), spacer)).toBe("plain");
  });

  it("marks a small black glyph as ink and puts no white behind it", async () => {
    // jsdom has no 2d context, so the canvas read is stubbed to the glyph's pixels.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage() {},
      getImageData: () => ({ data: onClear([0, 0, 0, 255])() }),
    } as unknown as CanvasRenderingContext2D);
    const img = image(SMALL);

    backImages(document);

    await vi.waitFor(() => expect(img.hasAttribute(INK)).toBe(true));
    expect(img.hasAttribute(BACKING)).toBe(false);
  });
});
