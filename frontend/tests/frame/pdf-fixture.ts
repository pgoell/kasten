/**
 * A small pdf built in code, for the frame tests that draw one: a page of text
 * with a raster image beside it, a page of text, and a page whose words are the
 * markdown a take turns into a note, so the pane is shown them as text and not
 * as markup.
 */

/** The page size in pdf points, which is US letter. */
export const PAGE_WIDTH = 612;
export const PAGE_HEIGHT = 792;

/** Page one's image, in pdf points from the bottom left of the page. */
export const IMAGE_BOX = { x: 360, y: 400, width: 200, height: 100 };

/** The lines each page shows, top to bottom. */
export const PAGE_ONE = ["A passage worth taking", "The first page of the fixture."];
export const PAGE_TWO = ["The second page."];
export const PAGE_THREE = ["## Dump", "- [ ] todo", "[[x]]", "#tag", "```"];

/** A part of an object: its text, or its bytes once it is a stream. */
type Part = string | Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();

/** Lines in Helvetica, 18 points, from the top left and 28 points apart. */
function textStream(lines: string[]): string {
  const shown = lines.map((line) => `(${line}) Tj 0 -28 Td`).join(" ");
  return `BT /F1 18 Tf 50 720 Td ${shown} ET`;
}

/** The image is 4 by 4 pixels: the left two columns pure red, the right two pure blue. */
function imageStream(): Part[] {
  const pixels = new Uint8Array(4 * 4 * 3);
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      const at = (row * 4 + column) * 3;
      const red = column < 2;
      pixels[at] = red ? 255 : 0;
      pixels[at + 2] = red ? 0 : 255;
    }
  }
  return [
    `<< /Type /XObject /Subtype /Image /Width 4 /Height 4 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${pixels.length} >>\nstream\n`,
    pixels,
    "\nendstream",
  ];
}

/**
 * The pdf as bytes. Objects are numbered as they are written: the catalog, the
 * page tree, the font, the image, the three pages, then their three contents.
 * The cross-reference table records where each object starts, so a reader that
 * uses it finds them.
 */
export function textAndImagePdf(): Blob {
  const { x, y, width, height } = IMAGE_BOX;
  const contents = [
    `${textStream(PAGE_ONE)} q ${width} 0 0 ${height} ${x} ${y} cm /Im1 Do Q`,
    textStream(PAGE_TWO),
    textStream(PAGE_THREE),
  ];
  const bodies: Part[][] = [
    ["<< /Type /Catalog /Pages 2 0 R >>"],
    ["<< /Type /Pages /Kids [5 0 R 6 0 R 7 0 R] /Count 3 >>"],
    ["<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"],
    imageStream(),
    ...contents.map((_, index) => [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R >> /XObject << /Im1 4 0 R >> >> /Contents ${8 + index} 0 R >>`,
    ]),
    ...contents.map((content) => [
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    ]),
  ];

  const chunks: BlobPart[] = [];
  const offsets: number[] = [];
  let size = 0;
  const write = (part: Part) => {
    const bytes = typeof part === "string" ? encoder.encode(part) : part;
    chunks.push(bytes);
    size += bytes.length;
  };

  write("%PDF-1.4\n");
  bodies.forEach((body, index) => {
    offsets.push(size);
    write(`${index + 1} 0 obj\n`);
    for (const part of body) write(part);
    write("\nendobj\n");
  });
  const xref = size;
  write(`xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`);
  for (const offset of offsets) write(`${String(offset).padStart(10, "0")} 00000 n \n`);
  write(`trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  return new Blob(chunks, { type: "application/pdf" });
}
