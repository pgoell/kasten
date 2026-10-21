/**
 * Reads the barcode in one video frame, and the UPC-A a UPC-E stands for.
 *
 * Android Chrome has BarcodeDetector, which reads all four formats. Elsewhere zxing
 * reads them, loaded on the first scan that needs it.
 */

import { loadOnce } from "@/lib/load-once";

export type Format = "ean_13" | "ean_8" | "upc_a" | "upc_e";

/** The formats a scan reads: the EAN and UPC family a food's package carries. */
export const FORMATS: Format[] = ["ean_13", "ean_8", "upc_a", "upc_e"];

/** Reads one video frame: the digits of its barcode, or null where the frame holds none. */
export type Decoder = (video: HTMLVideoElement) => Promise<string | null>;

/** The part of BarcodeDetector this reads, which lib.dom does not type. */
interface Detected {
  rawValue: string;
  format: string;
}

interface Detector {
  detect(source: HTMLVideoElement): Promise<Detected[]>;
}

interface DetectorClass {
  new (options: { formats: Format[] }): Detector;
  getSupportedFormats(): Promise<string[]>;
}

/**
 * The 12-digit UPC-A a UPC-E stands for. The six middle digits are the UPC-A's
 * digits with its zeros squeezed out, and the last middle digit says where they
 * were. The check digit is the same in both, so it is kept as it is.
 */
export function expandUpcE(code: string): string {
  const middle = code.slice(1, 7);
  const last = middle.charAt(5);
  const body =
    last <= "2"
      ? `${middle.slice(0, 2)}${last}0000${middle.slice(2, 5)}`
      : last === "3"
        ? `${middle.slice(0, 3)}00000${middle.slice(3, 5)}`
        : last === "4"
          ? `${middle.slice(0, 4)}00000${middle.slice(4, 5)}`
          : `${middle.slice(0, 5)}0000${last}`;
  return `${code.charAt(0)}${body}${code.charAt(7)}`;
}

/** A UPC-E is passed on as the UPC-A that Open Food Facts keys its product by. */
function readOf(text: string, format: string): string {
  return format === "upc_e" ? expandUpcE(text) : text;
}

// A dynamic import `.claude/CLAUDE.md` allows, as it does pdf.js, KaTeX and mermaid:
// zxing is heavy and only a scan needs it, so a page that never scans does not load it.
// Forgotten when it fails, so the next scan asks again.
const loadZxing = loadOnce(() => import("@/lib/barcode-zxing"));

/**
 * The decoder this device can run: BarcodeDetector where it reads all four formats,
 * else zxing. Rejects only when zxing does not load.
 */
export async function decoderFor(): Promise<Decoder> {
  const native = (globalThis as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
  if (native !== undefined) {
    const supported = await native.getSupportedFormats();
    if (FORMATS.every((format) => supported.includes(format))) {
      const detector = new native({ formats: FORMATS });
      return async (video) => {
        const found = (await detector.detect(video))[0];
        return found === undefined ? null : readOf(found.rawValue, found.format);
      };
    }
  }
  const { decodeImageData } = await loadZxing();
  const canvas = document.createElement("canvas");
  return async (video) => {
    // A frame has no pixels until the video has its size, so there is nothing to read yet.
    if (video.videoWidth === 0) return null;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (context === null) return null;
    context.drawImage(video, 0, 0);
    const found = decodeImageData(context.getImageData(0, 0, canvas.width, canvas.height));
    return found === null ? null : readOf(found.text, found.format);
  };
}
