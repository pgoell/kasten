/**
 * Pictures of tables as the Read look draws them (#792), to look at by eye.
 * Skipped unless VITE_KASTEN_SHOTS=1; the pictures land in
 * node_modules/.cache/kasten-shots.
 *
 * Each picture is its own test, so `-t` can name one by its end (`name$`).
 */

import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/instrument-sans/index.css";
import "@fontsource-variable/jetbrains-mono/index.css";
import { EditorView } from "@codemirror/view";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot, type Root } from "react-dom/client";
import { cdp, page } from "vitest/browser";
import { Editor } from "@/components/editor";
import { applyTheme, PALETTE_KEY, THEME_KEY } from "@/lib/theme";
import { shot } from "./shots";
import { mountApp, settled, tableLinkCleanup } from "./table-link-fixture";

tableLinkCleanup();

const SHOTS = import.meta.env.VITE_KASTEN_SHOTS === "1";
const DESK = { width: 1440, height: 900, touch: false };
const PHONE = { width: 390, height: 844, touch: true };
type Size = typeof DESK;

/** (a) A table that fits its pane, with a prose line above and below it. */
const NARROW = [
  "Sales by region, the week before.",
  "",
  "| Region | Units | Share |",
  "| --- | --- | --- |",
  "| North | 1,204 | 31% |",
  "| South | 980 | 25% |",
  "| East |  | 19% |",
  "| West | 1,460 | 37% |",
  "",
  "The figures are rounded to the nearest unit.",
].join("\n");

/** (b) Fourteen columns and thirty rows, so it scrolls both ways. */
function wide(): string {
  const columns = 14;
  const cell = (text: string) => ` ${text} |`;
  const head = `|${Array.from({ length: columns }, (_, c) =>
    cell(c === 0 ? "Warehouse" : c === 1 ? "Units" : `Week ${c - 1}`),
  ).join("")}`;
  const divider = `|${" --- |".repeat(columns)}`;
  const rows = Array.from(
    { length: 30 },
    (_, r) =>
      `|${Array.from({ length: columns }, (_, c) =>
        cell(
          c === 0
            ? `WH-${String(r + 1).padStart(2, "0")}`
            : c === 1
              ? `${(r * 37) % 1000}`
              : `${((r + 1) * c * 13) % 500}`,
        ),
      ).join("")}`,
  );
  return ["Stock by warehouse, every week.", "", head, divider, ...rows, "", "Done."].join("\n");
}

/**
 * (c) Numbers with an empty cell, codes in the first column, a dash, and the
 * caption under the table.
 */
const MIXED = [
  "Stock by warehouse, this week.",
  "",
  "| Warehouse | Units | Price | Status |",
  "| --- | --- | --- | --- |",
  "| WH-07 | 1,204 | $2.50 | open |",
  "| us-east-1 |  | $3.10 | open |",
  "| DE_BER_3 | 980 | € 4,00 | closed |",
  "| a1b2c3 | 1,460 | 2.20 | - |",
  "Table: Units are per week, prices in the warehouse currency",
].join("\n");

/**
 * (d) The same table padded the way a table saved after an edit is, so its pipes
 * line up in Edit, with the caption under it.
 */
const PADDED = [
  "Stock by warehouse, this week.",
  "",
  "| Warehouse | Units | Price  | Status |",
  "| --------- | ----- | ------ | ------ |",
  "| WH-07     | 1,204 | $2.50  | open   |",
  "| us-east-1 |       | $3.10  | open   |",
  "| DE_BER_3  | 980   | € 4,00 | closed |",
  "| a1b2c3    | 1,460 | 2.20   | -      |",
  "Table: Units are per week, prices in the warehouse currency",
].join("\n");

let edit: { root: Root; host: HTMLElement } | undefined;

/**
 * The editor on `doc` with its preview off, which is Edit: the source as written,
 * with no live preview to draw the table or the caption. As the scroll-switch
 * test mounts it.
 */
function mountEdit(doc: string, height: number): HTMLElement {
  localStorage.setItem("kasten.vim", "off");
  const host = document.body.appendChild(document.createElement("div"));
  host.style.cssText = `width: 100%; height: ${height}px;`;
  const root = createRoot(host);
  root.render(
    <QueryClientProvider client={new QueryClient()}>
      <Editor initialDoc={doc} preview={false} />
    </QueryClientProvider>,
  );
  edit = { root, host };
  return host;
}

afterEach(() => {
  if (edit === undefined) return;
  edit.root.unmount();
  edit.host.remove();
  edit = undefined;
});

/** Shows the page at `size`, in `theme` and `palette`, the way the app reads them. */
async function look(size: Size, theme: "light" | "dark", palette: string): Promise<void> {
  await page.viewport(size.width, size.height);
  if (size.touch) {
    await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  }
  localStorage.setItem(THEME_KEY, theme);
  localStorage.setItem(PALETTE_KEY, palette);
  applyTheme();
}

/**
 * The editor on `doc` at `size`, as a note pane holds it, `prepare` run once it
 * is laid out, and the picture of it.
 */
async function picture(
  name: string,
  doc: string,
  size: Size,
  theme: "light" | "dark",
  palette: string,
  prepare?: (host: HTMLElement, at: EditorView) => void | Promise<void>,
  preview = true,
): Promise<void> {
  await look(size, theme, palette);
  const host = preview ? mountApp(doc, size.height, { vim: "off" }) : mountEdit(doc, size.height);
  host.classList.add("k-reader");
  await expect.poll(() => host.querySelector(".cm-content")).not.toBeNull();
  const at = EditorView.findFromDOM(host.querySelector(".cm-editor") as HTMLElement) as EditorView;
  await settled();
  await prepare?.(host, at);
  await settled();
  expect(await shot(host, name)).toBe(Math.round(host.getBoundingClientRect().width));
}

/**
 * The wide table scrolled to its middle sideways and down a little, so both
 * edges have a shadow and the head row has to stick.
 */
async function scrolledWide(host: HTMLElement): Promise<void> {
  await expect.poll(() => host.querySelector(".cm-table-scroll")).not.toBeNull();
  const scroller = host.querySelector(".cm-table-scroll") as HTMLElement;
  scroller.scrollLeft = (scroller.scrollWidth - scroller.clientWidth) / 2;
  scroller.scrollTop = 200;
}

const SIZES = [
  ["1440", DESK],
  ["390", PHONE],
] as const;

describe("table pictures, alone", () => {
  for (const theme of ["light", "dark"] as const) {
    for (const [label, size] of SIZES) {
      it.skipIf(!SHOTS)(`table-a-${label}-${theme}`, () =>
        picture(`table-a-${label}-${theme}`, NARROW, size, theme, "poel"),
      );

      it.skipIf(!SHOTS)(`table-b-${label}-${theme}`, () =>
        picture(`table-b-${label}-${theme}`, wide(), size, theme, "poel", scrolledWide),
      );

      it.skipIf(!SHOTS)(`table-c-${label}-${theme}`, () =>
        picture(`table-c-${label}-${theme}`, MIXED, size, theme, "poel"),
      );

      it.skipIf(!SHOTS)(`table-d-${label}-${theme}`, () =>
        picture(
          `table-d-${label}-${theme}`,
          PADDED,
          size,
          theme,
          "poel",
          (_host, at) => {
            // The cursor on the WH-07 row, the row mark Edit draws.
            at.dispatch({ selection: { anchor: PADDED.indexOf("| WH-07") + 2 } });
          },
          false,
        ),
      );
    }
  }

  // The three other palettes, at 1440 in light, for the scrolled table.
  for (const palette of ["russet", "peach", "pansy"]) {
    it.skipIf(!SHOTS)(`table-b-1440-light-${palette}`, () =>
      picture(`table-b-1440-light-${palette}`, wide(), DESK, "light", palette, scrolledWide),
    );
  }
});
