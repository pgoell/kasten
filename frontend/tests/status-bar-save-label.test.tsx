import { render, screen } from "@testing-library/react";
import { StatusBar } from "@/components/status-bar";

// The frontend's own half of the reading is stamped in at build time, so it is
// whatever commit the checkout running these tests is on. Mocked to a fixed one
// rather than read, or the cases below would assert against the working tree.
const { BUILD } = vi.hoisted(() => ({ BUILD: { value: "" } }));
vi.mock("@/lib/build", () => ({
  get BUILD() {
    return BUILD.value;
  },
}));

afterEach(() => {
  BUILD.value = "";
});

describe("StatusBar", () => {
  it("says nothing about saving while no note is open", () => {
    // The sample document the app opens with is not a note and is not written
    // anywhere, so a ring reporting it saved would be a lie.
    const { container } = render(<StatusBar />);

    expect(container.querySelector("[data-testid='save-status']")).toBeNull();
    expect(container.querySelector("footer")).not.toBeNull();
  });

  it.each([
    ["saved", "Saved"],
    ["unsaved", "Unsaved changes"],
    ["saving", "Saving"],
    ["error", "Could not save"],
    ["conflict", "Changed on disk"],
  ] as const)("names the %s state for anyone who cannot see the ring", (status, label) => {
    const { container } = render(<StatusBar status={status} />);

    expect(container.querySelector("[data-testid='save-status']")).toHaveAttribute(
      "aria-label",
      label,
    );
  });

  it("names the trouble beside the sign, which a 16px icon on its own does not", () => {
    render(<StatusBar status="conflict" />);

    expect(screen.getByText("Changed on disk")).toBeInTheDocument();
  });

  it("says nothing beside the ring while the writing is going fine", () => {
    render(<StatusBar status="saving" />);

    expect(screen.queryByText("Saving")).toBeNull();
  });

  it("says on hover what the vault answered and what to do about it", () => {
    const { container } = render(
      <StatusBar status="error" reason="PUT /api/files/index.md failed with 500" />,
    );

    const title = container.querySelector("[data-testid='save-status']")?.getAttribute("title");
    expect(title).toContain("PUT /api/files/index.md failed with 500");
    expect(title).toContain(":w");
  });

  it("says on hover both ways out of a note that changed on disk", () => {
    const { container } = render(<StatusBar status="conflict" />);

    const title = container.querySelector("[data-testid='save-status']")?.getAttribute("title");
    expect(title).toContain(":w");
    expect(title).toContain(":e!");
  });

  it("shows the warning sign rather than the ring when the note changed on disk", () => {
    // A spinning ring reads as a write on its way out, and while the note
    // stands conflicted nothing is on its way anywhere until `:w`.
    const { container } = render(<StatusBar status="conflict" />);

    expect(container.querySelector("[data-testid='save-error']")).not.toBeNull();
    expect(container.querySelector("[data-testid='save-spinner']")).toBeNull();
  });
});
