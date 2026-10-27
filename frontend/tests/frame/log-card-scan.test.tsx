/**
 * Scanning a food's barcode with the camera (#622), in a real browser. The camera
 * is a canvas that holds a picture of a barcode from zxing's own test images, so
 * the decoder has real bars to read. jsdom has no camera and no decoder to test.
 */

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { page } from "vitest/browser";
import { readBarcode } from "@/lib/food-api";
import { logCard } from "@/lib/log-card";
import { notePath } from "@/lib/todo/todo-commands";
import { shot } from "./shots";
import "@/styles/app.css";

vi.mock("@/lib/food-api", () => ({
  searchFood: async () => [],
  readBarcode: vi.fn(async () => ({
    code: "8413000065504",
    name: "Tortitas",
    brand: null,
    serving_g: 50,
    serving_from: "serving_quantity",
    per_100g: { kcal: 481, protein: 8.6, carbs: 60.5, fat: 22.5 },
    per_serving: { kcal: 240, protein: 4.3, carbs: 30.2, fat: 11.2 },
  })),
  fetchLog: async () => [],
}));

const DAILY = "01 Periodic/00 Daily/2026-10-20.md";
const NOTE = [
  "# 2026-10-20 Tuesday",
  "",
  "[[01 Periodic/00 Daily/2026-10-19]] | [[01 Periodic/00 Daily/2026-10-21]]",
  "",
  "## Log",
  "- 💧 500 ml",
  "- ☕ 1",
  "- 🍺 1 0.5 l 5%",
  "",
  "## Done",
].join("\n");

type Camera = {
  /** Every stream the page was handed, so a test can see whether its tracks stopped. */
  streams: MediaStream[];
  /** What the page asked the torch to be set to, in order. */
  constraints: MediaTrackConstraints[];
  restore: () => void;
};

beforeEach(() => {
  vi.mocked(readBarcode).mockClear();
});

/**
 * Puts a picture in front of the page's camera, or refuses the camera when there
 * is no picture. The canvas keeps redrawing the picture, so the decoder gets fresh
 * frames the way a live camera delivers them. The fallback stands in for
 * BarcodeDetector with a build that lists no formats, so zxing does the reading.
 */
async function stubCamera(picture: URL | "grey" | null, torch = false): Promise<Camera> {
  const streams: MediaStream[] = [];
  const constraints: MediaTrackConstraints[] = [];
  const canvas = document.createElement("canvas");
  let frame = 0;
  if (picture) {
    // A grey frame is a live camera with nothing in view, so the decoder runs and finds no code.
    const bitmap =
      picture === "grey" ? null : await createImageBitmap(await (await fetch(picture)).blob());
    // The canvas takes the picture's own size, so the decoder reads its pixels unscaled.
    canvas.width = bitmap?.width ?? 640;
    canvas.height = bitmap?.height ?? 480;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d canvas to draw the picture on");
    const draw = () => {
      if (bitmap) {
        ctx.drawImage(bitmap, 0, 0);
      } else {
        ctx.fillStyle = "#333";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      frame = requestAnimationFrame(draw);
    };
    draw();
  }

  const getUserMedia = async (): Promise<MediaStream> => {
    if (!picture) throw new DOMException("", "NotAllowedError");
    const stream = canvas.captureStream(10);
    if (torch) {
      for (const track of stream.getVideoTracks()) {
        // A canvas track has no torch, so the stub adds one the page can read and set.
        const realCapabilities = track.getCapabilities();
        Object.defineProperty(track, "getCapabilities", {
          configurable: true,
          value: () => ({ ...realCapabilities, torch: true }),
        });
        Object.defineProperty(track, "applyConstraints", {
          configurable: true,
          value: async (set: MediaTrackConstraints) => {
            constraints.push(set);
          },
        });
      }
    }
    streams.push(stream);
    return stream;
  };
  Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
    configurable: true,
    value: getUserMedia,
  });
  const hadDetector = Object.getOwnPropertyDescriptor(globalThis, "BarcodeDetector");
  Object.defineProperty(globalThis, "BarcodeDetector", {
    configurable: true,
    writable: true,
    value: class {
      // An instance method too, so the class is not static-only, which lint refuses.
      detect() {
        return Promise.resolve([]);
      }

      static getSupportedFormats() {
        return Promise.resolve([]);
      }
    },
  });

  return {
    streams,
    constraints,
    restore() {
      cancelAnimationFrame(frame);
      Reflect.deleteProperty(navigator.mediaDevices, "getUserMedia");
      if (hadDetector) Object.defineProperty(globalThis, "BarcodeDetector", hadDetector);
      else Reflect.deleteProperty(globalThis, "BarcodeDetector");
    },
  };
}

/** The note on a page of this size, with the card as the note draws it. */
async function mount(width: number, height: number) {
  await page.viewport(width, height);
  const host = document.body.appendChild(document.createElement("div"));
  host.style.cssText = `width: 100%; height: ${height}px; background: #282c34;`;
  const view = new EditorView({
    state: EditorState.create({
      doc: NOTE,
      // As the app mounts it: a long wikilink line wraps, rather than widening the card.
      extensions: [notePath.of(DAILY), logCard, EditorView.lineWrapping],
    }),
    parent: host,
  });
  await expect.poll(() => view.dom.querySelector(".cm-log button")).not.toBeNull();
  return { host, view };
}

/** Presses the card's 🍽 button, or fails the test where there is none. */
async function openFood(view: EditorView): Promise<void> {
  const button = view.dom.querySelector<HTMLButtonElement>(".cm-log button[aria-label='Log food']");
  expect(button, "the Log food button").not.toBeNull();
  button?.click();
  // The sheet is drawn in a microtask after the press, so the call waits for that one turn.
  await Promise.resolve();
}

function scanButton(view: EditorView): HTMLElement | null {
  return view.dom.querySelector<HTMLElement>(".cm-log-food-scan");
}

function torchButton(view: EditorView): HTMLElement | null {
  return view.dom.querySelector<HTMLElement>(".cm-log-food-torch");
}

function pressScan(view: EditorView): void {
  const scan = scanButton(view);
  expect(scan, "the scan button").not.toBeNull();
  scan?.click();
}

/** True once the camera handed out a stream and every track of it has stopped. */
function tracksEnded(camera: Camera): boolean {
  const tracks = camera.streams.flatMap((stream) => stream.getTracks());
  return tracks.length > 0 && tracks.every((track) => track.readyState === "ended");
}

/** The camera view is on screen. Hidden or removed counts as off. */
function cameraShown(view: EditorView): boolean {
  const video = view.dom.querySelector(".cm-log-food-camera");
  return video !== null && video.getClientRects().length > 0;
}

/** Scans a picture of a barcode and expects its code to reach readBarcode. */
async function readsPicture(picture: URL, code: string): Promise<void> {
  const camera = await stubCamera(picture);
  try {
    const { host, view } = await mount(414, 896);
    await openFood(view);
    pressScan(view);
    await expect.poll(() => cameraShown(view)).toBe(true);
    await expect
      .poll(() => view.dom.querySelector<HTMLVideoElement>(".cm-log-food-camera")?.videoWidth ?? 0)
      .toBeGreaterThan(0);
    await expect
      .poll(() => view.dom.querySelector(".cm-log-food-why")?.textContent ?? "")
      .not.toMatch(/did not load/);
    await expect
      .poll(() => vi.mocked(readBarcode).mock.calls[0]?.[0], { timeout: 10000 })
      .toBe(code);
    await expect.poll(() => tracksEnded(camera)).toBe(true);
    await expect.poll(() => cameraShown(view)).toBe(false);
    view.destroy();
    host.remove();
  } finally {
    camera.restore();
    await page.viewport(414, 896);
  }
}

/**
 * A refused camera says so in the panel. The scan button is finger-sized and the
 * card and the page stay inside the screen.
 */
async function refusesCamera(width: number, label: string): Promise<void> {
  const camera = await stubCamera(null);
  try {
    const { host, view } = await mount(width, 896);
    await openFood(view);
    expect(scanButton(view), "the scan button").not.toBeNull();
    expect(await shot(host, `scan-button-${label}`)).toBe(width);

    pressScan(view);
    await expect
      .poll(() => view.dom.querySelector(".cm-log-food-why")?.textContent ?? "")
      .toMatch(/camera/i);
    expect(view.dom.querySelector(".cm-log-food-why")?.textContent ?? "").toMatch(/not allowed/i);

    const scan = scanButton(view);
    expect(
      scan?.getBoundingClientRect().height ?? 0,
      "the scan button's height",
    ).toBeGreaterThanOrEqual(44);
    const card = view.dom.querySelector<HTMLElement>(".cm-log");
    expect(card, "the log card").not.toBeNull();
    expect(card?.scrollWidth ?? 0, "the card scrolls sideways").toBeLessThanOrEqual(
      card?.clientWidth ?? 0,
    );
    expect(document.documentElement.scrollWidth, "page scrolls sideways").toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
    expect(await shot(host, `scan-refused-${label}`)).toBe(width);
    view.destroy();
    host.remove();
  } finally {
    camera.restore();
    await page.viewport(414, 896);
  }
}

it("#622 the camera reads an EAN-13 picture through the zxing fallback", () =>
  readsPicture(new URL("../fixtures/barcodes/ean13.png", import.meta.url), "8413000065504"));

it("#622 the camera reads an EAN-8 picture through the zxing fallback", () =>
  readsPicture(new URL("../fixtures/barcodes/ean8.png", import.meta.url), "48512343"));

it("#622 the camera reads a UPC-A picture through the zxing fallback", () =>
  readsPicture(new URL("../fixtures/barcodes/upca.png", import.meta.url), "036602301467"));

// The picture is UPC-E 01234565, which expands to the UPC-A 012345000065 (number
// system 0, middle 123456 whose last digit 6 puts four zeros before it, check digit 5).
it("#622 the camera reads a UPC-E picture through the zxing fallback and looks up its UPC-A", () =>
  readsPicture(new URL("../fixtures/barcodes/upce.png", import.meta.url), "012345000065"));

it("#622 the scan button and a refused camera at 414 are finger-sized and do not scroll sideways", () =>
  refusesCamera(414, "414"));

it("#622 the scan button and a refused camera lay out on a desktop", () =>
  refusesCamera(1200, "1200"));

// The torch sits in the scan row. At 414 it must be as tall as a finger target and level
// with Scan, or it wraps under Scan and the card widens past the screen.
it("#765 the torch button at 414 sits beside Scan finger-sized and the card does not scroll sideways", async () => {
  const camera = await stubCamera("grey", true);
  let mounted: Awaited<ReturnType<typeof mount>> | null = null;
  try {
    mounted = await mount(414, 896);
    const { host, view } = mounted;
    await openFood(view);
    pressScan(view);
    await expect
      .poll(() => (torchButton(view)?.getClientRects().length ?? 0) > 0, { timeout: 10000 })
      .toBe(true);

    const torch = torchButton(view);
    const scan = scanButton(view);
    expect(
      torch?.getBoundingClientRect().height ?? 0,
      "the torch button's height",
    ).toBeGreaterThanOrEqual(44);
    expect(
      Math.abs(
        (torch?.getBoundingClientRect().top ?? 0) - (scan?.getBoundingClientRect().top ?? 0),
      ),
      "the torch is off the scan row",
    ).toBeLessThanOrEqual(2);
    const card = view.dom.querySelector<HTMLElement>(".cm-log");
    expect(card, "the log card").not.toBeNull();
    expect(card?.scrollWidth ?? 0, "the card scrolls sideways").toBeLessThanOrEqual(
      card?.clientWidth ?? 0,
    );
    expect(document.documentElement.scrollWidth, "page scrolls sideways").toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );

    // Shot after the press, so the picture shows the torch held on.
    torch?.click();
    await expect.poll(() => torchButton(view)?.getAttribute("aria-pressed")).toBe("true");
    expect(camera.constraints).toEqual([{ advanced: [{ torch: true }] }]);
    expect(await shot(host, "scan-torch-414")).toBe(414);

    view.dom.querySelector<HTMLElement>(".cm-log-food-close")?.click();
    await expect.poll(() => tracksEnded(camera)).toBe(true);
  } finally {
    mounted?.view.destroy();
    mounted?.host.remove();
    camera.restore();
    await page.viewport(414, 896);
  }
});
