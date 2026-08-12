import { fireEvent, render, screen } from "@testing-library/react";
import { ImagePane } from "@/components/image-pane";
import { stubCommands } from "./stub-commands";

const SHOT = "99 Misc/02 Assets/01 Images/2026-08-12-abcdef01.png";

function open(path = SHOT) {
  const commands = stubCommands();
  const onDelete = vi.fn();
  const { container } = render(
    <ImagePane path={path} commands={commands} focusSignal={1} onDelete={onDelete} />,
  );
  const pane = container.querySelector("[data-image-pane]") as HTMLElement;
  return { commands, onDelete, pane };
}

describe("the image pane", () => {
  it("shows the image the vault serves, with the path above it", () => {
    open();

    const image = screen.getByRole("img") as HTMLImageElement;
    // Percent-encoded, the folders carrying spaces, and the slashes left alone.
    expect(image.getAttribute("src")).toBe(`/api/assets/${encodeURI(SHOT)}`);
    expect(image.alt).toBe("2026-08-12-abcdef01.png");
    expect(screen.getByText(SHOT)).toBeInTheDocument();
  });

  it("says so when there is no image at the path", () => {
    open();

    fireEvent.error(screen.getByRole("img"));

    expect(screen.getByRole("alert")).toHaveTextContent(SHOT);
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("takes the focus when the pane is moved to, so the keys land here", () => {
    const { pane } = open();

    expect(document.activeElement).toBe(pane);
  });

  it("closes the pane on the leader then q", () => {
    const { commands, pane } = open();

    fireEvent.keyDown(pane, { key: " " });
    fireEvent.keyDown(pane, { key: "q" });

    expect(commands.closeNote).toHaveBeenCalledTimes(1);
  });

  it("moves the image into the trash on d, the way the tree does", () => {
    const { onDelete, pane } = open();

    fireEvent.keyDown(pane, { key: "d" });

    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("leaves d to the leader when a sequence is open", () => {
    // `<leader>df` deletes the note in the focused pane, and this pane holds no
    // note: what matters is that the sequence swallows the `d` rather than the
    // bare key taking it.
    const { onDelete, pane } = open();

    fireEvent.keyDown(pane, { key: " " });
    fireEvent.keyDown(pane, { key: "d" });

    expect(onDelete).not.toHaveBeenCalled();
  });

  it("reaches a two-letter leader sequence, waiting for the second key", () => {
    const { commands, pane } = open();

    fireEvent.keyDown(pane, { key: " " });
    fireEvent.keyDown(pane, { key: "g" });
    expect(commands.openDaily).not.toHaveBeenCalled();

    fireEvent.keyDown(pane, { key: "d" });

    expect(commands.openDaily).toHaveBeenCalledTimes(1);
  });
});
