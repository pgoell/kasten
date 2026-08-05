import { fireEvent, render } from "@testing-library/react";
import { Editor } from "@/components/editor";
import type { EditorCommands } from "@/lib/key-bindings";

function stubCommands() {
  return { toggleTree: vi.fn() } satisfies EditorCommands;
}

function content(container: HTMLElement): string {
  return (container.querySelector(".cm-content") as HTMLElement).textContent ?? "";
}

function open(doc: string, commands: EditorCommands) {
  const { container } = render(<Editor initialDoc={doc} commands={commands} />);
  return {
    container,
    editor: container.querySelector(".cm-content") as HTMLElement,
  };
}

describe("the leader key", () => {
  it("runs the file tree command on space then b", () => {
    const commands = stubCommands();
    const { editor } = open("plain", commands);

    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "b" });

    expect(commands.toggleTree).toHaveBeenCalledTimes(1);
  });

  it("stops space from moving the cursor", () => {
    const commands = stubCommands();
    const { container, editor } = open("plain", commands);

    // Vim ships `<Space>` bound to `l`. Were it still bound, the space would
    // step onto the `l` and `x` would cut it, leaving "pain". Read through a
    // delete because moving a cursor leaves the text alone either way.
    fireEvent.keyDown(editor, { key: " " });
    fireEvent.keyDown(editor, { key: "x" });

    expect(content(container)).toBe("plain");
  });
});
