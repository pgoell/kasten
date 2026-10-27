import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { imagePaths } from "@/lib/image";
import { livePreview } from "@/lib/live/live-preview";
import { vimKeys } from "@/lib/vim-mode";
import { vaultPaths } from "@/lib/wikilink";
import { liveHooks, mount } from "./live-preview-fixture";

liveHooks();

describe("a space in an image address (#553)", () => {
  const VIM = [
    ["vim on", true],
    ["vim off", false],
  ] as const;
  const SHOT = "![shot](99 Misc/shot.png)";

  function lit(vimOn: boolean): Extension[] {
    const images = imagePaths.of(["99 Misc/shot.png"]);
    return vimOn
      ? [vim(), livePreview(), vaultPaths.of([]), images]
      : [vimKeys.of(false), livePreview(), vaultPaths.of([]), images];
  }

  function lineOf(view: EditorView, n: number): Element {
    return view.contentDOM.querySelectorAll(".cm-line")[n] as Element;
  }

  function pictures(view: EditorView): [string | null, string | null][] {
    return [...view.dom.querySelectorAll("img.cm-image")].map((img) => [
      img.getAttribute("src"),
      img.getAttribute("alt"),
    ]);
  }

  it("A4 draws a spaced bare image address as the vault picture, vim on", () => {
    const view = mount(`intro\n\n${SHOT}`, lit(true));

    expect(pictures(view)).toEqual([["/api/assets/99%20Misc/shot.png", "shot"]]);
    expect(lineOf(view, 2).textContent).toBe("");
  });

  it("A4 draws a spaced bare image address as the vault picture, vim off", () => {
    const view = mount(`intro\n\n${SHOT}`, lit(false));

    expect(pictures(view)).toEqual([["/api/assets/99%20Misc/shot.png", "shot"]]);
    expect(lineOf(view, 2).textContent).toBe("");
  });

  it.each(VIM)(
    "I1 shows a spaced image address as typed with the cursor on its line: %s",
    async (_, vimOn) => {
      const doc = `intro\n\n${SHOT}`;
      const view = mount(doc, lit(vimOn), doc.indexOf("![shot]"));
      if (vimOn) fireEvent.keyDown(view.contentDOM, { key: "i" });

      await waitFor(() => expect(lineOf(view, 2).textContent).toBe(SHOT));
      act(() => view.dispatch({ selection: { anchor: 0 } }));
      expect(pictures(view)).toEqual([["/api/assets/99%20Misc/shot.png", "shot"]]);
    },
  );

  it("I2 draws a spaced image address in a table cell as the picture", () => {
    const view = mount(`intro\n\n| a |\n| - |\n| ${SHOT} |`, lit(false));
    const cell = view.dom.querySelector(".cm-table-grid tbody td");

    expect(cell?.querySelector("img.cm-image")?.getAttribute("src")).toBe(
      "/api/assets/99%20Misc/shot.png",
    );
    expect(cell?.textContent).toBe("");
  });

  it("I3 keeps a spaced script address as typed and draws a spaced https one", () => {
    const view = mount(
      "intro\n\n![a](javascript:x y)\n\n![b](https://example.com/a b.png)",
      lit(false),
    );

    expect({ typed: lineOf(view, 2).textContent, pictures: pictures(view) }).toEqual({
      typed: "![a](javascript:x y)",
      pictures: [["https://example.com/a%20b.png", "b"]],
    });
  });

  it("I4 draws the spaced address in the parens over a definition of the alt text", () => {
    const view = mount("intro\n\n![a](x y.png)\n\n[a]: other.png", lit(false));

    expect(pictures(view)).toEqual([["/api/assets/x%20y.png", "a"]]);
  });
});
