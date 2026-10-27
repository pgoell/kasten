/**
 * The pdf pane's page colours, drawn by real pdf.js in real Chromium.
 *
 * pdf.js's page colours redraw the whole canvas through a filter, pictures
 * included, so the colours are only right when the image is drawn again as it
 * was printed. jsdom has no canvas to test that on, and this file is the one
 * that looks at the pixels.
 */

import "./pdf-take-api";
import {
  type PdfView,
  pageColors,
  pdfjsRenderer,
  type ShowOptions,
  showPdf,
} from "@/lib/book/pdf-view";
import "@/styles/app.css";
import { IMAGE_BOX, PAGE_HEIGHT, PAGE_ONE, PAGE_WIDTH } from "./pdf-fixture";

type Rgb = [number, number, number];

/** The fixture as the stub serves it. A `blob:` URL is refused by the page's `connect-src`. */
const URL_OF_FIXTURE = "/api/assets/fixture.pdf";

let mounted: { view: PdfView; host: HTMLElement } | null = null;

/** The three channels of a css colour, as the browser computes it. */
function rgbOf(colour: string): Rgb {
  const probe = document.createElement("div");
  probe.style.color = colour;
  document.body.append(probe);
  const [r = 0, g = 0, b = 0] = (getComputedStyle(probe).color.match(/\d+/g) ?? []).map(Number);
  probe.remove();
  return [r, g, b];
}

/** A token of `kasten-theme.css` as the root computes it now. */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** The largest difference of any channel between two colours. */
function maxDifference(a: Rgb, b: Rgb): number {
  return Math.max(...a.map((channel, index) => Math.abs(channel - (b[index] ?? 0))));
}

/** The canvas pixel under a point of the page, in pdf points from the bottom left. */
function pixelOf(canvas: HTMLCanvasElement, x: number, y: number): [number, number] {
  return [(x * canvas.width) / PAGE_WIDTH, ((PAGE_HEIGHT - y) * canvas.height) / PAGE_HEIGHT];
}

/** The colour of the one pixel at a point of the page. */
function colourAt(canvas: HTMLCanvasElement, x: number, y: number): Rgb {
  const [px, py] = pixelOf(canvas, x, y);
  const context = canvas.getContext("2d") as CanvasRenderingContext2D;
  const [r = 0, g = 0, b = 0] = context.getImageData(Math.floor(px), Math.floor(py), 1, 1).data;
  return [r, g, b];
}

/** The colour of the canvas pixel at `x`, `y`, counted in whole pixels. */
function pixelAt(canvas: HTMLCanvasElement, x: number, y: number): Rgb {
  const context = canvas.getContext("2d") as CanvasRenderingContext2D;
  const [r = 0, g = 0, b = 0] = context.getImageData(x, y, 1, 1).data;
  return [r, g, b];
}

/** The brightest pixel in the band of the first line of page one, where its text sits. */
function brightestTextPixel(canvas: HTMLCanvasElement): Rgb {
  const [left, top] = pixelOf(canvas, 50, 738);
  const [right, bottom] = pixelOf(canvas, 320, 712);
  const context = canvas.getContext("2d") as CanvasRenderingContext2D;
  const { data } = context.getImageData(
    Math.floor(left),
    Math.floor(top),
    Math.ceil(right - left),
    Math.ceil(bottom - top),
  );
  let brightest: Rgb = [0, 0, 0];
  for (let at = 0; at < data.length; at += 4) {
    const pixel: Rgb = [data[at] ?? 0, data[at + 1] ?? 0, data[at + 2] ?? 0];
    if (pixel[0] + pixel[1] + pixel[2] > brightest[0] + brightest[1] + brightest[2])
      brightest = pixel;
  }
  return brightest;
}

/**
 * Draws page one of the fixture into a box of 600 by 800 css pixels, the way the
 * pane does, and resolves with its canvas once the page is drawn.
 */
async function drawPage(options: ShowOptions): Promise<HTMLElement> {
  mounted?.view();
  mounted?.host.remove();
  const host = document.createElement("div");
  // The attribute the pane's box carries, which the pane's page and text-layer rules are scoped to.
  host.dataset.pdfBox = "";
  host.style.cssText = "width: 600px; height: 800px;";
  document.body.append(host);
  const view = showPdf(
    host,
    pdfjsRenderer,
    URL_OF_FIXTURE,
    "fixture.pdf",
    () => {},
    undefined,
    options,
  );
  mounted = { view, host };
  // A slot gets its canvas once the page is drawn, so the canvas is the signal.
  await vi.waitFor(() => expect(host.querySelector('[data-pdf-page="1"] canvas')).not.toBeNull(), {
    timeout: 20_000,
  });
  return host;
}

/** The canvas of page one, once `drawPage` has resolved. */
function canvasOf(host: HTMLElement): HTMLCanvasElement {
  return host.querySelector('[data-pdf-page="1"] canvas') as HTMLCanvasElement;
}

afterEach(() => {
  mounted?.view();
  mounted?.host.remove();
  mounted = null;
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.palette;
});

describe("the pdf pane draws its pages in the theme's colours", () => {
  it("draws the ground in the dark paper and the text in the dark ink", async () => {
    document.documentElement.dataset.theme = "dark";
    const canvas = canvasOf(await drawPage({ colors: pageColors }));

    // The ground is a corner no text or picture reaches.
    expect(maxDifference(colourAt(canvas, 580, 40), rgbOf(token("--k-paper")))).toBeLessThanOrEqual(
      2,
    );
    // Antialiasing keeps a glyph's brightest pixel short of the full ink, so
    // the test allows a margin a reader could not tell apart.
    expect(maxDifference(brightestTextPixel(canvas), rgbOf(token("--k-ink")))).toBeLessThanOrEqual(
      40,
    );
  }, 40_000);

  it("keeps the picture's pixels pure red and blue, in the dark and in the light", async () => {
    // The picture is left as printed: a dark theme inverting it would change these.
    document.documentElement.dataset.theme = "dark";
    const dark = canvasOf(await drawPage({ colors: pageColors }));
    const redAt = [IMAGE_BOX.x + IMAGE_BOX.width * 0.25, IMAGE_BOX.y + IMAGE_BOX.height / 2];
    const blueAt = [IMAGE_BOX.x + IMAGE_BOX.width * 0.75, IMAGE_BOX.y + IMAGE_BOX.height / 2];
    expect(
      maxDifference(colourAt(dark, redAt[0] ?? 0, redAt[1] ?? 0), [255, 0, 0]),
    ).toBeLessThanOrEqual(2);
    expect(
      maxDifference(colourAt(dark, blueAt[0] ?? 0, blueAt[1] ?? 0), [0, 0, 255]),
    ).toBeLessThanOrEqual(2);

    delete document.documentElement.dataset.theme;
    const light = canvasOf(await drawPage({ colors: pageColors }));
    expect(
      maxDifference(colourAt(light, redAt[0] ?? 0, redAt[1] ?? 0), [255, 0, 0]),
    ).toBeLessThanOrEqual(2);
    expect(
      maxDifference(colourAt(light, blueAt[0] ?? 0, blueAt[1] ?? 0), [0, 0, 255]),
    ).toBeLessThanOrEqual(2);
  }, 40_000);

  it("leaves the paper just outside the picture's sides, with no white ring", async () => {
    // At this width the picture's left and right edges fall part way through a
    // pixel, and a box rounded outward copies that pixel from the plain draw,
    // which is white. The margin allows for the part of the pixel the picture covers.
    document.documentElement.dataset.theme = "dark";
    const canvas = canvasOf(await drawPage({ colors: pageColors }));
    const scale = canvas.width / PAGE_WIDTH;
    const left = Math.floor(IMAGE_BOX.x * scale);
    const right = Math.floor((IMAGE_BOX.x + IMAGE_BOX.width) * scale);
    const middle = Math.floor(
      ((PAGE_HEIGHT - IMAGE_BOX.y - IMAGE_BOX.height / 2) * canvas.height) / PAGE_HEIGHT,
    );
    const paper = rgbOf(token("--k-paper"));
    expect(maxDifference(pixelAt(canvas, left, middle), paper)).toBeLessThanOrEqual(8);
    expect(maxDifference(pixelAt(canvas, right, middle), paper)).toBeLessThanOrEqual(8);
  }, 40_000);

  it("draws the ground white, as printed, in the light", async () => {
    // No theme attribute, so `pageColors` answers nothing and the page is drawn as printed.
    const canvas = canvasOf(await drawPage({ colors: pageColors }));
    expect(colourAt(canvas, 580, 40)).toEqual([255, 255, 255]);
  }, 40_000);

  it("paints the text layer's selection in the editor's highlight, in the pansy palette", async () => {
    // A palette sets its own highlight, so the selection has to read that token and not a
    // system colour that stays the same in every palette.
    document.documentElement.dataset.theme = "dark";
    document.documentElement.dataset.palette = "pansy";
    const host = await drawPage({ colors: pageColors, textLayer: true });
    const span = await vi.waitFor(
      () => {
        const found = [...host.querySelectorAll('[data-pdf-page="1"] .textLayer span')].find(
          (one) => (one.textContent ?? "").includes(PAGE_ONE[0] ?? ""),
        );
        expect(found).toBeDefined();
        return found as HTMLElement;
      },
      { timeout: 20_000 },
    );

    const probe = document.createElement("div");
    probe.style.backgroundColor = token("--k-highlight");
    document.body.append(probe);
    const expected = getComputedStyle(probe).backgroundColor;
    probe.remove();
    expect(getComputedStyle(span, "::selection").backgroundColor).toBe(expected);
  }, 40_000);

  it("lays a selectable text layer over the page, in the page's own words", async () => {
    document.documentElement.dataset.theme = "dark";
    const host = await drawPage({ colors: pageColors, textLayer: true });
    const span = await vi.waitFor(
      () => {
        const found = [...host.querySelectorAll('[data-pdf-page="1"] .textLayer span')].find(
          (one) => (one.textContent ?? "").includes(PAGE_ONE[0] ?? ""),
        );
        expect(found).toBeDefined();
        return found as HTMLElement;
      },
      { timeout: 20_000 },
    );

    const layer = span.closest(".textLayer") as HTMLElement;
    expect(getComputedStyle(layer).position).toBe("absolute");
    const selection = window.getSelection() as Selection;
    const range = document.createRange();
    range.selectNodeContents(span);
    selection.removeAllRanges();
    selection.addRange(range);
    expect(selection.toString()).toContain(PAGE_ONE[0] ?? "");
  }, 40_000);
});
