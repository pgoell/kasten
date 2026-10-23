/**
 * Pictures of the which-key panel (#784), to look at by eye: at 1440 by 900 right
 * after Space and after g, in light and dark; at 390 by 844 with touch as the sheet,
 * settled; and in the three accent palettes the app has besides the default. Each
 * picture is of the whole page, so the note behind the panel shows.
 *
 * Skipped unless VITE_KASTEN_SHOTS=1; pictures land in node_modules/.cache/kasten-shots.
 */

// The three faces `main.tsx` loads, so the pictures show the app's type.
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/instrument-sans/index.css";
import "@fontsource-variable/jetbrains-mono/index.css";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { commands, page } from "vitest/browser";
import { KeyHelp } from "@/components/key-help";
import { WhichKey } from "@/components/which-key";
import { applyTheme, PALETTE_KEY, THEME_KEY, type Theme } from "@/lib/theme";
import { beginLeader, paneOpener } from "@/lib/which-key";
import "@/styles/app.css";
import { stubCommands } from "../stub-commands";
import { shot } from "./shots";

const SHOTS = import.meta.env.VITE_KASTEN_SHOTS === "1";
const DESKTOP = { width: 1440, height: 900, touch: false };
const TOUCH = { width: 390, height: 844, touch: true };
type Size = typeof DESKTOP;

/** A note's text, so the panel has something real to cover. */
const NOTE = [
  "Palettes",
  "The accent is the one colour a note paints in besides its text: links, the cursor's line, the tag under the pointer.",
  "A [[Design Notes]] link, a #reading tag and ==a highlight== in a sentence, the way a reader meets them.",
  "Each palette changes only that accent, so the same note reads the same in every one of them.",
  "Replication lag shows up first on the dashboard, before any reader notices a stale page.",
  "The first thing to check after a failover is which replica holds the last acknowledged write.",
];

function Page({ phone, help = false }: { phone: boolean; help?: boolean }) {
  return (
    <main className="flex h-dvh bg-k-bg text-k-ink">
      <div data-pane tabIndex={-1} className="min-w-0 flex-1 overflow-hidden px-8 pt-10">
        <h1 className="mb-4 text-[26px] font-semibold">{NOTE[0]}</h1>
        {NOTE.slice(1).map((line) => (
          <p key={line} className="mb-3 max-w-[60ch] text-[15px] leading-7">
            {line}
          </p>
        ))}
      </div>
      {help ? <KeyHelp onClose={() => {}} /> : <WhichKey phone={phone} />}
    </main>
  );
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** The sheet's offset in px, read from its inline transform. */
function offsetOf(panel: HTMLElement | null): number {
  const match = /,\s*(-?[\d.e+-]+)px/.exec(panel?.style.transform ?? "");
  return match ? Number(match[1]) : Number.NaN;
}

function panelOf(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[role='dialog'][aria-label='Leader keys']");
}

/** Sets the page up at one size and theme, presses Space, then the keys given, and shoots it. */
async function shootPanel(
  name: string,
  size: Size,
  theme: Theme,
  options: { palette?: string; keys?: string[] } = {},
) {
  await page.viewport(size.width, size.height);
  await commands.emulateMedia({
    touch: size.touch,
    reducedMotion: "no-preference",
    contrast: "no-preference",
    reducedTransparency: "no-preference",
  });
  localStorage.clear();
  localStorage.setItem(THEME_KEY, theme);
  localStorage.setItem(PALETTE_KEY, options.palette ?? "poel");
  applyTheme();

  const host = document.body.appendChild(document.createElement("div"));
  const root: Root = createRoot(host);
  try {
    flushSync(() => root.render(<Page phone={size.touch} />));
    await nextFrame();
    const pane = host.querySelector<HTMLElement>("[data-pane]") as HTMLElement;
    pane.focus();
    flushSync(() => beginLeader(paneOpener(stubCommands())));

    const panel = panelOf() as HTMLElement;
    for (const key of options.keys ?? []) {
      panel.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    }

    // A sheet is shot once it has come to rest, so the picture is the open state.
    for (let at = 0; at < 60 && offsetOf(panelOf()) !== 0; at += 1) {
      await nextFrame();
    }
    await nextFrame();

    const width = await shot(document.body, name);
    expect(width).toBe(size.width);
  } finally {
    flushSync(() => root.unmount());
    host.remove();
    await commands.emulateMedia({});
  }
}

/**
 * Key help open with the filter typed in, shot as the whole page.
 *
 * The filter takes its text through the element's own value setter and an input
 * event, which is the one way React sees a typed change in a field it controls.
 */
async function shootKeyHelp(name: string, size: Size, theme: Theme, query: string) {
  await page.viewport(size.width, size.height);
  await commands.emulateMedia({
    touch: size.touch,
    reducedMotion: "no-preference",
    contrast: "no-preference",
    reducedTransparency: "no-preference",
  });
  localStorage.clear();
  localStorage.setItem(THEME_KEY, theme);
  localStorage.setItem(PALETTE_KEY, "poel");
  applyTheme();

  const host = document.body.appendChild(document.createElement("div"));
  const root: Root = createRoot(host);
  try {
    flushSync(() => root.render(<Page phone={size.touch} help />));
    await nextFrame();
    const field = host.querySelector<HTMLInputElement>("input[aria-label='Filter keys']");
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    flushSync(() => {
      setValue?.call(field, query);
      field?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await nextFrame();

    const width = await shot(document.body, name);
    expect(width).toBe(size.width);
  } finally {
    flushSync(() => root.unmount());
    host.remove();
    await commands.emulateMedia({});
  }
}

function shotTest(name: string, run: () => Promise<void>) {
  it.skipIf(!SHOTS)(name, run, 300_000);
}

shotTest("key-help-filter-desktop-1440-light", () =>
  shootKeyHelp("key-help-filter-desktop-1440-light", DESKTOP, "light", "graph"),
);
shotTest("key-help-filter-desktop-1440-dark", () =>
  shootKeyHelp("key-help-filter-desktop-1440-dark", DESKTOP, "dark", "graph"),
);
shotTest("key-help-touch-390-light", () =>
  shootKeyHelp("key-help-touch-390-light", TOUCH, "light", "tab"),
);
shotTest("key-help-touch-390-dark", () =>
  shootKeyHelp("key-help-touch-390-dark", TOUCH, "dark", "tab"),
);

shotTest("which-key-desktop-1440-light", () =>
  shootPanel("which-key-desktop-1440-light", DESKTOP, "light"),
);
shotTest("which-key-desktop-1440-dark", () =>
  shootPanel("which-key-desktop-1440-dark", DESKTOP, "dark"),
);
shotTest("which-key-g-desktop-1440-light", () =>
  shootPanel("which-key-g-desktop-1440-light", DESKTOP, "light", { keys: ["g"] }),
);
shotTest("which-key-g-desktop-1440-dark", () =>
  shootPanel("which-key-g-desktop-1440-dark", DESKTOP, "dark", { keys: ["g"] }),
);
shotTest("which-key-touch-390-light", () =>
  shootPanel("which-key-touch-390-light", TOUCH, "light"),
);
shotTest("which-key-touch-390-dark", () => shootPanel("which-key-touch-390-dark", TOUCH, "dark"));
for (const palette of ["russet", "peach", "pansy"]) {
  for (const theme of ["light", "dark"] as const) {
    const name = `which-key-palette-${palette}-1440-${theme}`;
    shotTest(name, () => shootPanel(name, DESKTOP, theme, { palette }));
  }
}
