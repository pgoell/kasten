import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot, type Root } from "react-dom/client";
import { page } from "vitest/browser";
import { BookPane } from "@/components/book-pane";
import { fetchBook, fetchNote } from "@/lib/api";
import { backImages, treatmentFor } from "@/lib/book/book-backing";
import { THEME_KEY } from "@/lib/theme";
// A book written for a white page, `body { color: #000; background: #fff }`,
// with a cover page first and two chapters after it. The cover page holds only
// `#cover`, `cover.png`, an opaque 300x450 portrait gradient fitted to the page
// with `width: 100%; height: 100%; object-fit: contain`, so its box is the
// page's shape and the picture letterboxes inside it. Chapter one (`One`) holds
// an h1, paragraphs of text, `#ornament` inline in `#ornate` (`ornament.png`, a
// 16x16 black circle on transparent, the size of the text round it), `#art`
// (`art.png`, the 64x64 black lines on transparent from `dark-text.epub`) and
// `#photo` (`photo.png`, an opaque 200x120 plasma). Chapter two (`Two`) holds a
// paragraph and `#photo2`, the same opaque png, for the case after a turn.
import coverUrl from "../fixtures/cover.epub?url";
import { stubCommands } from "../stub-commands";
// The app's own stylesheet, because the pane is sized by Tailwind's `h-full`
// and a paginator with nothing to columnise into draws no page.
import "@/styles/app.css";

export const NOTE = "20 Literature/Cover.md";

/** The top of chapter one, the second `itemref`, which skips the cover page. */
export const CHAPTER_ONE = "epubcfi(/6/4!/4/2/1:0)";

export const TRANSPARENT = "rgba(0, 0, 0, 0)";
export const WHITE = "rgb(255, 255, 255)";

/**
 * Turns the dark page on before the book opens. The ink inversion is the dark
 * page's, and the page is only written with it there. The choice is stored,
 * because `currentTheme` reads storage and not `data-theme`.
 */
export function darkPage(): void {
  localStorage.setItem(THEME_KEY, "dark");
}

/** Takes the stored choice back, so the next case starts from the system's theme. */
export function clearPage(): void {
  localStorage.removeItem(THEME_KEY);
}

/** Every section document foliate reported, which is the only way inside. */
export const sections: Document[] = [];

// In the capture phase and before anything mounts, because `view.init()`
// loads the first section during mount.
document.addEventListener(
  "load",
  (event) => {
    const { doc } = (event as CustomEvent<{ doc?: Document }>).detail ?? {};
    if (doc) sections.push(doc);
  },
  true,
);

/** Wait for the rest of `draw` to run, which the `load` event is in the middle of. */
export function drawn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 300));
}

/** One property of one element of a section, as the section computes it. */
export function computed(
  doc: Document,
  selector: string,
  property: "backgroundColor" | "filter",
): string {
  const element = doc.querySelector(selector);
  if (!element) throw new Error(`nothing at ${selector} inside the book`);
  return (doc.defaultView as Window).getComputedStyle(element)[property];
}

/** An image of a section, once its pixels have arrived. */
export async function loaded(doc: Document, selector: string): Promise<HTMLImageElement> {
  const image = doc.querySelector(selector) as HTMLImageElement;
  await vi.waitFor(
    () => {
      expect(image.complete).toBe(true);
      expect(image.naturalWidth).toBeGreaterThan(0);
    },
    { timeout: 10_000 },
  );
  return image;
}

/** The section foliate loaded last, once it is the one titled `title`. */
export async function section(title: string): Promise<Document> {
  await vi.waitFor(() => expect(sections.at(-1)?.title).toBe(title), { timeout: 10_000 });
  await drawn();
  return sections.at(-1) as Document;
}

/** Turn pages until the section titled `title` is the one drawn. */
export async function turnTo(container: HTMLElement, title: string): Promise<Document> {
  const view = container.querySelector("foliate-view") as HTMLElement & {
    next: () => Promise<void>;
  };
  // A turn the paginator's lock drops is simply tried again.
  await vi.waitFor(
    async () => {
      await view.next();
      expect(sections.at(-1)?.title).toBe(title);
    },
    { timeout: 15_000, interval: 200 },
  );
  await drawn();
  return sections.at(-1) as Document;
}

/** The reader a test mounted, as the test file's `mounted` variable keeps it. */
export type Mounted = { root: Root; container: HTMLElement };

/** The test file's `mounted` variable, which the helpers here and the test bodies both read. */
export interface MountedSlot {
  get: () => Mounted | null;
  set: (mounted: Mounted | null) => void;
}

let slot: MountedSlot = { get: () => null, set: () => {} };

/** The hook each book-cover test file calls first, with its `mounted`: the reader drawn is kept there. */
export function keepMounted(mounted: MountedSlot): void {
  slot = mounted;
}

/** Mount the reader over the fixture, at `reading` if given, in a pane `width` wide. */
export async function drawBook(reading = "", width = 600): Promise<HTMLElement> {
  vi.mocked(fetchBook).mockResolvedValue({
    path: NOTE.replace(/\.md$/, ".epub"),
    blob: await (await fetch(coverUrl)).blob(),
  });
  vi.mocked(fetchNote).mockResolvedValue(
    reading ? `---\nid: one\nreading: ${reading}\n---\n# Cover\n` : "",
  );
  const container = document.createElement("div");
  container.style.cssText = `width: ${width}px; height: 700px;`;
  document.body.append(container);

  const root = createRoot(container);
  slot.set({ root, container });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  root.render(
    <QueryClientProvider client={client}>
      <BookPane
        note={NOTE}
        paths={[NOTE]}
        commands={stubCommands()}
        focusSignal={0}
        onFocus={() => {}}
        onMoved={() => {}}
        onLeaving={() => {}}
        onTake={async () => null}
        archive={false}
        onNoteBeside={() => {}}
        onNotice={() => {}}
      />
    </QueryClientProvider>,
  );
  return container;
}

/**
 * Chapter one, drawn, once the line art has its white.
 *
 * The backing lands after an image loads, so the white under `#art` is the sign
 * that the section's images have been looked at. Asserting that another image
 * has none before then would pass on a page nothing has looked at yet.
 */
export async function chapterOne(): Promise<Document> {
  await drawBook(CHAPTER_ONE);
  const doc = await section("One");
  await loaded(doc, "#art");
  await vi.waitFor(() => expect(computed(doc, "#art", "backgroundColor")).toBe(WHITE), {
    timeout: 10_000,
  });
  return doc;
}

/**
 * A 16px red circle on transparent, set into `#ornate` beside the ornament and
 * decided, its verdict landed.
 *
 * The fixture holds no coloured icon, so one is drawn here.
 */
export async function redIcon(doc: Document): Promise<HTMLImageElement> {
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 16;
  const context = canvas.getContext("2d") as CanvasRenderingContext2D;
  context.fillStyle = "red";
  context.arc(8, 8, 7, 0, 2 * Math.PI);
  context.fill();
  const icon = doc.createElement("img");
  icon.id = "icon";
  icon.alt = "!";
  icon.src = canvas.toDataURL();
  icon.style.cssText = "width: 16px; height: 16px;";
  (doc.querySelector("#ornate") as HTMLElement).append(" and an icon ", icon);

  backImages(doc);
  // The same decision `backImages` waits on, so the attributes have landed after it.
  expect(await treatmentFor(icon)).toBe("plain");
  return icon;
}

/** A png of `width` by `height` as a data URL, with a black bar across a clear ground, or all clear. */
export function png(width: number, height: number, bar = true): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  if (bar) (canvas.getContext("2d") as CanvasRenderingContext2D).fillRect(0, 10, width, 10);
  return canvas.toDataURL();
}

/**
 * Set the shapes #481 to #483 are about into chapter one, decided and loaded.
 *
 * After `#ornate` come `#strip`, an 800x48 black bar on transparent under
 * `max-width: 100%`, which is taller than 1.5em of the 16px text only in a
 * wide page's column, about 470px against a phone's 330; `#spacer`,
 * a transparent 1x1 stretched 40px tall; and `#more`, a `hidden` div holding
 * `#hidden`, the ornament at 16px. Not a closed `<details>`: Chromium hides
 * its content with `content-visibility` and still lays it out, at its own
 * size, where `display: none` lays it out at nothing. Into `#ornate` goes `#glyph`, a 1em
 * svg drawing the ornament through an `<image>`.
 */
export async function additions(doc: Document): Promise<void> {
  const ornament = (doc.querySelector("#ornament") as HTMLImageElement).src;
  const paragraph = (...children: Node[]) => {
    const p = doc.createElement("p");
    p.append(...children);
    return p;
  };
  const strip = doc.createElement("img");
  strip.id = "strip";
  strip.alt = "";
  strip.src = png(800, 48);
  strip.style.cssText = "max-width: 100%;";
  const spacer = doc.createElement("img");
  spacer.id = "spacer";
  spacer.alt = "";
  spacer.src = png(1, 1, false);
  spacer.style.cssText = "width: 100%; height: 40px;";
  const hidden = doc.createElement("img");
  hidden.id = "hidden";
  hidden.alt = "*";
  hidden.src = ornament;
  hidden.style.cssText = "width: 16px; height: 16px;";
  const more = doc.createElement("div");
  more.id = "more";
  more.hidden = true;
  more.append(paragraph(doc.createTextNode("A glyph "), hidden));
  const ornate = doc.querySelector("#ornate") as HTMLElement;
  ornate.after(paragraph(strip), paragraph(spacer), more);

  const glyph = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  glyph.id = "glyph";
  glyph.setAttribute("width", "1em");
  glyph.setAttribute("height", "1em");
  const image = doc.createElementNS("http://www.w3.org/2000/svg", "image");
  image.setAttribute("href", ornament);
  image.setAttribute("width", "100%");
  image.setAttribute("height", "100%");
  glyph.append(image);
  ornate.append(" and a glyph ", glyph);

  backImages(doc);
  for (const selector of ["#strip", "#spacer", "#hidden"]) await loaded(doc, selector);
  await drawn();
}

/** Put the page and the pane at `width`, so the paginator lays the chapter out again. */
export async function widen(width: number): Promise<void> {
  await page.viewport(width, 800);
  const container = slot.get()?.container as HTMLElement;
  container.style.cssText = `width: ${width}px; height: 700px;`;
  await drawn();
}

/** Wait for `#strip` to be on white at a wide page and inverted at a narrow one. */
export function stripAt(doc: Document, width: number): Promise<void> {
  const wide = width > 600;
  return vi.waitFor(
    () => {
      expect(computed(doc, "#strip", "backgroundColor")).toBe(wide ? WHITE : TRANSPARENT);
      expect(computed(doc, "#strip", "filter")).toBe(wide ? "none" : "invert(1)");
    },
    { timeout: 5_000 },
  );
}
