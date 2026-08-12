import { fireEvent, render, screen } from "@testing-library/react";
import { ImagePane } from "@/components/image-pane";
import { stubCommands } from "./stub-commands";

const SHOT = "99 Misc/02 Assets/01 Images/2026-08-12-abcdef01.png";

function open(path = SHOT) {
  const commands = stubCommands();
  const { container } = render(<ImagePane path={path} commands={commands} focusSignal={1} />);
  const pane = container.querySelector("[data-image-pane]") as HTMLElement;
  return { commands, pane };
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

  it("reaches a two-letter leader sequence, waiting for the second key", () => {
    const { commands, pane } = open();

    fireEvent.keyDown(pane, { key: " " });
    fireEvent.keyDown(pane, { key: "g" });
    expect(commands.openDaily).not.toHaveBeenCalled();

    fireEvent.keyDown(pane, { key: "d" });

    expect(commands.openDaily).toHaveBeenCalledTimes(1);
  });
});
