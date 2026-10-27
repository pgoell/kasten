import { vim } from "@replit/codemirror-vim";
import { render } from "@testing-library/react";
import { NotePreview } from "@/components/note-preview";
import { imagePaths } from "@/lib/image";
import { livePreview } from "@/lib/live/live-preview";
import { vaultPaths } from "@/lib/wikilink";
import { content, liveHooks, mount, plain } from "./live-preview-fixture";

liveHooks();

describe("an escape the import writes (#342, #343)", () => {
  /** The text drawn for the document's last line, the cursor on the first. */
  function drawnLast(line: string, vimOn: boolean): string {
    const view = mount(
      `intro\n\n${line}`,
      vimOn ? [vim(), livePreview(), vaultPaths.of([]), imagePaths.of([])] : plain(null),
    );
    return [...view.contentDOM.querySelectorAll(".cm-line")].at(-1)?.textContent ?? "";
  }

  it.each([
    ["vim on", true],
    ["vim off", false],
  ])("A1 shows a code span holding &#58; as &#58; off the line, %s", (_, vimOn) => {
    expect(drawnLast("`&#58;`", vimOn)).toBe("&#58;");
  });

  it.each([
    ["vim on", true],
    ["vim off", false],
  ])("A3 shows a\\\\-b as a\\-b off the line, %s", (_, vimOn) => {
    expect(drawnLast("a\\\\-b", vimOn)).toBe("a\\-b");
  });

  it("A3 review draws a card side a\\\\-b as a\\-b", () => {
    const { container } = render(<NotePreview text={"a\\\\-b"} />);

    expect(content(container)).toBe("a\\-b");
  });

  it("A4 review draws the answer ==a\\\\::b== as a\\::b", () => {
    const { container } = render(<NotePreview text={"==a\\\\::b=="} />);

    expect(content(container)).toBe("a\\::b");
  });
});
