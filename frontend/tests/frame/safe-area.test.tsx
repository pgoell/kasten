/**
 * Whether anything a finger needs sits under an iPhone's notch, rounded
 * corners or home indicator (#355).
 *
 * jsdom answers `env()` with nothing and lays nothing out, so this runs in
 * Chromium with the insets set through the DevTools protocol, which is what
 * `env(safe-area-inset-*)` then reads, and measures where things land. The
 * insets are an iPhone 15's: 47 and 34 in portrait, 47 a side and 21 below in
 * landscape.
 *
 * The frame and the bars are put together here the way the home route puts
 * them, the route itself wanting a backend to mount. The pictures taken
 * against the dev server are the check on the route.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// For its types alone: the provider is what gives `cdp()` a typed `send`.
import type {} from "@vitest/browser-playwright";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { cdp, page } from "vitest/browser";
import { CommandPalette } from "@/components/command-palette";
import { FileExplorer } from "@/components/file-explorer";
import { StatusBar } from "@/components/status-bar";
import { Toolbar } from "@/components/toolbar";
import type { EditorCommands, TreeCommands } from "@/lib/key-bindings";
import "@/styles/app.css";

interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const PORTRAIT = { width: 390, height: 844, insets: { top: 47, bottom: 34, left: 0, right: 0 } };
const LANDSCAPE = { width: 844, height: 390, insets: { top: 0, bottom: 21, left: 47, right: 47 } };
/** An iPhone SE on its side: under 768px, so the toolbar is drawn there. */
const SMALL_LANDSCAPE = {
  width: 667,
  height: 375,
  insets: { top: 0, bottom: 21, left: 47, right: 47 },
};
const NONE = { top: 0, bottom: 0, left: 0, right: 0 };

/** Every command a no-op: these tests press nothing. */
const INERT = new Proxy({}, { get: () => () => {} }) as EditorCommands & TreeCommands;

let root: Root | undefined;
let container: HTMLElement | undefined;

async function device(width: number, height: number, insets: Insets): Promise<void> {
  await page.viewport(width, height);
  await cdp().send("Emulation.setSafeAreaInsetsOverride", { insets });
}

async function mount(tree: ReactNode): Promise<void> {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<QueryClientProvider client={new QueryClient()}>{tree}</QueryClientProvider>);
  });
}

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  await cdp().send("Emulation.setSafeAreaInsetsOverride", { insets: NONE });
});

/** What of `elements` reaches outside the safe area, as lines a failure prints. */
function outside(elements: Iterable<Element>, insets: Insets): string[] {
  const right = window.innerWidth - insets.right;
  const bottom = window.innerHeight - insets.bottom;
  return [...elements].flatMap((element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return [];
    const inside =
      rect.left >= insets.left &&
      rect.right <= right &&
      rect.top >= insets.top &&
      rect.bottom <= bottom;
    const name = element.getAttribute("aria-label") ?? element.textContent?.slice(0, 20) ?? "";
    return inside
      ? []
      : [
          `${element.tagName.toLowerCase()} "${name}" at ${rect.left},${rect.top} to ${rect.right},${rect.bottom}, ` +
            `safe area ${insets.left},${insets.top} to ${right},${bottom}`,
        ];
  });
}

/** The home route's frame and the bars along its foot, as `index.tsx` draws them. */
function Frame({ phone, children }: { phone: boolean; children?: ReactNode }) {
  return (
    <main className="safe-frame flex h-dvh flex-col bg-one-bg">
      <div className="flex min-h-0 flex-1">{children}</div>
      <StatusBar version="0.0.0" foot={!phone} />
      {phone && <Toolbar commands={INERT} split={true} />}
    </main>
  );
}

/** What a reader sees in the bars: the buttons and the words, not the paint. */
function bars(): Element[] {
  return [
    ...document.querySelectorAll('[role="toolbar"] button'),
    ...document.querySelectorAll("footer *"),
  ];
}

describe("the safe area on a phone", () => {
  it("portrait: the toolbar pads by the bottom inset, no button under the home indicator", async () => {
    await device(PORTRAIT.width, PORTRAIT.height, PORTRAIT.insets);
    await mount(<Frame phone={true} />);

    expect(document.querySelectorAll('[role="toolbar"] button').length).toBe(8);
    expect(outside(bars(), PORTRAIT.insets)).toEqual([]);
    const toolbar = document.querySelector('[role="toolbar"]') as HTMLElement;
    expect(getComputedStyle(toolbar).paddingBottom).toBe("34px");
  });

  it("landscape: the frame pads by the side insets and the bar at the foot by the bottom one", async () => {
    // Above 768px the status bar is the foot of the page.
    await device(LANDSCAPE.width, LANDSCAPE.height, LANDSCAPE.insets);
    await mount(<Frame phone={false} />);
    expect(outside(bars(), LANDSCAPE.insets)).toEqual([]);
    const footer = document.querySelector("footer") as HTMLElement;
    expect(getComputedStyle(footer).paddingBottom).toBe("21px");
    await act(async () => root?.unmount());
    container?.remove();

    // Below it the toolbar is, and the status bar above it pads nothing.
    await device(SMALL_LANDSCAPE.width, SMALL_LANDSCAPE.height, SMALL_LANDSCAPE.insets);
    await mount(<Frame phone={true} />);
    expect(outside(bars(), SMALL_LANDSCAPE.insets)).toEqual([]);
    expect(getComputedStyle(document.querySelector("footer") as HTMLElement).paddingBottom).toBe(
      "0px",
    );
  });

  it("the frame of every route pads top, left and right", async () => {
    // `safe-frame` is what `/`, `/capture` and `/review` wear on their `main`.
    await device(LANDSCAPE.width, LANDSCAPE.height, { ...LANDSCAPE.insets, top: 30 });
    await mount(<main data-testid="frame" className="safe-frame h-dvh" />);
    const frame = getComputedStyle(page.getByTestId("frame").element());
    expect([frame.paddingTop, frame.paddingLeft, frame.paddingRight]).toEqual([
      "30px",
      "47px",
      "47px",
    ]);
  });

  it("with the keyboard up the bar at the foot adds no inset under the keyboard padding", async () => {
    // `use-keyboard-inset.ts` pads the frame by the keyboard and hands the same
    // number down as `--keyboard`; the home indicator is under the keys then.
    for (const phone of [true, false]) {
      await device(PORTRAIT.width, PORTRAIT.height, PORTRAIT.insets);
      await mount(<Frame phone={phone} />);
      const main = document.querySelector("main") as HTMLElement;
      const foot = document.querySelector(phone ? '[role="toolbar"]' : "footer") as HTMLElement;
      main.style.setProperty("--keyboard", "300px");
      expect(getComputedStyle(foot).paddingBottom).toBe("0px");
      main.style.setProperty("--keyboard", "0px");
      expect(getComputedStyle(foot).paddingBottom).toBe("34px");
      await act(async () => root?.unmount());
      container?.remove();
    }
  });

  it("at zero insets the layout does not move", async () => {
    await device(1280, 800, NONE);
    await mount(<Frame phone={false} />);
    const main = getComputedStyle(document.querySelector("main") as HTMLElement);
    expect([main.paddingTop, main.paddingLeft, main.paddingRight, main.paddingBottom]).toEqual([
      "0px",
      "0px",
      "0px",
      "0px",
    ]);
    const footer = (document.querySelector("footer") as HTMLElement).getBoundingClientRect();
    // h-6, the height the bar had before the inset was added to it.
    expect([footer.left, footer.right, footer.bottom, footer.height]).toEqual([0, 1280, 800, 24]);
  });

  // A guard, green before #364's fix as well: Chromium on a desktop draws no
  // system bars, so the edge-to-edge sums that made a Galaxy S22 Ultra scroll
  // cannot be had here. It holds the frame's own arithmetic to the viewport.
  // The S22 Ultra is 1440x3088 at a DPR of 3.75, so 384x823; an installed app
  // there keeps the 24px status bar and the 48px three-button bar, leaving
  // 751. Its insets are zero, which is what Android has without cover. The
  // size stands in for the installed app: headless Chromium (151) ignores a
  // `display-mode` passed to Emulation.setEmulatedMedia, and no style here
  // reads display-mode anyway.
  it.each([
    { device: "an S22 Ultra, installed", width: 384, height: 751, insets: NONE },
    { device: "an iPhone", ...PORTRAIT },
  ])("the document never scrolls on $device", async ({ width, height, insets }) => {
    await device(width, height, insets);
    // The home route's frame and then the review's, each in a root as tall as
    // the page, the way `#root` holds them.
    for (const frame of [
      <Frame key="home" phone={true} />,
      <main key="review" className="safe-frame safe-foot h-dvh w-full">
        <div className="h-full" />
      </main>,
    ]) {
      await mount(frame);
      container?.classList.add("h-full");
      const html = document.documentElement;
      expect(html.scrollHeight).toBeLessThanOrEqual(html.clientHeight);
      const main = (document.querySelector("main") as HTMLElement).getBoundingClientRect();
      expect(main.bottom).toBe(window.innerHeight);
      const toolbar = document.querySelector('[role="toolbar"]');
      if (toolbar) expect(toolbar.getBoundingClientRect().bottom).toBe(window.innerHeight);
      await act(async () => root?.unmount());
      container?.remove();
    }
  });

  it("the file tree drawer and the overlays stay inside the safe area", async () => {
    for (const { width, height, insets } of [PORTRAIT, LANDSCAPE]) {
      await device(width, height, insets);
      // Inside the frame, which is where a wide window's tree sits; the drawer
      // and the palette are `fixed` and owe the frame nothing.
      await mount(
        <Frame phone={width < 768}>
          <FileExplorer
            paths={["a.md", "b/c.md"]}
            onOpenFile={() => {}}
            onOpenImage={() => {}}
            onOpenHtml={() => {}}
            onOpenPdf={() => {}}
            open={true}
            onOpenChange={() => {}}
            commands={INERT}
          />
          <CommandPalette
            entries={[{ label: "Open today's note", run: () => {} }]}
            onClose={() => {}}
          />
        </Frame>,
      );
      // What the drawer holds, not the drawer: its paint runs to the edges.
      const drawer = [...document.querySelectorAll("aside *")];
      const palette = [...document.querySelectorAll('[role="dialog"] *')];
      expect(drawer.length).toBeGreaterThan(0);
      expect(palette.length).toBeGreaterThan(0);
      expect(outside([...drawer, ...palette], insets)).toEqual([]);
      await act(async () => root?.unmount());
      container?.remove();
    }
  });
});
