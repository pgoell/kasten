import { EditorView } from "@codemirror/view";
import { act, render } from "@testing-library/react";
import { Editor } from "@/components/editor";
import { toggleVim } from "@/lib/editor/vim-setting";
import { type EmbedSource, embedSource } from "@/lib/embed";

describe("Editor embeds", () => {
  function source(container: HTMLElement) {
    const view = EditorView.findFromDOM(container.querySelector(".cm-editor") as HTMLElement);
    return view?.state.facet(embedSource);
  }

  function embeds(): EmbedSource {
    return { watch: vi.fn(() => () => {}), open: vi.fn() };
  }

  afterEach(() => localStorage.clear());

  it("tells nothing about the vault to a view handed no source", () => {
    const { container } = render(<Editor initialDoc="hello" />);

    expect(source(container)).toBeNull();
  });

  it("carries the source it was handed, the latest one, through a vim toggle", () => {
    const first = embeds();
    const second = embeds();
    const { container, rerender } = render(<Editor initialDoc="hello" embeds={first} />);
    rerender(<Editor initialDoc="hello" embeds={second} />);
    act(() => toggleVim());

    const listener = vi.fn();
    source(container)?.watch("a.md", listener);
    source(container)?.open("a.md", 3);

    expect(second.watch).toHaveBeenCalledWith("a.md", listener);
    expect(second.open).toHaveBeenCalledWith("a.md", 3);
    expect(first.watch).not.toHaveBeenCalled();
  });
});
