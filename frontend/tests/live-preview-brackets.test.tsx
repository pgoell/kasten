/// <reference types="node" />

import { readFileSync } from "node:fs";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import { kastenTheme } from "@/lib/editor-theme";
import { imagePaths } from "@/lib/image";
import { livePreview } from "@/lib/live/live-preview";
import { vaultPaths } from "@/lib/wikilink";
import { liveHooks, mount, plain } from "./live-preview-fixture";

liveHooks();

describe("a [text] with no (url) (#441)", () => {
  const VIM = [
    ["vim on", true],
    ["vim off", false],
  ] as const;

  /** With the app's highlighter, which is what gave the brackets a link's look. */
  function lit(vimOn: boolean): Extension[] {
    return [
      kastenTheme,
      ...(vimOn ? [vim(), livePreview(), vaultPaths.of([]), imagePaths.of([])] : plain(null)),
    ];
  }

  /**
   * The classes the highlighter gives a link's text, its brackets and a
   * reference's label, read off a bare one rather than named, the names being
   * generated.
   */
  function linkLook(): string[] {
    const view = mount("[a][r]", [kastenTheme]);
    const spans = [...view.contentDOM.querySelectorAll("span")];
    return [...new Set(spans.flatMap((span) => [...span.classList]))];
  }

  /** The elements of `line` wearing that look outside the mark that takes it off. */
  function linkLooking(line: Element): Element[] {
    const look = linkLook();
    // A link's text, its brackets and its label: three, or the probe read nothing.
    expect(look).toHaveLength(3);
    return [...line.querySelectorAll("*")].filter(
      (el) =>
        look.some((name) => el.classList.contains(name)) &&
        el.closest(".cm-plain-brackets") === null,
    );
  }

  function lineOf(view: EditorView, n: number): Element {
    return view.contentDOM.querySelectorAll(".cm-line")[n] as Element;
  }

  it.each(VIM)("draws see [text] here as plain text, the cursor elsewhere: %s", (_, vimOn) => {
    const line = lineOf(mount("intro\n\nsee [text] here", lit(vimOn)), 2);

    expect(line.textContent).toBe("see [text] here");
    expect(linkLooking(line)).toEqual([]);
  });

  it.each(VIM)("draws [text] as plain text with the cursor on it: %s", (_, vimOn) => {
    const doc = "intro\n\nsee [text] here";
    const line = lineOf(mount(doc, lit(vimOn), doc.indexOf("text")), 2);

    expect(line.textContent).toBe("see [text] here");
    expect(linkLooking(line)).toEqual([]);
  });

  it.each(VIM)("keeps bold and a heading on a [text], the link look gone: %s", (_, vimOn) => {
    const view = mount("intro\n\n**x [b] y**\n\n# a [h] z", lit(vimOn));
    const bold = lineOf(view, 2);
    const heading = lineOf(view, 4);
    // The heading's colour is a highlight class on the same spans, read off a
    // bare heading the way the link's look is.
    const spans = mount("# h", [kastenTheme]).contentDOM.querySelectorAll("span");
    const headingClass = spans[spans.length - 1]?.className;

    expect(bold.textContent).toBe("x [b] y");
    expect(linkLooking(bold)).toEqual([]);
    expect(bold.querySelector(".cm-plain-brackets")?.closest(".cm-strong")).not.toBeNull();
    expect(heading.textContent).toBe("a [h] z");
    expect(heading.classList.contains("cm-heading-1")).toBe(true);
    expect(linkLooking(heading)).toEqual([]);
    expect(heading.querySelector(".cm-plain-brackets span")?.classList).toContain(headingClass);
  });

  it.each(VIM)("draws a [text][ref] as plain text, the [ref] too: %s", (_, vimOn) => {
    const line = lineOf(mount("intro\n\nsee [text][ref] here", lit(vimOn)), 2);

    expect(line.textContent).toBe("see [text][ref] here");
    expect(linkLooking(line)).toEqual([]);
  });

  it.each(VIM)("draws a [x] at the head of a quote line as plain text (#435): %s", (_, vimOn) => {
    const line = lineOf(mount("intro\n\n> [x] done", lit(vimOn)), 2);

    expect(line.textContent).toContain("[x] done");
    expect(linkLooking(line)).toEqual([]);
  });

  it("resets the highlighter's spans under the mark, not kasten's marks inside it", () => {
    const css = readFileSync("src/styles/app.css", "utf8");
    const selector = /([^}/]*\.cm-plain-brackets[^{]*){[^}]*color:\s*inherit/s
      .exec(css)?.[1]
      ?.trim();
    const line = lineOf(mount("intro\n\nsee [**b** `c` ~~s~~ [[n]] #t] here", lit(false)), 2);
    const look = linkLook();
    const inside = [...line.querySelectorAll(".cm-plain-brackets span")];
    const marks = inside.filter((el) => [...el.classList].some((name) => name.startsWith("cm-")));
    const looking = inside.filter((el) => look.some((name) => el.classList.contains(name)));

    expect(selector).toBeDefined();
    // Bold, code, strikethrough, the wikilink and the tag.
    expect(marks).toHaveLength(5);
    expect(marks.filter((el) => el.matches(selector as string))).toEqual([]);
    expect(looking.length).toBeGreaterThan(0);
    expect(looking.filter((el) => !el.matches(selector as string))).toEqual([]);
  });

  it("leaves a real link its look", () => {
    const line = lineOf(mount("intro\n\nsee [a](https://example.com) here", lit(false)), 2);

    expect(line.querySelector(".cm-link")?.textContent).toBe("a");
    expect(line.querySelector(".cm-plain-brackets")).toBeNull();
  });
});
