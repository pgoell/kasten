import { EditorView } from "@codemirror/view";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@/components/editor";

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "fonts");
});

describe("the editor build", () => {
  it("#972 A2 the editor is built off the page: document.fonts.ready is read while the new view is not in the document", () => {
    // CodeMirror reads fonts.ready in its constructor. A view already joined to the
    // page forces a style pass over its own tree at that point, so the read has to
    // come before the tree is in the document.
    const seen: boolean[] = [];
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: {
        get ready() {
          seen.push(document.querySelector(".cm-editor") !== null);
          return Promise.resolve();
        },
      },
    });

    render(<Editor initialDoc="plain" />);

    expect(seen.length).toBeGreaterThan(0);
    expect(seen).not.toContain(true);
  });

  it("#972 A3 a mount does not reconfigure the listings", () => {
    // The view is built with the listings already in it. Sending them again on
    // mount reconfigures the fresh view, and that costs a style pass the mount
    // does not need.
    const dispatch = vi.spyOn(EditorView.prototype, "dispatch");
    const listings = { paths: ["a.md"], images: ["p.png"], tags: ["work"], relations: ["parent"] };

    const { rerender } = render(<Editor initialDoc="plain" {...listings} />);

    expect(dispatch).not.toHaveBeenCalled();

    dispatch.mockClear();
    rerender(<Editor initialDoc="plain" {...listings} paths={["a.md", "b.md"]} />);

    expect(dispatch).toHaveBeenCalled();
  });
});
