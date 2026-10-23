import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { TakeButton } from "@/components/take-button-view";
import { useDumpTake } from "@/components/use-dump-take";
import { fileOf } from "@/lib/html-take";
import { type Anchor, low, placeFor } from "@/lib/page-selection";
import { offsetsIn, oneLine, pdfLink, pdfQuote, rangeIn, takenHighlight } from "@/lib/pdf-take";
import { usePressGuard } from "@/lib/take-button";
import { useViewport } from "@/lib/use-viewport";

/** The selection held for a take: its words, the page its start is on, and where its button goes. */
interface Held {
  text: string;
  page: number;
  /** A copy of the selection's range, since the browser's own moves with it. */
  range: Range;
  at: Anchor | null;
}

/** One text layer's share of a take, as offsets into that layer, and the range it is painted with. */
interface Part {
  page: number;
  start: number;
  end: number;
  range: Range | null;
}

/** The page a node sits on, read from the slot the viewer puts round each page. */
function pageOf(node: Node): number | null {
  const element = node instanceof Element ? node : node.parentElement;
  const slot = element?.closest<HTMLElement>("[data-pdf-page]");
  return slot ? Number(slot.dataset.pdfPage) : null;
}

/** Whether both ends of `range` lie inside `box`. */
function within(box: Element | null, range: Range | null): range is Range {
  if (box === null || range === null) return false;
  return box.contains(range.startContainer) && box.contains(range.endContainer);
}

/** The text layer drawn for `page`, or null where the page has none drawn at the moment. */
function layerOf(box: Element, page: number): Element | null {
  return box.querySelector(`[data-pdf-page="${page}"] .textLayer`);
}

/** The parts a range makes: one per text layer it reaches into, in the layer's own offsets. */
function partsOf(box: Element, range: Range): Part[] {
  const parts: Part[] = [];
  for (const layer of Array.from(box.querySelectorAll(".textLayer"))) {
    if (!range.intersectsNode(layer)) continue;
    const page = pageOf(layer);
    const found = page === null ? null : offsetsIn(layer, range);
    if (page !== null && found !== null) {
      parts.push({ page, start: found.start, end: found.end, range: null });
    }
  }
  return parts;
}

/**
 * Paint a part on `layer`, the page's text layer as it is now, taking off the
 * range it had before. The highlight is the document's one, shared by every
 * PDF pane, so only this part's own range leaves it.
 */
function paint(part: Part, layer: Element | null) {
  const highlight = takenHighlight();
  if (part.range !== null) highlight?.delete(part.range);
  part.range = layer === null ? null : rangeIn(layer, part.start, part.end);
  if (part.range !== null) highlight?.add(part.range);
}

/** Take the parts' ranges off the highlight. */
function unpaint(parts: Part[]) {
  const highlight = takenHighlight();
  for (const part of parts) {
    if (part.range !== null) highlight?.delete(part.range);
    part.range = null;
  }
}

/**
 * Where the button goes for a range: above the range's last rectangle with a
 * mouse, and below it on a touch screen (`placeFor`, which reads the rectangle
 * from the frame's own corner, so the box stands in for the frame here).
 */
function anchorFor(
  range: Range,
  box: Element,
  wrapper: HTMLDivElement,
  coarse: boolean,
): Anchor | null {
  const rects = range.getClientRects();
  const last = rects[rects.length - 1];
  if (last === undefined) return null;
  const origin = box.getBoundingClientRect();
  const relative = {
    left: last.left - origin.left,
    top: last.top - origin.top,
    right: last.right - origin.left,
    bottom: last.bottom - origin.top,
  };
  return placeFor(box, wrapper, relative, coarse);
}

/**
 * The take from a PDF's selection, the way the HTML pane takes from its page:
 * the button over the words, `y`, and the mark the take leaves on the pages.
 *
 * `box` holds the pages (each slot is `data-pdf-page`, with its text layer in
 * it), and `wrapper` is the box the button and the toast sit in.
 */
export function usePdfTake(o: {
  path: string;
  box: RefObject<HTMLElement | null>;
  wrapper: RefObject<HTMLDivElement | null>;
  archive: boolean;
}): {
  /** The Take button over the selection and the toast; render inside the wrapper (position: relative). */
  overlay: ReactNode;
  /** `y` with a passage held takes it; true when it handled the key (then preventDefault). */
  onKeyDown(event: ReactKeyboardEvent): boolean;
  /** For showPdf's onText: a page's text layer was drawn again, so its marks go back on. */
  onText(page: number, layer: HTMLElement): void;
  /** A new pdf or a reopen: drop the held passage, the toast and the marks. */
  forget(): void;
} {
  const { path, box, wrapper, archive } = o;
  // A touch screen's button goes under the words. Read by the selection's
  // listener, which is added once, so it is mirrored in a layout effect.
  const { coarse } = useViewport();
  const coarseRef = useRef(coarse);
  useLayoutEffect(() => {
    coarseRef.current = coarse;
  });

  // The held selection, mirrored in a ref for the reason `html-pane.tsx` gives:
  // the listener reads it as it is now, and a `y` answered a render late would
  // take the one before.
  const [held, setHeld] = useState<Held | null>(null);
  const heldRef = useRef<Held | null>(null);
  const hold = useCallback((next: Held | null) => {
    heldRef.current = next;
    setHeld(next);
  }, []);

  /** A collapse during a press on the button, which the press guard holds back (see `html-pane.tsx`). */
  const lost = useRef(false);
  const { pressing, press } = usePressGuard(() => {
    if (lost.current) {
      lost.current = false;
      hold(null);
    }
  });

  /** This pane's marks, by take id: the parts each take painted. */
  const marks = useRef(new Map<number, Part[]>());

  const dump = useDumpTake({
    archive,
    onMarked: () => {
      hold(null);
      // Taken, so the words are no longer a selection the reader is making.
      document.getSelection()?.removeAllRanges();
    },
    onUnmarked: (id) => {
      const parts = marks.current.get(id);
      if (parts !== undefined) unpaint(parts);
      marks.current.delete(id);
    },
  });
  const dumpForget = dump.forget;

  const forget = useCallback(() => {
    lost.current = false;
    hold(null);
    for (const parts of marks.current.values()) unpaint(parts);
    marks.current.clear();
    dumpForget();
  }, [hold, dumpForget]);

  useEffect(() => {
    function onSelectionChange() {
      const selection = document.getSelection();
      const range = selection !== null && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      const text = selection === null ? "" : oneLine(selection.toString());
      const frame = box.current;
      // A selection counts only where its range lies in the pages, so one in the
      // rest of the document cannot put a button on the reader's pane.
      const page = within(frame, range) ? pageOf(range.startContainer) : null;
      if (range === null || page === null || text.trim() === "") {
        // The press on the button collapses the selection, which is not a choice
        // the reader made, so the passage is kept through it.
        if (pressing.current) lost.current = true;
        else hold(null);
        return;
      }

      // A new selection is a new press's own business, not the last one's collapse.
      lost.current = false;
      const pane = wrapper.current;
      const at =
        pane === null || frame === null ? null : anchorFor(range, frame, pane, coarseRef.current);
      hold({ text, page, range: range.cloneRange(), at });
    }
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [box, wrapper, hold, pressing]);

  // The marks come off the highlight when the pane goes, so they do not outlive it.
  const markMap = marks.current;
  useEffect(
    () => () => {
      for (const parts of markMap.values()) unpaint(parts);
      markMap.clear();
    },
    [markMap],
  );

  async function takeHeld() {
    pressing.current = false;
    lost.current = false;
    const taken = heldRef.current;
    if (taken === null) return;
    heldRef.current = null;

    const frame = box.current;
    const parts = frame === null ? [] : partsOf(frame, taken.range);
    const kept = await dump.take({
      quote: pdfQuote(path, taken.page, taken.text),
      text: taken.text,
      link: pdfLink(path, taken.page),
      source: `page ${taken.page}, ${fileOf(path)}`,
      top: low(taken.at),
      // Each take carries its own parts, so takes in flight cannot mix them.
      onKept: (id) => {
        marks.current.set(id, parts);
        const pages = box.current;
        for (const part of parts) {
          paint(part, pages === null ? null : layerOf(pages, part.page));
        }
      },
    });
    if (!kept) hold(taken);
  }

  function onKeyDown(event: ReactKeyboardEvent): boolean {
    if (event.key !== "y" || event.ctrlKey || event.altKey || event.metaKey) return false;
    if (heldRef.current === null) return false;
    event.preventDefault();
    void takeHeld();
    return true;
  }

  function onText(page: number, layer: HTMLElement) {
    for (const parts of marks.current.values()) {
      for (const part of parts) if (part.page === page) paint(part, layer);
    }
  }

  const overlay = (
    <>
      {held?.at && (
        <TakeButton
          at={held.at}
          label={`page ${held.page}`}
          press={press}
          onTake={() => void takeHeld()}
        />
      )}
      {dump.toast}
    </>
  );

  return { overlay, onKeyDown, onText, forget };
}
