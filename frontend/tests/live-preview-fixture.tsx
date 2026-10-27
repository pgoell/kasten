import { forceParsing } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act, type RenderResult, render, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { vimKeys } from "@/lib/editor/vim-mode";
import { type EmbedSource, embedSource } from "@/lib/embed";
import { imagePaths } from "@/lib/image";
import { livePreview } from "@/lib/live/live-preview";
import { noteLanguage } from "@/lib/note-language";
import { type PdfFile, type PdfRenderer, pdfRenderer } from "@/lib/pdf-view";
import { vaultPaths } from "@/lib/wikilink";

/**
 * Helpers the live-preview test files share. Each of those files calls
 * `liveHooks()` at top level, before any describe, so every test in it gets the
 * editor cleanup.
 */

export function content(container: HTMLElement): string {
  return (container.querySelector(".cm-content") as HTMLElement).textContent ?? "";
}

/**
 * Parses the whole note before a test reads the first draw.
 *
 * CodeMirror gives the parse at state creation 20ms of wall clock and leaves the
 * rest to an idle callback. On a loaded machine the tree, and so the drawing
 * built from it, can stop partway (#365). A partial first draw is fine in the
 * app; a test that counts bullets at once needs the whole tree. A nested embed
 * view gets the same 20ms when it is built (#1008), so every `.cm-editor` under
 * the view is parsed too, and the ones a parse draws deeper, until none is new.
 */
export function parsed(view: EditorView): void {
  act(() => {
    forceParsing(view, view.state.doc.length, 5000);
    let found = -1;
    while (found !== view.dom.querySelectorAll(".cm-editor").length) {
      const editors = view.dom.querySelectorAll<HTMLElement>(".cm-editor");
      found = editors.length;
      for (const el of editors) {
        const nested = EditorView.findFromDOM(el) as EditorView;
        forceParsing(nested, nested.state.doc.length, 5000);
      }
    }
  });
}

/**
 * Runs `step` on a clock that jumps 30ms at every read, so a parse inside it
 * runs out of the 20ms CodeMirror gives each edit, as it can on a loaded
 * machine (#1005). Returns what `step` returns.
 */
export function stalled<T>(step: () => T): T {
  let now = Date.now();
  const clock = vi.spyOn(Date, "now").mockImplementation(() => {
    now += 30;
    return now;
  });
  try {
    return step();
  } finally {
    clock.mockRestore();
  }
}

/** `render` for an `Editor`, its note parsed to the end. */
export function renderEditor(ui: ReactElement): RenderResult {
  const result = render(ui);
  const dom = result.container.querySelector(".cm-editor") as HTMLElement;
  parsed(EditorView.findFromDOM(dom) as EditorView);
  return result;
}

/**
 * A vault the embed reads out of a map, answering at once.
 *
 * The listeners are kept so a test can change a note under an embed that is
 * already on the screen, which is what a save from another pane does.
 */
export function fakeVault(notes: Record<string, string>) {
  const texts = new Map(Object.entries(notes));
  const listeners = new Map<string, Set<(text: string | null) => void>>();
  const watched: string[] = [];
  const opened: [string, number | undefined][] = [];
  const source: EmbedSource = {
    watch(path, listener) {
      watched.push(path);
      const set = listeners.get(path) ?? new Set();
      listeners.set(path, set);
      set.add(listener);
      listener(texts.get(path) ?? null);
      return () => set.delete(listener);
    },
    open(path, line) {
      opened.push([path, line]);
    },
  };
  return {
    source,
    watched,
    opened,
    /** How many embeds are listening to the note right now. */
    listening: (path: string) => listeners.get(path)?.size ?? 0,
    push(path: string, text: string | null) {
      if (text === null) texts.delete(path);
      else texts.set(path, text);
      for (const listener of listeners.get(path) ?? []) listener(text);
    },
  };
}

export const mounted: EditorView[] = [];

/** The top-level cleanup, which empties `mounted` after every test in the file. */
export function liveHooks() {
  afterEach(() => {
    for (const view of mounted.splice(0)) {
      view.destroy();
      view.dom.parentElement?.remove();
    }
  });
}

/** An editor in the document, the way the app mounts one, with `extra` on. */
export function mount(doc: string, extra: Extension[], anchor = 0): EditorView {
  const parent = document.body.appendChild(document.createElement("div"));
  const view = new EditorView({
    state: EditorState.create({ doc, selection: { anchor }, extensions: [noteLanguage(), extra] }),
    parent,
  });
  mounted.push(view);
  parsed(view);
  return view;
}

/** Vim off, so the cursor's line alone shows the source, on a known vault. */
export function plain(source: EmbedSource | null, paths: string[] = ["b.md"]): Extension[] {
  return [
    vimKeys.of(false),
    livePreview(),
    vaultPaths.of(paths),
    imagePaths.of(["99 Misc/my shot.png"]),
    ...(source ? [embedSource.of(source)] : []),
  ];
}

/** The text of the note the embed draws, read off its nested view. */
export function embedded(view: EditorView): string {
  return view.dom.querySelector(".cm-embed .cm-content")?.textContent ?? "";
}

/** The first line is prose so the cursor, at offset zero, is off the embed. */
export const ABOVE = "intro\n\n";

/** Pdfs by URL and page count; a URL not listed fails to load. */
export function fakePdfs(files: Record<string, number>) {
  const opened: string[] = [];
  /** Each page drawn, as its number and the scale it was drawn at. */
  const drawn: [number, number][] = [];
  let freed = 0;
  const renderer: PdfRenderer = {
    open(url) {
      opened.push(url);
      const pages = files[url];
      const file: PdfFile | undefined =
        pages === undefined
          ? undefined
          : {
              pages,
              page: async (number) => ({
                width: 600,
                height: 800,
                draw: async (_canvas, scale) => {
                  drawn.push([number, scale]);
                },
              }),
            };
      return {
        file: file === undefined ? Promise.reject(new Error("Invalid PDF")) : Promise.resolve(file),
        destroy: () => {
          freed += 1;
        },
      };
    },
  };
  return { renderer, opened, drawn, freed: () => freed };
}

/** A `ResizeObserver` that reports nothing until a test says a box changed size. */
export class FakeResizer {
  static all: FakeResizer[] = [];
  readonly observed = new Set<Element>();
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    FakeResizer.all.push(this);
  }

  observe(target: Element) {
    this.observed.add(target);
  }

  disconnect() {
    this.observed.clear();
  }

  static resize(target: Element) {
    for (const observer of FakeResizer.all) {
      if (!observer.observed.has(target)) continue;
      const entry = { target } as ResizeObserverEntry;
      observer.callback([entry], observer as unknown as ResizeObserver);
    }
  }
}

/** An `IntersectionObserver` that sees nothing until a test says a slot came into view. */
export class FakeObserver {
  static all: FakeObserver[] = [];
  readonly observed = new Set<Element>();
  private readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    FakeObserver.all.push(this);
  }

  observe(target: Element) {
    this.observed.add(target);
  }

  unobserve(target: Element) {
    this.observed.delete(target);
  }

  disconnect() {
    this.observed.clear();
  }

  static reveal(target: Element, isIntersecting = true) {
    for (const observer of FakeObserver.all) {
      if (!observer.observed.has(target)) continue;
      const entry = { isIntersecting, target } as IntersectionObserverEntry;
      observer.callback([entry], observer as unknown as IntersectionObserver);
    }
  }

  static hide(target: Element) {
    FakeObserver.reveal(target, false);
  }
}

export const PLAN = "/api/assets/docs/plan.pdf";

/** Vim off on a vault holding `docs/plan.pdf`, drawn by `pdfs`. */
export function withPdfs(source: EmbedSource, pdfs: ReturnType<typeof fakePdfs>): Extension[] {
  return [pdfRenderer.of(pdfs.renderer), ...plain(source, ["b.md", "docs/plan.pdf"])];
}

/** The page slots of the first pdf box, once the pdf has landed. */
export async function slotsOf(view: EditorView): Promise<HTMLElement[]> {
  await waitFor(() => expect(view.dom.querySelector(".cm-pdf-page")).not.toBeNull());
  return [...view.dom.querySelectorAll<HTMLElement>(".cm-embed-pdf .cm-pdf-page")];
}
