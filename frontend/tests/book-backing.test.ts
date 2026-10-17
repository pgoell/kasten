import { BACKING, backImages, backingFor } from "@/lib/book-backing";

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

describe("an image's white page", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("puts white behind line art on a transparent png", async () => {
    expect(await backingFor(image(), transparent)).toBe(true);
  });

  it("puts none behind an opaque image", async () => {
    expect(await backingFor(image(), opaque)).toBe(false);
  });

  it("puts none behind a letterboxed image, whatever its pixels", async () => {
    // A square picture in a box twice as wide. The transparent reader, so a
    // skipped check would answer white.
    expect(await backingFor(image({ fit: "contain", width: 400 }), transparent)).toBe(false);
    expect(await backingFor(image({ fit: "scale-down", width: 400 }), transparent)).toBe(false);
  });

  it("keeps white behind line art fitted with contain at its own shape", async () => {
    expect(await backingFor(image({ fit: "contain" }), transparent)).toBe(true);
  });

  it("puts none behind a small image in a line of text", async () => {
    expect(await backingFor(image({ height: 24, font: 16 }), transparent)).toBe(false);
  });

  it("keeps white behind an image one size larger than a line", async () => {
    expect(await backingFor(image({ height: 25, font: 16 }), transparent)).toBe(true);
  });

  it("keeps white behind an image another origin keeps from being read", async () => {
    const tainted = () => {
      throw new DOMException("tainted", "SecurityError");
    };

    expect(await backingFor(image(), tainted)).toBe(true);
  });

  it("lets any other failure to read through", async () => {
    const failing = () => {
      throw new DOMException("gone", "InvalidStateError");
    };

    await expect(backingFor(image(), failing)).rejects.toThrow("gone");
  });

  it("keeps white behind a broken image, for its alt text", async () => {
    expect(await backingFor(image({ natural: 0 }), opaque)).toBe(true);
  });

  it("decides an image that finishes loading after the section", async () => {
    const img = image({ complete: false });
    const answer = backingFor(img, transparent);

    img.dispatchEvent(new Event("load"));

    expect(await answer).toBe(true);
  });

  it("keeps white behind an image that fails to load after the section", async () => {
    const img = image({ complete: false });
    const answer = backingFor(img, opaque);

    img.dispatchEvent(new Event("error"));

    expect(await answer).toBe(true);
  });

  it("measures a small image again once it loads, having laid out at zero", async () => {
    const img = image({ complete: false, height: 0 });
    const answer = backingFor(img, transparent);

    img.getBoundingClientRect = () => ({ height: 12 }) as DOMRect;
    img.dispatchEvent(new Event("load"));

    expect(await answer).toBe(false);
  });

  it("marks each image of a section the stylesheet should put white behind", async () => {
    const img = image({ natural: 0 });

    backImages(document);

    await vi.waitFor(() => expect(img.hasAttribute(BACKING)).toBe(true));
  });
});
