/**
 * zxing's reader for the four barcode formats, on the pixels of one video frame.
 *
 * Only `barcode.ts` loads this, and only where BarcodeDetector cannot read the formats.
 */

import {
  BarcodeFormat,
  BinaryBitmap,
  ChecksumException,
  DecodeHintType,
  FormatException,
  HybridBinarizer,
  MultiFormatOneDReader,
  NotFoundException,
  RGBLuminanceSource,
} from "@zxing/library";
import type { Format } from "@/lib/log/barcode";

const NAMES = new Map<BarcodeFormat, Format>([
  [BarcodeFormat.EAN_13, "ean_13"],
  [BarcodeFormat.EAN_8, "ean_8"],
  [BarcodeFormat.UPC_A, "upc_a"],
  [BarcodeFormat.UPC_E, "upc_e"],
]);

/** The barcode in an image's pixels, or null where the image holds none that reads. */
export function decodeImageData(data: ImageData): { text: string; format: Format } | null {
  const { width, height } = data;
  // zxing reads one luminance byte a pixel, where canvas gives four bytes RGBA.
  const luminances = new Uint8ClampedArray(width * height);
  for (let i = 0; i < luminances.length; i++) {
    const [r = 0, g = 0, b = 0] = data.data.subarray(i * 4, i * 4 + 3);
    luminances[i] = (r * 306 + g * 601 + b * 117) >> 10;
  }
  const bitmap = new BinaryBitmap(
    new HybridBinarizer(new RGBLuminanceSource(luminances, width, height)),
  );
  const hints = new Map<DecodeHintType, unknown>([
    [DecodeHintType.POSSIBLE_FORMATS, [...NAMES.keys()]],
    [DecodeHintType.TRY_HARDER, true],
  ]);
  try {
    // MultiFormatReader would read these formats too, but it logs a console warning for every
    // frame without a barcode, and a scan reads several frames a second.
    const result = new MultiFormatOneDReader(hints).decode(bitmap, hints);
    const format = NAMES.get(result.getBarcodeFormat());
    return format === undefined ? null : { text: result.getText(), format };
  } catch (error) {
    // A frame with no barcode, or one that does not check out, is a frame to read again.
    if (
      error instanceof NotFoundException ||
      error instanceof ChecksumException ||
      error instanceof FormatException
    ) {
      return null;
    }
    throw error;
  }
}
