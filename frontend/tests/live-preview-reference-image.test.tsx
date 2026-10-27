import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import { act, fireEvent, waitFor } from "@testing-library/react";
import { imagePaths } from "@/lib/image";
import { livePreview } from "@/lib/live/live-preview";
import { vaultPaths } from "@/lib/wikilink";
import { liveHooks, mount, plain } from "./live-preview-fixture";

liveHooks();

describe("a reference image (#547)", () => {
  const VIM = [
    ["vim on", true],
    ["vim off", false],
  ] as const;
  const CAT = "https://example.com/cat.png";

  function lit(vimOn: boolean): Extension[] {
    return vimOn ? [vim(), livePreview(), vaultPaths.of([]), imagePaths.of([])] : plain(null);
  }

  function lineOf(view: EditorView, n: number): Element {
    return view.contentDOM.querySelectorAll(".cm-line")[n] as Element;
  }

  /** The address and alt text of every picture drawn, in document order. */
  function pictures(view: EditorView): [string | null, string | null][] {
    return [...view.dom.querySelectorAll("img.cm-image")].map((img) => [
      img.getAttribute("src"),
      img.getAttribute("alt"),
    ]);
  }

  it.each(VIM)("A4 draws ![cat][pic] with a definition below as the picture: %s", (_, vimOn) => {
    const view = mount(`intro\n\n![cat][pic]\n\n[pic]: ${CAT}`, lit(vimOn));

    expect(pictures(view)).toEqual([[CAT, "cat"]]);
  });

  it.each([
    ["collapsed", "vim on", "![cat][]", true],
    ["collapsed", "vim off", "![cat][]", false],
    ["shortcut", "vim on", "![cat]", true],
    ["shortcut", "vim off", "![cat]", false],
  ] as const)("A5 draws a %s reference image as the picture: %s", (_, __, image, vimOn) => {
    const view = mount(`intro\n\n${image}\n\n[cat]: ${CAT}`, lit(vimOn));

    expect(pictures(view)).toEqual([[CAT, "cat"]]);
  });

  it("A6 draws ![a](<x.png>) as the vault's x.png, the brackets taken off", () => {
    const view = mount("intro\n\n![a](<x.png>)", plain(null));

    expect(pictures(view)).toEqual([["/api/assets/x.png", "a"]]);
  });

  it("A7 leaves an image defined as a script address as typed", () => {
    const doc = [
      "intro",
      "",
      "![a][js]",
      "",
      "![b][data]",
      "",
      "![c][vb]",
      "",
      "![d][ok]",
      "",
      "[js]: javascript:x",
      "",
      "[data]: data:image/png;base64,AA",
      "",
      "[vb]: vbscript:x",
      "",
      `[ok]: ${CAT}`,
    ].join("\n");
    const view = mount(doc, plain(null));

    // One assertion: the code before #547 drew every reference image as a
    // broken picture, scripts included, so neither half holds there.
    expect({
      typed: [2, 4, 6].map((n) => lineOf(view, n).textContent),
      pictures: pictures(view),
    }).toEqual({ typed: ["![a][js]", "![b][data]", "![c][vb]"], pictures: [[CAT, "d"]] });
  });

  it.each(VIM)(
    "I1 shows a reference image's source with the cursor on its line: %s",
    async (_, vimOn) => {
      const doc = `intro\n\n![cat][pic]\n\n[pic]: ${CAT}`;
      const view = mount(doc, lit(vimOn), doc.indexOf("![cat]"));
      // Vim's normal mode draws the picture under the cursor too; insert mode
      // hands the source back, as it does for an inline image.
      if (vimOn) fireEvent.keyDown(view.contentDOM, { key: "i" });

      await waitFor(() => expect(lineOf(view, 2).textContent).toBe("![cat][pic]"));
      act(() => view.dispatch({ selection: { anchor: 0 } }));
      expect(pictures(view)).toEqual([[CAT, "cat"]]);
    },
  );

  it("I2 keeps an undefined ![alt][ref] as typed beside a defined one", () => {
    const view = mount(`intro\n\n![alt][ref]\n\n![cat][pic]\n\n[pic]: ${CAT}`, plain(null));

    expect({ typed: lineOf(view, 2).textContent, pictures: pictures(view) }).toEqual({
      typed: "![alt][ref]",
      pictures: [[CAT, "cat"]],
    });
  });

  it("I3 draws a reference image in a table cell as the picture", () => {
    const view = mount(`intro\n\n| a |\n| - |\n| ![cat][pic] |\n\n[pic]: ${CAT}`, plain(null));
    const cell = view.dom.querySelector(".cm-table-grid tbody td");

    expect(cell).not.toBeNull();
    expect(cell?.querySelector("img.cm-image")?.getAttribute("src")).toBe(CAT);
  });

  it("I5 takes no definition for an image from a fenced code block", () => {
    const doc = `intro\n\n![a][code]\n\n\`\`\`\n[code]: ${CAT}\n\`\`\`\n\n![cat][pic]\n\n[pic]: ${CAT}`;
    const view = mount(doc, plain(null));

    expect({ typed: lineOf(view, 2).textContent, pictures: pictures(view) }).toEqual({
      typed: "![a][code]",
      pictures: [[CAT, "cat"]],
    });
  });

  it("I6 draws a reference image to a video as the player and to a sound as its control", () => {
    const doc = [
      "intro",
      "",
      "![v][clip]",
      "",
      "![s][word]",
      "",
      "[clip]: https://youtu.be/iDulhoQ2pro",
      "",
      "[word]: x.mp3",
    ].join("\n");
    const view = mount(doc, plain(null));

    expect({
      video: view.dom
        .querySelector("iframe.cm-video-frame")
        ?.getAttribute("src")
        ?.includes("/embed/iDulhoQ2pro"),
      sound: view.dom.querySelector("audio.cm-audio")?.getAttribute("src"),
    }).toEqual({ video: true, sound: "/api/assets/x.mp3" });
  });
});

describe("an undefined reference image (#554)", () => {
  const CAT = "https://example.com/cat.png";

  function lit(vimOn: boolean): Extension[] {
    return vimOn ? [vim(), livePreview(), vaultPaths.of([]), imagePaths.of([])] : plain(null);
  }

  function lineOf(view: EditorView, n: number): Element {
    return view.contentDOM.querySelectorAll(".cm-line")[n] as Element;
  }

  it("A5 marks an undefined full reference image as plain text, vim on", () => {
    const line = lineOf(mount("intro\n\n![alt][ref]", lit(true)), 2);

    expect(line.querySelector(".cm-plain-brackets")?.textContent).toBe("![alt][ref]");
  });

  it("A5 marks an undefined full reference image as plain text, vim off", () => {
    const line = lineOf(mount("intro\n\n![alt][ref]", lit(false)), 2);

    expect(line.querySelector(".cm-plain-brackets")?.textContent).toBe("![alt][ref]");
  });

  it("I5 marks an undefined collapsed and shortcut image, a defined one still drawn", () => {
    const view = mount(`intro\n\n![alt][]\n\n![alt]\n\n![cat][pic]\n\n[pic]: ${CAT}`, lit(false));

    expect({
      marked: [2, 4].map((n) => lineOf(view, n).querySelector(".cm-plain-brackets")?.textContent),
      pictures: [...view.dom.querySelectorAll("img.cm-image")].map((img) =>
        img.getAttribute("src"),
      ),
    }).toEqual({ marked: ["![alt][]", "![alt]"], pictures: [CAT] });
  });
});
