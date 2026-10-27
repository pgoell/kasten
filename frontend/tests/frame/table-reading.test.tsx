/**
 * A table as the Read look draws it (#792): the type and the rules, the sideways
 * and downward scroll inside the table's own box with the first column and the
 * head row held, the edge shadows, the numbers to the right, the phone that does
 * not wrap, and the scroll place kept across a redraw.
 *
 * A real browser, because every one of these is a layout or a computed style. The
 * editor is the app's own, mounted the way table-link-url.test.tsx mounts it.
 */

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { cdp, page } from "vitest/browser";
import { kastenTheme } from "@/lib/editor-theme";
import { imagePaths } from "@/lib/image";
import { livePreview } from "@/lib/live-preview";
import { noteLanguage } from "@/lib/note-language";
import { notePath } from "@/lib/todo/todo-commands";
import { vimKeys } from "@/lib/vim-mode";
import { vaultPaths } from "@/lib/wikilink";
import { mountApp, SITE, settled, stubOpen, tableLinkCleanup, tap } from "./table-link-fixture";

tableLinkCleanup();

/** A note with a line above a table of `rows` body rows and `columns` columns. */
function wideNote(rows: number, columns = 30): string {
  const cell = (text: string) => ` ${text} |`;
  const header = `|${Array.from({ length: columns }, (_, c) => cell(`column ${c}`)).join("")}`;
  const divider = `|${" --- |".repeat(columns)}`;
  const body = Array.from(
    { length: rows },
    (_, r) =>
      `|${Array.from({ length: columns }, (_, c) =>
        cell(c === 0 ? `item ${r}` : c === 1 ? `${r * 10}` : `cell ${r} ${c}`),
      ).join("")}`,
  );
  return ["before", "", header, divider, ...body].join("\n");
}

/**
 * The box a table scrolls in. Before the inner box existed the block scrolled
 * itself, so a missing inner box falls back to the block, and a test then fails
 * on the behaviour it checks rather than on the lookup.
 */
function scrollerOf(block: Element): HTMLElement {
  return (block.querySelector(".cm-table-scroll") ?? block) as HTMLElement;
}

/** The editor on `doc`, with the table's own box and its scroll, once drawn. */
async function drawn(doc: string, height = 600) {
  // Set here, not left to the test before: a width read from another test's leftover
  // viewport made a table fit or not by order.
  await page.viewport(1440, 900);
  const host = mountApp(doc, height, { vim: "off" });
  await expect.poll(() => host.querySelector(".cm-table-block")).not.toBeNull();
  const at = EditorView.findFromDOM(host.querySelector(".cm-editor") as HTMLElement) as EditorView;
  const block = host.querySelector(".cm-table-block") as HTMLElement;
  const scroller = scrollerOf(block);
  return { host, at, block, scroller, table: scroller.querySelector("table") as HTMLTableElement };
}

/** What a CSS value resolves to in this page, read off a probe the way a style would take it. */
function resolved(property: "color" | "font-family", value: string): string {
  const probe = document.body.appendChild(document.createElement("div"));
  probe.style.setProperty(property, value);
  const computed = getComputedStyle(probe).getPropertyValue(property);
  probe.remove();
  return computed;
}

/** The opacity of one of the block's edge shadows, as the page draws it now. */
function shadow(block: HTMLElement, edge: "before" | "after"): string {
  return getComputedStyle(block, `::${edge}`).opacity;
}

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
});

describe("table reading", () => {
  it("#792 A1 cells are sans at 13 px, a strong rule above the head, hairlines and no zebra", async () => {
    const { table } = await drawn(wideNote(3));

    const head = table.querySelector("th") as HTMLElement;
    const body = table.querySelectorAll("tbody tr");
    const [first, second] = [...body].map((row) => row.querySelectorAll("td")[2] as HTMLElement);
    const cell = first as HTMLElement;

    expect(getComputedStyle(cell).fontFamily).toBe(resolved("font-family", "var(--k-sans)"));
    expect(getComputedStyle(cell).fontSize).toBe("13px");
    expect(getComputedStyle(head).borderTopColor).toBe(resolved("color", "var(--k-rule-strong)"));
    expect(getComputedStyle(cell).borderBottomColor).toBe(resolved("color", "var(--k-rule)"));
    expect(getComputedStyle(cell).borderLeftWidth).toBe("0px");
    expect(getComputedStyle(cell).borderRightWidth).toBe("0px");
    // No zebra: two body rows of the same cell show the same ground.
    expect(getComputedStyle(second as HTMLElement).backgroundColor).toBe(
      getComputedStyle(first as HTMLElement).backgroundColor,
    );
  });

  it("#792 A2 a wide table scrolls sideways in its box and its first column stays in place", async () => {
    const { scroller } = await drawn(wideNote(3));
    expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth);

    const first = scroller.querySelector("tbody tr td") as HTMLElement;
    const second = scroller.querySelectorAll("tbody tr td")[1] as HTMLElement;
    const at = {
      first: first.getBoundingClientRect().left,
      second: second.getBoundingClientRect().left,
    };

    scroller.scrollLeft = 200;
    await expect.poll(() => scroller.scrollLeft).toBe(200);
    expect(first.getBoundingClientRect().left).toBeCloseTo(at.first, 0);
    expect(second.getBoundingClientRect().left).toBeLessThan(at.second - 150);
  });

  it("#792 A2 a tall table scrolls down in its box and its head row stays at the top", async () => {
    const { scroller } = await drawn(wideNote(40, 3));
    expect(scroller.getBoundingClientRect().height).toBeLessThanOrEqual(innerHeight * 0.7 + 1);
    expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);

    scroller.scrollTop = 300;
    await expect.poll(() => scroller.scrollTop).toBe(300);
    const head = scroller.querySelector("th") as HTMLElement;
    expect(head.getBoundingClientRect().top).toBeCloseTo(scroller.getBoundingClientRect().top, 0);
  });

  it("#792 A3 the edge shadows show on the side there is more to see, at the start, the middle and the end", async () => {
    const { block, scroller } = await drawn(wideNote(3));

    await expect.poll(() => shadow(block, "after")).toBe("1");
    expect(block.hasAttribute("data-shadow-left")).toBe(false);
    expect(block.hasAttribute("data-shadow-right")).toBe(true);
    expect(shadow(block, "before")).toBe("0");

    scroller.scrollLeft = scroller.scrollWidth;
    await expect.poll(() => shadow(block, "before")).toBe("1");
    expect(block.hasAttribute("data-shadow-right")).toBe(false);
    expect(shadow(block, "after")).toBe("0");

    scroller.scrollLeft = (scroller.scrollWidth - scroller.clientWidth) / 2;
    await expect.poll(() => shadow(block, "after")).toBe("1");
    expect(shadow(block, "before")).toBe("1");
  });

  it("#792 A3 the edge shadows are black in light and in dark, the token's colour", async () => {
    const { block } = await drawn(wideNote(3));
    expect(getComputedStyle(block, "::after").backgroundImage).toContain("rgba(0, 0, 0, 0.14)");

    // A light shadow would be a bar in dark, so the dark theme keeps it black, and
    // stronger, since the near-black ground hides a faint one.
    document.documentElement.setAttribute("data-theme", "dark");
    await expect
      .poll(() => getComputedStyle(block, "::after").backgroundImage)
      .toContain("rgba(0, 0, 0, 0.55)");
  });

  it("#792 A4 a numeric column is right-aligned with tabular figures", async () => {
    const { table } = await drawn(wideNote(3));

    const numbers = [...table.querySelectorAll("tbody tr")].map(
      (row) => row.querySelectorAll("td")[1] as HTMLElement,
    );
    for (const cell of numbers) {
      expect(getComputedStyle(cell).textAlign).toBe("right");
      expect(getComputedStyle(cell).fontVariantNumeric).toContain("tabular-nums");
    }
    const words = table.querySelectorAll("tbody tr")[0]?.querySelectorAll("td")[2] as HTMLElement;
    expect(getComputedStyle(words).textAlign).toBe("left");
  });

  it("#792 A11 at 390 wide with a finger the cells hold their lines, the table scrolls and a link still opens", async () => {
    await page.viewport(390, 844);
    await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    const doc = wideNote(3).replace("cell 0 2", `[cell 0 2](${SITE})`);
    const host = mountApp(doc, 700, { vim: "off" });
    host.classList.add("k-reader");
    await expect.poll(() => host.querySelector(".cm-table-block")).not.toBeNull();
    await expect.poll(() => host.querySelector(".cm-table-block .cm-link")).not.toBeNull();

    const block = host.querySelector(".cm-table-block") as HTMLElement;
    const scroller = scrollerOf(block);
    const cell = scroller.querySelector("tbody td") as HTMLElement;
    expect(getComputedStyle(cell).whiteSpace).toBe("nowrap");
    expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth);

    const link = host.querySelector(".cm-table-block .cm-link") as HTMLElement;
    const open = stubOpen();
    await tap(link);
    expect(open).toHaveBeenCalledWith(SITE, "_blank", "noopener");
  });

  it("#792 I5 a table that fits shows no shadow, and the shadow appears when the pane narrows", async () => {
    // In the reader's pane, where a narrow pane holds its cells to one line, so
    // eight columns fit the full pane and overflow a narrow one.
    await page.viewport(1440, 900);
    const { host, block } = await drawn(wideNote(3, 8));
    host.classList.add("k-reader");
    expect(block.hasAttribute("data-shadow-right")).toBe(false);

    host.style.width = "300px";
    const fresh = () => host.querySelector(".cm-table-block") as HTMLElement;
    await expect.poll(() => fresh().hasAttribute("data-shadow-right")).toBe(true);
    await expect.poll(() => shadow(fresh(), "after")).toBe("1");
  });

  it("#792 A10 the table's sideways scroll is kept when the cursor goes in and out of it", async () => {
    const doc = wideNote(3);
    const { at, scroller } = await drawn(doc);
    scroller.scrollLeft = 150;
    await expect.poll(() => scroller.scrollLeft).toBe(150);

    // In, which takes the widget off the page for its source, and out again,
    // which draws a new one.
    at.dispatch({ selection: { anchor: doc.indexOf("| column 0") } });
    await expect.poll(() => at.dom.querySelector(".cm-table-block")).toBeNull();
    at.dispatch({ selection: { anchor: 0 } });
    await expect.poll(() => at.dom.querySelector(".cm-table-block")).not.toBeNull();

    const again = scrollerOf(at.dom.querySelector(".cm-table-block") as HTMLElement);
    await expect.poll(() => again.scrollLeft).toBe(150);
  });

  it("#792 A2 at 1440 a wide table keeps its words whole and scrolls", async () => {
    // Words with no space in them: a cell may break between words, never inside one.
    await page.viewport(1440, 900);
    const columns = 12;
    const header = `|${Array.from({ length: columns }, (_, c) => ` headerword${c} |`).join("")}`;
    const divider = `|${" --- |".repeat(columns)}`;
    const body = Array.from(
      { length: 3 },
      (_, r) =>
        `|${Array.from({ length: columns }, (_, c) => ` longwordnumber${r}${c} |`).join("")}`,
    );
    const { scroller } = await drawn(["before", "", header, divider, ...body].join("\n"));

    expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth);
    // A one-word cell is one line: its text's rectangles share a top.
    const cell = scroller.querySelectorAll("tbody td")[1] as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(cell);
    const tops = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)));
    expect(tops.size).toBe(1);
  });

  it("#792 R6 a table in another note at the same offset opens at its start", async () => {
    await page.viewport(1440, 900);
    const doc = wideNote(3);
    // One editor per note, each with its path, as the note pane gives them.
    const open = (path: string): EditorView =>
      new EditorView({
        state: EditorState.create({
          doc,
          extensions: [
            noteLanguage(),
            kastenTheme,
            vimKeys.of(false),
            livePreview(),
            notePath.of(path),
            vaultPaths.of([]),
            imagePaths.of([]),
            EditorView.lineWrapping,
          ],
        }),
        parent: document.body.appendChild(document.createElement("div")),
      });

    const first = open("A.md");
    await expect.poll(() => first.dom.querySelector(".cm-table-scroll")).not.toBeNull();
    const scrolledA = first.dom.querySelector(".cm-table-scroll") as HTMLElement;
    scrolledA.scrollLeft = 150;
    await expect.poll(() => scrolledA.scrollLeft).toBe(150);
    // The cursor into the table takes its widget off the page, keeping the place.
    first.dispatch({ selection: { anchor: doc.indexOf("| column 0") } });
    await expect.poll(() => first.dom.querySelector(".cm-table-block")).toBeNull();

    const second = open("B.md");
    await expect.poll(() => second.dom.querySelector(".cm-table-scroll")).not.toBeNull();
    await settled();
    const scrolledB = second.dom.querySelector(".cm-table-scroll") as HTMLElement;
    expect(scrolledB.scrollLeft).toBe(0);

    first.destroy();
    second.destroy();
  });

  it("#792 I5 a first column wider than half the box scrolls with the rest", async () => {
    // A long first cell in a narrow pane is wider than half the box, so it is
    // not held: the sticky column would take the whole scroll for itself.
    const long = "a first cell with far too much text to fit a phone pane at all";
    const doc = [
      "before",
      "",
      `| ${long} | b | c | d | e | f |`,
      "| - | - | - | - | - | - |",
      "| x | y | z | w | v | u |",
    ].join("\n");
    const { host } = await drawn(doc);
    host.classList.add("k-reader");
    host.style.width = "300px";
    const fresh = () => host.querySelector(".cm-table-block") as HTMLElement;
    await expect.poll(() => fresh().hasAttribute("data-first-wide")).toBe(true);

    const scroller = scrollerOf(fresh());
    scroller.scrollLeft = 60;
    await expect.poll(() => scroller.scrollLeft).toBe(60);
    const first = scroller.querySelector("tbody td") as HTMLElement;
    expect(first.getBoundingClientRect().left).toBeLessThan(scroller.getBoundingClientRect().left);
  });
});
