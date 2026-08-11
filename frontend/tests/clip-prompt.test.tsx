import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ClipPrompt } from "@/components/clip-prompt";

function renderPrompt(onClip = vi.fn().mockResolvedValue(undefined)) {
  const onClose = vi.fn();
  render(<ClipPrompt onClip={onClip} onClose={onClose} />);

  return {
    onClip,
    onClose,
    dialog: screen.getByRole("dialog", { name: "Import a web page" }),
    field: screen.getByLabelText("import"),
  };
}

describe("ClipPrompt", () => {
  it("takes the focus so a paste lands in it", () => {
    const { field } = renderPrompt();

    expect(field).toHaveFocus();
  });

  it("clips the address that was pasted", () => {
    const { onClip, dialog, field } = renderPrompt();

    fireEvent.change(field, { target: { value: " https://example.com/post " } });
    fireEvent.keyDown(dialog, { key: "Enter" });

    expect(onClip).toHaveBeenCalledExactlyOnceWith("https://example.com/post");
  });

  it("closes on escape without clipping anything", () => {
    const { onClip, onClose, dialog } = renderPrompt();

    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClip).not.toHaveBeenCalled();
  });

  it("refuses what is not a web address, and says so", () => {
    const { onClip, dialog, field } = renderPrompt();

    fireEvent.change(field, { target: { value: "file:///etc/passwd" } });
    fireEvent.keyDown(dialog, { key: "Enter" });

    expect(onClip).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(/https/i);
  });

  it("does nothing on an empty input", () => {
    const { onClip, dialog } = renderPrompt();

    fireEvent.keyDown(dialog, { key: "Enter" });

    expect(onClip).not.toHaveBeenCalled();
  });

  it("says it is working, and stops taking the key while it is", async () => {
    const onClip = vi.fn().mockReturnValue(new Promise(() => {}));
    const { dialog, field } = renderPrompt(onClip);

    fireEvent.change(field, { target: { value: "https://example.com/post" } });
    fireEvent.keyDown(dialog, { key: "Enter" });
    fireEvent.keyDown(dialog, { key: "Enter" });

    expect(onClip).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/reading/i));
  });

  it("stays open with the reason when the page could not be read", async () => {
    const onClip = vi.fn().mockRejectedValue(new Error("That page is too big to read"));
    const { onClose, dialog, field } = renderPrompt(onClip);

    fireEvent.change(field, { target: { value: "https://example.com/post" } });
    fireEvent.keyDown(dialog, { key: "Enter" });

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/too big/i));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("takes the key again once a failed clip has been read", async () => {
    const onClip = vi.fn().mockRejectedValue(new Error("nope"));
    const { dialog, field } = renderPrompt(onClip);

    fireEvent.change(field, { target: { value: "https://example.com/post" } });
    fireEvent.keyDown(dialog, { key: "Enter" });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("nope"));

    fireEvent.keyDown(dialog, { key: "Enter" });

    expect(onClip).toHaveBeenCalledTimes(2);
  });
});
