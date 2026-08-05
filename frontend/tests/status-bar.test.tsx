import { render } from "@testing-library/react";
import { StatusBar } from "@/components/status-bar";

describe("StatusBar", () => {
  it("says nothing about saving while no note is open", () => {
    // The sample document the app opens with is not a note and is not written
    // anywhere, so a ring reporting it saved would be a lie.
    const { container } = render(<StatusBar />);

    expect(container.querySelector("[data-testid='save-status']")).toBeNull();
    expect(container.querySelector("footer")).not.toBeNull();
  });

  it("names the state for anyone who cannot see the ring", () => {
    const { container } = render(<StatusBar status="unsaved" />);

    expect(container.querySelector("[data-testid='save-status']")).toHaveAttribute(
      "aria-label",
      "Unsaved changes",
    );
  });
});
