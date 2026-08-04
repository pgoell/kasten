import { render } from "@testing-library/react";
import { Editor } from "@/components/editor";

describe("Editor", () => {
  it("mounts a CodeMirror view holding the initial document", () => {
    const { container } = render(<Editor initialDoc="# hello" />);

    expect(container.querySelector(".cm-editor")).not.toBeNull();
    expect(container.querySelector(".cm-content")?.textContent).toBe("# hello");
  });

  it("tears the view down on unmount", () => {
    const { container, unmount } = render(<Editor initialDoc="# hello" />);

    unmount();

    expect(container.querySelector(".cm-editor")).toBeNull();
  });
});
