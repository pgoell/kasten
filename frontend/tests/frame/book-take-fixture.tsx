/**
 * The book pane mounted for the take tests (#789): a take written into the
 * stubbed vault (`./html-take-api`), read back from it, and the marks drawn from
 * that note. `./book-pane-fixture` mocks the note and cannot see a take land, so
 * these tests mount the pane themselves.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { flushSync } from "react-dom";
import { BookPane } from "@/components/book-pane";
import { updateNote } from "@/lib/api";
import type { FoliateView } from "@/lib/book/foliate-view";
import { addHighlight, type Passage } from "@/lib/highlight";
import { quoteParagraphs } from "@/lib/html-take";
import { newId } from "@/lib/todo/todo";
import "@/styles/app.css";
import { clickInside, located, sections } from "./book-pane-fixture";
import type { Mounted } from "./html-take-fixture";

/** The first paragraph of the plain fixture's first chapter, the words the tests select. */
export const PARA = "First paragraph.";

/** The take as the workspace writes it: the passage under the note's highlights, and the id it returns. */
function takeInto(client: QueryClient, note: string) {
  return async (passage: Passage): Promise<string | null> => {
    const id = newId("hl-");
    const escaped: Passage = {
      ...passage,
      text: quoteParagraphs(passage.text).join("\n"),
      chapter: quoteParagraphs(passage.chapter).join(" "),
    };
    const landed = await updateNote(note, (text) => addHighlight(text, escaped, id));
    if (landed === null) return null;
    void client.invalidateQueries({ queryKey: ["note", note] });
    return id;
  };
}

/** One pane per note, side by side, each the height of the viewport. */
export function mountBooks(mounted: Mounted, notes: string[]): void {
  // A client per mount, so one test's cache does not answer the next.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  flushSync(() =>
    mounted.root.render(
      <QueryClientProvider client={client}>
        <div className="flex h-dvh flex-row">
          {notes.map((note) => (
            <div key={note} data-pane-note={note} className="flex min-w-0 flex-1 flex-col">
              <BookPane
                note={note}
                paths={notes}
                commands={mounted.spy}
                focusSignal={1}
                onFocus={() => {}}
                onMoved={() => {}}
                onLeaving={() => {}}
                onTake={takeInto(client, note)}
                archive={false}
                onNoteBeside={() => {}}
                onNotice={() => {}}
              />
            </div>
          ))}
        </div>
      </QueryClientProvider>,
    ),
  );
}

/** The pane of `note`. */
export function paneOf(mounted: Mounted, note: string): HTMLElement {
  return mounted.host.querySelector(`[data-pane-note="${note}"]`) as HTMLElement;
}

/** The note a section document belongs to, found by walking out of its iframe through the shadow roots. */
function noteOfSection(doc: Document): string | null {
  let node: Node | null = doc.defaultView?.frameElement ?? null;
  while (node !== null) {
    if (node instanceof Element && node.hasAttribute("data-pane-note")) {
      return node.getAttribute("data-pane-note");
    }
    node = node.parentNode ?? (node instanceof ShadowRoot ? node.host : null);
  }
  return null;
}

/** The section document of the pane holding `note`, once that book has drawn a chapter. */
export async function sectionOf(note: string): Promise<Document> {
  return vi.waitFor(
    () => {
      expect(located.length).toBeGreaterThan(0);
      const doc = sections.find((one) => noteOfSection(one) === note);
      expect(doc).toBeDefined();
      return doc as Document;
    },
    { timeout: 10_000 },
  );
}

/** Clicks into the section at its first paragraph, so the pane holds the focus a selection needs. */
export async function focusPara(mounted: Mounted, note: string, doc: Document): Promise<void> {
  // The columns come a moment after the text, and a click aimed before they land hits a column.
  const pane = paneOf(mounted, note);
  // Ready when the columns are drawn, the paragraph is in the pane, and the layout reads the same twice running.
  let previous = "";
  await until(() => {
    const now = layoutOf(doc, pane);
    const still = now === previous;
    previous = now;
    return columnsSettled(pane) && paraInPane(doc, pane) && still;
  });
  await clickInside(pane, doc, "#para");
}

/** The rectangles a click depends on, as one string, so two reads that agree mean nothing moved. */
function layoutOf(doc: Document, pane: HTMLElement): string {
  return JSON.stringify([
    doc.querySelector("#para")?.getBoundingClientRect(),
    doc.defaultView?.frameElement?.getBoundingClientRect(),
    pane.getBoundingClientRect(),
  ]);
}

/** Whether the first paragraph of the section is laid out inside the pane, where a click reaches it. */
function paraInPane(doc: Document, pane: HTMLElement): boolean {
  const frame = doc.defaultView?.frameElement;
  const para = doc.querySelector("#para");
  if (!frame || !para) return false;
  const outer = frame.getBoundingClientRect();
  const inner = para.getBoundingClientRect();
  const box = pane.getBoundingClientRect();
  const top = outer.top + inner.top;
  return top >= box.top && top + inner.height <= box.bottom;
}

/**
 * Whether a pane has drawn the columns its width asks for. They land one after the other,
 * and each shifts the text, so a click aimed before the last one hits the wrong place.
 */
export function columnsSettled(pane: HTMLElement): boolean {
  const width = pane.getBoundingClientRect().width;
  const contents = pane.querySelector('nav[aria-label="Book contents"]') !== null;
  const note = pane.querySelector('section[aria-label="Taken"]') !== null;
  if (width < 960) return true;
  return width < 1280 ? contents : contents && note;
}

/**
 * Waits until `ready` holds, for at most `timeout` ms. Nothing is returned either way:
 * the assertions after it say what did not land, so a red run still reaches them.
 */
export async function until(ready: () => boolean, timeout = 3_000): Promise<void> {
  await vi
    .waitFor(
      () => {
        if (!ready()) throw new Error("not yet");
      },
      { timeout, interval: 50 },
    )
    .catch(() => undefined);
}

/** Selects the whole first paragraph of the section, as a drag over it does. */
export function selectPara(doc: Document): void {
  const node = (doc.querySelector("#para") as HTMLElement).firstChild as Node;
  const selection = doc.defaultView?.getSelection() as Selection;
  selection.removeAllRanges();
  selection.setBaseAndExtent(node, 0, node, node.textContent?.length ?? 0);
}

/** The take button drawn in a pane. */
export function takeIn(mounted: Mounted, note: string): HTMLElement | null {
  return paneOf(mounted, note).querySelector<HTMLElement>("[data-take]");
}

/** The toast's text in a pane, or "" when no toast shows there. */
export function toastIn(mounted: Mounted, note: string): string {
  return paneOf(mounted, note).querySelector('[role="status"]')?.textContent ?? "";
}

/** The marks drawn over the section in a pane: one `g` for each highlight. */
export function marksIn(mounted: Mounted, note: string): SVGGElement[] {
  const view = paneOf(mounted, note).querySelector("foliate-view") as FoliateView;
  const overlayer = view.renderer?.getContents?.()[0]?.overlayer;
  return [...(overlayer?.element.querySelectorAll("g") ?? [])];
}

/** A plain note the vault holds before a take, with no highlights yet. */
export const PLAIN = "# Plain\n";
