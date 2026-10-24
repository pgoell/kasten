/**
 * A table as the Read look draws it (#792): the type and the rules, the sideways
 * and downward scroll inside the table's own box with the first column and the
 * head row held, the edge shadows, the numbers to the right, the phone that does
 * not wrap, and the scroll place kept across a redraw.
 *
 * A real browser, because every one of these is a layout or a computed style. The
 * editor is the app's own, mounted the way table-link-url.test.tsx mounts it.
 */

import { EditorView } from "@codemirror/view";
import { cdp, page } from "vitest/browser";
import { mountApp, SITE, stubOpen, tableLinkCleanup, tap } from "./table-link-fixture";

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
    expect(getComputedStyle(block, "::after").backgroundImage).toContain("0, 0, 0");

    // A light shadow would be a bar in dark, so the dark theme keeps it black.
    document.documentElement.setAttribute("data-theme", "dark");
    await expect
      .poll(() => getComputedStyle(block, "::after").backgroundImage)
      .toContain("0, 0, 0");
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
});
