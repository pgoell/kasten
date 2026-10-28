/**
 * Pictures of the pdf pane (#788), to look at by eye: a page with text and a
 * picture, the header row, the thumbnail column, and a take's toast and mark, in
 * light and dark, at 1440 by 900 and at 414 by 896 with touch, and the page at
 * 414 at fit width and pinched to 200 % (#991), and at 1440 zoomed to 144 % by
 * two notches of ctrl+wheel (#1285).
 *
 * Skipped unless VITE_KASTEN_SHOTS=1; pictures land in node_modules/.cache/kasten-shots.
 */

import "./pdf-take-api";
// The three faces `main.tsx` loads, so the pictures show the app's type.
import "@fontsource-variable/instrument-sans/index.css";
import "@fontsource-variable/jetbrains-mono/index.css";
import "@fontsource-variable/newsreader/opsz.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { flushSync } from "react-dom";
import { page as browserPage, commands, userEvent } from "vitest/browser";
import { PdfPane } from "@/components/pdf-pane";
import { applyTheme, PALETTE_KEY, THEME_KEY, type Theme } from "@/lib/theme";
import "@/styles/app.css";
import { type Mounted, setUp, takeButton, tearDown } from "./html-take-fixture";
import { PAGE_ONE } from "./pdf-fixture";
import { shot } from "./shots";

const SHOTS = import.meta.env.VITE_KASTEN_SHOTS === "1";
const DESKTOP = { width: 1440, height: 900, touch: false };
const TOUCH = { width: 414, height: 896, touch: true };
type Size = typeof DESKTOP;

const PATH = "take/plan.pdf";
/** The passage on page one, which is the whole of its text layer span. */
const WORDS = PAGE_ONE[0] ?? "";

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** One pdf pane, the height of the viewport. */
function mount(mounted: Mounted) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  flushSync(() =>
    mounted.root.render(
      <QueryClientProvider client={client}>
        <div className="flex h-dvh flex-row">
          <div data-pane className="flex min-w-0 flex-1 flex-col">
            <PdfPane
              path={PATH}
              opened={1}
              commands={mounted.spy}
              focusSignal={1}
              onNoteBeside={() => {}}
            />
          </div>
        </div>
      </QueryClientProvider>,
    ),
  );
}

/** Waits for the passage's span in page one's text layer, which is drawn with the page. */
async function drawn(mounted: Mounted): Promise<Element> {
  return vi.waitFor(
    () => {
      const span = [...mounted.host.querySelectorAll('[data-pdf-page="1"] .textLayer span')].find(
        (one) => (one.textContent ?? "").includes(WORDS),
      );
      expect(span).toBeDefined();
      return span as Element;
    },
    { timeout: 20_000 },
  );
}

/** Selects the whole of `span`, the way a reader's drag over the words does. */
function selectSpan(span: Element) {
  const selection = window.getSelection() as Selection;
  const range = document.createRange();
  range.selectNodeContents(span);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Two fingers on `box` 100 px apart about a point on page one's text, spread to 200. */
function spread(box: HTMLElement) {
  const rect = box.getBoundingClientRect();
  const x = rect.left + 120;
  const y = rect.top + 120;
  const fingers = (gap: number) =>
    [x - gap / 2, x + gap / 2].map(
      (clientX, identifier) => new Touch({ identifier, target: box, clientX, clientY: y }),
    );
  const send = (type: string, touches: Touch[], changed = touches) =>
    box.dispatchEvent(
      new TouchEvent(type, { touches, changedTouches: changed, bubbles: true, cancelable: true }),
    );
  send("touchstart", fingers(100));
  for (const gap of [100, 125, 150, 175, 200]) send("touchmove", fingers(gap));
  send("touchend", [], fingers(200));
}

/** One picture of the pane at `size` and `theme`, of the part of it the name asks for. */
async function shootPane(
  name: string,
  size: Size,
  theme: Theme,
  part: "page" | "header" | "thumbs" | "take" | "zoomed" | "wheeled",
) {
  const mounted = await setUp();
  try {
    await browserPage.viewport(size.width, size.height);
    await commands.emulateMedia({
      touch: size.touch,
      reducedMotion: "no-preference",
      contrast: "no-preference",
      reducedTransparency: "no-preference",
    });
    localStorage.setItem(THEME_KEY, theme);
    localStorage.setItem(PALETTE_KEY, "poel");
    applyTheme();
    mount(mounted);
    selectSpan(await drawn(mounted));

    if (part === "thumbs") {
      await vi.waitFor(
        () => expect(mounted.host.querySelector('[aria-label="Pages"] canvas')).not.toBeNull(),
        { timeout: 20_000 },
      );
    }
    // Two fingers spread to twice their gap over the page, the way #991's reader
    // zooms in on a phone, and the page drawn again at the zoom they landed on.
    if (part === "zoomed") {
      window.getSelection()?.removeAllRanges();
      spread(mounted.host.querySelector("[data-pdf-box]") as HTMLElement);
      await vi.waitFor(() => {
        const slot = mounted.host.querySelector('[data-pdf-page="1"]') as HTMLElement;
        const canvas = slot.querySelector("canvas") as HTMLCanvasElement;
        expect(canvas.width).toBe(Math.floor(slot.clientWidth * window.devicePixelRatio));
        expect(slot.style.width).toBe("200%");
      });
    }
    // Two notches of ctrl+wheel over page one's text, as a desktop reader zooms in.
    if (part === "wheeled") {
      window.getSelection()?.removeAllRanges();
      const box = mounted.host.querySelector("[data-pdf-box]") as HTMLElement;
      const rect = box.getBoundingClientRect();
      for (const _ of [1, 2])
        box.dispatchEvent(
          new WheelEvent("wheel", {
            deltaY: -100,
            ctrlKey: true,
            clientX: rect.left + 120,
            clientY: rect.top + 120,
            bubbles: true,
            cancelable: true,
          }),
        );
      await vi.waitFor(() => {
        const slot = mounted.host.querySelector('[data-pdf-page="1"]') as HTMLElement;
        const canvas = slot.querySelector("canvas") as HTMLCanvasElement;
        expect(slot.style.width).toBe("144%");
        expect(canvas.width).toBe(Math.floor(slot.clientWidth * window.devicePixelRatio));
      });
    }
    if (part === "take") {
      await vi.waitFor(() => expect(takeButton(mounted)).not.toBeNull());
      await userEvent.keyboard("y");
      await vi.waitFor(() => expect(mounted.host.querySelector("[role='status']")).not.toBeNull());
    }

    await document.fonts.ready;
    await nextFrame();
    const element =
      part === "page" || part === "zoomed" || part === "wheeled"
        ? mounted.host.querySelector("[data-pdf-box]")
        : part === "header"
          ? mounted.host.querySelector("[data-pdf-pane] header")
          : mounted.host.querySelector("[data-pdf-pane]");
    // A part of the pane is narrower than the viewport, so the picture is checked
    // against the element's own width.
    const width = await shot(element as Element, name);
    expect(width).toBe(Math.round((element as Element).getBoundingClientRect().width));
  } finally {
    await tearDown(mounted);
  }
}

function shotTest(name: string, run: () => Promise<void>) {
  it.skipIf(!SHOTS)(name, run, 300_000);
}

for (const theme of ["light", "dark"] as const) {
  const suffix = `${DESKTOP.width}-${theme}`;
  shotTest(`pdf-text-image-${suffix}`, () =>
    shootPane(`pdf-text-image-${suffix}`, DESKTOP, theme, "page"),
  );
  shotTest(`pdf-header-${suffix}`, () =>
    shootPane(`pdf-header-${suffix}`, DESKTOP, theme, "header"),
  );
  shotTest(`pdf-thumbs-${suffix}`, () =>
    shootPane(`pdf-thumbs-${suffix}`, DESKTOP, theme, "thumbs"),
  );
  shotTest(`pdf-take-${suffix}`, () => shootPane(`pdf-take-${suffix}`, DESKTOP, theme, "take"));
  shotTest(`pdf-wheeled-${suffix}`, () =>
    shootPane(`pdf-wheeled-${suffix}`, DESKTOP, theme, "wheeled"),
  );
  shotTest(`pdf-fit-${TOUCH.width}-${theme}`, () =>
    shootPane(`pdf-fit-${TOUCH.width}-${theme}`, TOUCH, theme, "page"),
  );
  shotTest(`pdf-zoomed-${TOUCH.width}-${theme}`, () =>
    shootPane(`pdf-zoomed-${TOUCH.width}-${theme}`, TOUCH, theme, "zoomed"),
  );
  shotTest(`pdf-take-${TOUCH.width}-${theme}`, () =>
    shootPane(`pdf-take-${TOUCH.width}-${theme}`, TOUCH, theme, "take"),
  );
}
