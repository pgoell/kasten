import { render, screen, within } from "@testing-library/react";
import { KeyHelp } from "@/components/key-help";

/** One group's table, found by its heading, as the key help test finds them. */
function group(title: string) {
  return within(screen.getByRole("heading", { name: title }).parentElement as HTMLElement);
}

describe("KeyHelp over a video", () => {
  it("#791 A9 lists k, j, l and y under Over a video", () => {
    render(<KeyHelp onClose={() => {}} />);

    const rows = [
      ["k", "Play or pause"],
      ["j", "Ten seconds back"],
      ["l", "Ten seconds on"],
      ["y", "Take the selected transcript into the note"],
    ] as const;
    for (const [key, label] of rows) {
      expect(group("Over a video").getByText(key).nextElementSibling).toHaveTextContent(label);
    }
  });

  it("#914 A6 lists f under Over a video", () => {
    render(<KeyHelp onClose={() => {}} />);

    expect(group("Over a video").queryByText("f")?.nextElementSibling).toHaveTextContent(
      "Full screen, and out again",
    );
  });
});
