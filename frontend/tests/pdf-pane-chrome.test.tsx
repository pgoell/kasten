import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PdfPane } from "@/components/pdf-pane";
import type { PdfFile, ShowOptions } from "@/lib/pdf-view";
import { pickPalette, toggleTheme } from "@/lib/theme";
import { stubCommands } from "./keybindings-fixture";

// What the pane asks of the pdf viewer and of the take: the view it is handed
// and the options it passes in, so a test can call what the viewer would.
const pdf = vi.hoisted(() => ({
  view: Object.assign(vi.fn(), { redraw: vi.fn(), setZoom: vi.fn(), goTo: vi.fn() }),
  options: undefined as ShowOptions | undefined,
}));
vi.mock("@/lib/pdf-view", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pdf-view")>()),
  showPdf: (
    _box: HTMLElement,
    _renderer: unknown,
    _url: string,
    _name: string,
    _measured: () => void,
    _page?: number,
    options?: ShowOptions,
  ) => {
    pdf.options = options;
    return pdf.view;
  },
}));

// The wrapper the take is placed in is kept too, so a test can see what the toast is bounded by.
const take = vi.hoisted(() => ({
  onKeyDown: vi.fn((_event: unknown) => false),
  wrapper: undefined as undefined | { current: HTMLElement | null },
}));
vi.mock("@/components/pdf-take", () => ({
  usePdfTake: (o: { wrapper: { current: HTMLElement | null } }) => {
    take.wrapper = o.wrapper;
    return {
      overlay: null,
      onKeyDown: take.onKeyDown,
      onText: () => {},
      forget: () => {},
    };
  },
}));

const FILE: PdfFile = {
  pages: 3,
  page: async () => ({ width: 600, height: 800, draw: async () => {} }),
};

/** A ResizeObserver that reports the pane's width when a test says so. */
let report: ResizeObserverCallback | undefined;
class Reporter {
  constructor(callback: ResizeObserverCallback) {
    report = callback;
  }
  observe() {}
  disconnect() {}
}

/** An IntersectionObserver that sees nothing, the thumbnails being drawn by a test's say-so only. */
class Quiet {
  observe() {}
  disconnect() {}
}

function renderPane() {
  const onNoteBeside = vi.fn();
  const utils = render(
    <PdfPane
      path="docs/plan.pdf"
      opened={1}
      commands={stubCommands()}
      onNoteBeside={onNoteBeside}
    />,
  );
  return { ...utils, onNoteBeside };
}

/** The zoom readout, as the reader reads it. */
const zoomed = () => screen.getByText(/%$/).textContent;

/** Report the pane's width the way the browser does when the pane changes size. */
function widen(width: number) {
  act(() => {
    report?.([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver);
  });
}

describe("the pdf pane's header and zoom", () => {
  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", Quiet);
    vi.stubGlobal("ResizeObserver", Reporter);
    take.onKeyDown.mockReturnValue(false);
    pdf.options = undefined;
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("the header reads PDF, the path, the zoom and Note beside, in that order", () => {
    const { container } = renderPane();

    const header = container.querySelector("header") as HTMLElement;
    expect(header.textContent).toBe("PDFdocs/plan.pdf−100%+Note beside");
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeInTheDocument();
  });

  it("Zoom in moves to 125% and hands the viewer 1.25", () => {
    renderPane();

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));

    expect(zoomed()).toBe("125%");
    expect(pdf.view.setZoom).toHaveBeenCalledWith(1.25);
  });

  it("the zoom buttons are disabled at 300% and at 50%", () => {
    renderPane();
    const zoomIn = () => screen.getByRole("button", { name: "Zoom in" });
    const zoomOut = () => screen.getByRole("button", { name: "Zoom out" });

    for (let step = 0; step < 4; step += 1) fireEvent.click(zoomIn());
    expect(zoomed()).toBe("300%");
    expect(zoomIn()).toBeDisabled();

    for (let step = 0; step < 6; step += 1) fireEvent.click(zoomOut());
    expect(zoomed()).toBe("50%");
    expect(zoomOut()).toBeDisabled();
  });

  it("the + and - keys zoom, and a ctrl chord leaves the zoom alone", () => {
    const { container } = renderPane();
    const section = container.querySelector("[data-pdf-pane]") as HTMLElement;

    fireEvent.keyDown(section, { key: "+" });
    expect(zoomed()).toBe("125%");
    fireEvent.keyDown(section, { key: "=" });
    expect(zoomed()).toBe("150%");
    fireEvent.keyDown(section, { key: "-" });
    expect(zoomed()).toBe("125%");
    fireEvent.keyDown(section, { key: "+", ctrlKey: true });
    expect(zoomed()).toBe("125%");
  });

  it("the take hears a key before the pane's own keys do", () => {
    const { container } = renderPane();
    const section = container.querySelector("[data-pdf-pane]") as HTMLElement;
    take.onKeyDown.mockReturnValueOnce(true);

    fireEvent.keyDown(section, { key: "+" });

    expect(take.onKeyDown).toHaveBeenCalledWith(expect.objectContaining({ key: "+" }));
    expect(zoomed()).toBe("100%");
  });

  it("Note beside calls the route's opener of the note", () => {
    const { onNoteBeside } = renderPane();

    fireEvent.click(screen.getByRole("button", { name: "Note beside" }));

    expect(onNoteBeside).toHaveBeenCalledTimes(1);
  });

  it("a theme switch redraws the pdf on screen", () => {
    renderPane();

    toggleTheme();

    expect(pdf.view.redraw).toHaveBeenCalledTimes(1);
    toggleTheme();
  });

  it("a palette switch redraws the pdf on screen", () => {
    renderPane();

    pickPalette("russet");

    expect(pdf.view.redraw).toHaveBeenCalledTimes(1);
    pickPalette("poel");
  });
});

describe("the pdf pane's thumbnail column", () => {
  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", Quiet);
    vi.stubGlobal("ResizeObserver", Reporter);
    pdf.options = undefined;
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("is drawn from 900 px of pane width and not at 899", () => {
    renderPane();
    act(() => pdf.options?.onFile?.(FILE));

    widen(899);
    expect(screen.queryByLabelText("Pages")).toBeNull();

    widen(900);
    expect(screen.getByLabelText("Pages")).toBeInTheDocument();
  });

  it("a click on a thumbnail goes to its page, and the page the viewer reports is marked", () => {
    renderPane();
    act(() => pdf.options?.onFile?.(FILE));
    widen(900);

    fireEvent.click(screen.getByRole("button", { name: "Page 2" }));
    expect(pdf.view.goTo).toHaveBeenCalledWith(2);

    act(() => pdf.options?.onPage?.(2));
    expect(screen.getByRole("button", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Page 1" })).not.toHaveAttribute("aria-current");
  });

  it("a theme switch redraws the thumbnails on screen", async () => {
    // A page the column shows is drawn once, and drawn again by a switch.
    const drawn: number[] = [];
    const file: PdfFile = {
      pages: 2,
      page: async (number) => ({
        width: 600,
        height: 800,
        draw: async () => {
          drawn.push(number);
        },
      }),
    };
    let seen: IntersectionObserverCallback | undefined;
    class Capturing {
      constructor(callback: IntersectionObserverCallback) {
        seen = callback;
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal("IntersectionObserver", Capturing);
    renderPane();
    act(() => pdf.options?.onFile?.(file));
    widen(900);
    const first = screen.getByRole("button", { name: "Page 1" });
    act(() => {
      seen?.([{ isIntersecting: true, target: first } as unknown as IntersectionObserverEntry], {
        disconnect() {},
      } as unknown as IntersectionObserver);
    });
    await act(async () => {
      for (let round = 0; round < 10; round += 1) await Promise.resolve();
    });
    expect(drawn).toEqual([1]);

    act(() => toggleTheme());
    await act(async () => {
      for (let round = 0; round < 10; round += 1) await Promise.resolve();
    });

    expect(drawn).toEqual([1, 1]);
    toggleTheme();
  });

  it("the take's wrapper is the page area, so its toast is not placed over the thumbnails", () => {
    renderPane();
    act(() => pdf.options?.onFile?.(FILE));
    widen(900);

    const wrapper = take.wrapper?.current;
    expect(screen.getByLabelText("Pages")).toBeInTheDocument();
    expect(wrapper).not.toBeNull();
    expect(wrapper?.querySelector("nav")).toBeNull();
    expect(wrapper?.querySelector("[data-pdf-box]")).not.toBeNull();
  });
});
