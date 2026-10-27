import { type Extension, StateEffect } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import { act } from "@testing-library/react";
import { imagePaths } from "@/lib/image";
import { livePreview } from "@/lib/live-preview";
import { notePath } from "@/lib/todo/todo-commands";
import { vimKeys } from "@/lib/vim-mode";
import { vaultPaths } from "@/lib/wikilink";
import { ABOVE, liveHooks, mount, plain } from "./live-preview-fixture";

liveHooks();

describe("an image in a table cell (#504)", () => {
  /** A line above the table, so the cursor at offset zero is off it. */
  function table(...rows: string[]): string {
    return ["intro", "", ...rows].join("\n");
  }

  function lit(vimOn: boolean): Extension[] {
    return vimOn ? [vim(), livePreview(), vaultPaths.of([]), imagePaths.of([])] : plain(null);
  }

  function cells(view: EditorView, selector = "tbody td"): HTMLElement[] {
    return [...view.dom.querySelectorAll<HTMLElement>(`.cm-table-grid ${selector}`)];
  }

  it.each([
    ["A1", "vim off", false],
    ["A2", "vim on", true],
  ] as const)("%s draws ![](path) in a cell as its picture, %s", (_, __, vimOn) => {
    const doc = table("| a | b |", "| --- | --- |", "| ![](p.png) | ![](ftp://x/a.png) |");
    const view = mount(doc, lit(vimOn));

    const [drawn, refused] = cells(view);
    expect(drawn?.querySelector("img.cm-image")?.getAttribute("src")).toBe("/api/assets/p.png");
    // An address `imageSource` cannot load stays its source, as it does outside a table.
    expect(refused?.querySelector("img")).toBeNull();
    expect(refused?.textContent).toBe("![](ftp://x/a.png)");

    act(() => view.dispatch({ selection: { anchor: doc.indexOf("p.png") } }));
    expect(view.dom.querySelector(".cm-table-grid")).toBeNull();
    expect(view.contentDOM.textContent).toContain("| ![](p.png) | ![](ftp://x/a.png) |");
  });

  it("A3 draws two percent-encoded images side by side in a note in a subfolder", () => {
    const pbi = "99%20Misc/02%20Assets/01%20Images/aibi-judge-01-pbi.png";
    const aibi = "99%20Misc/02%20Assets/01%20Images/aibi-judge-01-aibi.png";
    const view = mount(
      table("| Power BI | AI/BI |", "|---|---|", `| ![](${pbi}) | ![](${aibi}) |`),
      [...plain(null), notePath.of("02 Projects/AIBI Migration Plugin/Judge Labels 2026-10-18.md")],
    );

    const row = view.dom.querySelector(".cm-table-grid tbody tr") as HTMLElement;
    expect([...row.querySelectorAll("img.cm-image")].map((img) => img.getAttribute("src"))).toEqual(
      [`/api/assets/${pbi}`, `/api/assets/${aibi}`],
    );
  });

  it("I2 asks for a measurement when a picture in a cell loads", () => {
    const view = mount(table("| a |", "| --- |", "| ![](p.png) |"), plain(null));
    const measure = vi.spyOn(view, "requestMeasure");

    const image = view.dom.querySelector(".cm-table-grid img.cm-image") as HTMLImageElement;
    expect(image.referrerPolicy).toBe("no-referrer");
    image.dispatchEvent(new Event("load"));
    expect(measure).toHaveBeenCalled();
  });

  it("I3 keeps the text and marks beside a picture in a cell, alt carried", () => {
    const view = mount(table("| a |", "| --- |", "| a ![x](p.png) **b** |"), plain(null));

    const [cell] = cells(view);
    expect(cell?.firstChild?.textContent).toBe("a ");
    expect(cell?.querySelector("img.cm-image")?.getAttribute("alt")).toBe("x");
    expect(cell?.querySelector(".cm-strong")?.textContent).toBe("b");
  });

  it("I4 leaves a sound and a video in a cell as source, a picture beside them drawn", () => {
    const view = mount(
      table(
        "| a | b | c |",
        "| - | - | - |",
        "| ![](word.mp3) | ![](https://youtu.be/iDulhoQ2pro) | ![](p.png) |",
      ),
      plain(null),
    );

    const [sound, video, picture] = cells(view);
    expect(sound?.textContent).toBe("![](word.mp3)");
    expect(video?.textContent).toBe("![](https://youtu.be/iDulhoQ2pro)");
    expect(view.dom.querySelectorAll(".cm-table-grid img")).toHaveLength(1);
    expect(picture?.querySelector("img")?.getAttribute("src")).toBe("/api/assets/p.png");
  });

  it("I5 draws a picture in a header cell", () => {
    const view = mount(table("| ![h](p.png) |", "| --- |", "| a |"), plain(null));

    const [head] = cells(view, "thead th");
    expect(head?.querySelector("img.cm-image")?.getAttribute("alt")).toBe("h");
  });
});

describe("an embed or a wrapped image in a table cell (#507, #508)", () => {
  const SHOT = "/api/assets/99%20Misc/my%20shot.png";

  /** A line above the table, so the cursor at offset zero is off it. */
  function table(...cells: string[]): string {
    const row = (cell: (text: string) => string) =>
      `|${cells.map((c) => ` ${cell(c)} |`).join("")}`;
    return ["intro", "", row(() => "h"), row(() => "-"), row((c) => c)].join("\n");
  }

  function lit(vimOn: boolean): Extension[] {
    return vimOn
      ? [vim(), livePreview(), vaultPaths.of(["b.md"]), imagePaths.of(["99 Misc/my shot.png"])]
      : plain(null);
  }

  function cells(view: EditorView): HTMLElement[] {
    return [...view.dom.querySelectorAll<HTMLElement>(".cm-table-grid tbody td")];
  }

  it("A1 draws ![[x.png]] in a cell as the picture the vault holds", () => {
    const view = mount(table("![[my shot.png]]"), plain(null));

    const [cell] = cells(view);
    expect(cell?.querySelector("img.cm-image")?.getAttribute("src")).toBe(SHOT);
    expect(cell?.textContent).toBe("");
  });

  it("A2 draws ![[x.png\\|200]] in a cell at width 200", () => {
    // The bar escaped, as a table needs it to be.
    const view = mount(table("![[my shot.png\\|200]]"), plain(null));

    const image = cells(view)[0]?.querySelector("img.cm-image");
    expect(image?.getAttribute("src")).toBe(SHOT);
    expect(image?.getAttribute("width")).toBe("200");
    expect(image?.getAttribute("alt")).toBe("");
  });

  it("A3 draws a picture wrapped in a link in a cell", () => {
    const view = mount(table("[![](p.png)](https://example.com)"), plain(null));

    const [cell] = cells(view);
    expect(cell?.querySelector("img.cm-image")?.getAttribute("src")).toBe("/api/assets/p.png");
    expect(cell?.textContent).toBe("");
  });

  it.each([["**![](p.png)**"], ["*![](p.png)*"]])(
    "A4 draws a picture wrapped in emphasis in a cell, %s",
    (source) => {
      const view = mount(table(source), plain(null));

      const [cell] = cells(view);
      expect(cell?.querySelector("img.cm-image")?.getAttribute("src")).toBe("/api/assets/p.png");
      expect(cell?.textContent).toBe("");
    },
  );

  it("A4 draws bold text around a picture in a cell as bold text and the picture", () => {
    const view = mount(table("**word ![](p.png) more**"), plain(null));

    const [cell] = cells(view);
    expect(cell?.querySelector("img.cm-image")?.getAttribute("src")).toBe("/api/assets/p.png");
    expect([...(cell?.querySelectorAll(".cm-strong") ?? [])].map((s) => s.textContent)).toEqual([
      "word ",
      " more",
    ]);
  });

  it.each([
    ["vim off", false],
    ["vim on", true],
  ] as const)("A6 draws the embedded, linked and emphasized pictures of a cell, %s", (_, vimOn) => {
    const doc = table(
      "![[my shot.png]]",
      "![[my shot.png\\|200]]",
      "[![](p.png)](https://example.com)",
      "**![](p.png)**",
      "*![](p.png)*",
    );
    const view = mount(doc, lit(vimOn));

    expect(
      cells(view).map((cell) => cell.querySelector("img.cm-image")?.getAttribute("src")),
    ).toEqual([SHOT, SHOT, "/api/assets/p.png", "/api/assets/p.png", "/api/assets/p.png"]);
  });

  it("I1 shows every cell's source again, marks included, with the cursor in the table", () => {
    const row = "| ![[my shot.png\\|200]] | [![](p.png)](https://example.com) | **![](p.png)** |";
    const doc = ["intro", "", "| a | b | c |", "| - | - | - |", row].join("\n");
    const view = mount(doc, plain(null));
    expect(view.dom.querySelector(".cm-table-grid")).not.toBeNull();

    act(() => view.dispatch({ selection: { anchor: doc.indexOf("p.png") } }));
    expect(view.dom.querySelector(".cm-table-grid")).toBeNull();
    expect(view.dom.querySelector("img")).toBeNull();
    expect(view.contentDOM.textContent).toContain(row);
  });

  it("I2 leaves ![[missing.png]] and a note embed ![[note]] in a cell as source", () => {
    const view = mount(table("![[missing.png]]", "![[b]]"), plain(null));

    expect(cells(view).map((cell) => cell.textContent)).toEqual(["![[missing.png]]", "![[b]]"]);
    expect(view.dom.querySelector(".cm-table-grid img")).toBeNull();
  });

  it("I3 reads an embed's alias in a cell as Obsidian does: words are alt, 200x100 a size", () => {
    const view = mount(
      table("![[my shot.png\\|some words]]", "![[my shot.png\\|200x100]]"),
      plain(null),
    );

    const [words, sized] = cells(view).map((cell) => cell.querySelector("img.cm-image"));
    expect(words?.getAttribute("alt")).toBe("some words");
    expect(words?.hasAttribute("width")).toBe(false);
    expect(words?.hasAttribute("height")).toBe(false);
    expect(sized?.getAttribute("width")).toBe("200");
    expect(sized?.getAttribute("height")).toBe("100");
  });

  it("I4 draws ![[x.png|200]] at width 200 outside a table too", () => {
    const view = mount(`${ABOVE}![[my shot.png|200]]`, plain(null));

    const image = view.dom.querySelector("img.cm-image");
    expect(image?.getAttribute("src")).toBe(SHOT);
    expect(image?.getAttribute("width")).toBe("200");
  });

  it("I5 still draws a link and emphasis around text in a cell", () => {
    const view = mount(table("[site](https://example.com)", "**bold**", "*soft*"), plain(null));

    const [link, bold, soft] = cells(view);
    expect(link?.querySelector(".cm-link")?.textContent).toBe("site");
    expect(bold?.querySelector(".cm-strong")?.textContent).toBe("bold");
    expect(soft?.querySelector(".cm-emphasis")?.textContent).toBe("soft");
    expect(cells(view).map((cell) => cell.textContent)).toEqual(["site", "bold", "soft"]);
  });

  it("I8 draws ![[x.png]] in a cell once the image listing lands", () => {
    const view = mount(table("![[my shot.png]]"), [
      vimKeys.of(false),
      livePreview(),
      vaultPaths.of([]),
    ]);
    expect(cells(view)[0]?.textContent).toBe("![[my shot.png]]");

    act(() =>
      view.dispatch({
        effects: StateEffect.appendConfig.of(imagePaths.of(["99 Misc/my shot.png"])),
      }),
    );
    expect(cells(view)[0]?.querySelector("img.cm-image")?.getAttribute("src")).toBe(SHOT);
  });
});
