import { fireEvent, render, screen } from "@testing-library/react";
import { StatusBar } from "@/components/status-bar";

// The frontend's own half of the reading is stamped in at build time, so it is
// whatever commit the checkout running these tests is on. Mocked to a fixed one
// rather than read, or the cases below would assert against the working tree.
const { BUILD } = vi.hoisted(() => ({ BUILD: { value: "" } }));
vi.mock("@/lib/app/build", () => ({
  get BUILD() {
    return BUILD.value;
  },
}));

afterEach(() => {
  BUILD.value = "";
});

describe("the clock in the bar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("settles a conflict by touch, a phone having no prompt to type :w at", () => {
    const onWrite = vi.fn();
    const onTakeVault = vi.fn();
    render(<StatusBar status="conflict" onWrite={onWrite} onTakeVault={onTakeVault} />);

    // Open already, a conflict opening the detail by itself.
    fireEvent.click(screen.getByText("Write my text"));
    expect(onWrite).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("status-detail")).toBeNull();

    fireEvent.click(screen.getByTestId("save-status"));
    fireEvent.click(screen.getByText("Take the vault's"));
    expect(onTakeVault).toHaveBeenCalledOnce();
  });

  it("writes or drops held text by touch, a phone having no :e! either", () => {
    // Held text reopened in its note reads `error`, and a phone needs the way
    // to give it up as well as the way to write it.
    const onWrite = vi.fn();
    const onTakeVault = vi.fn();
    render(<StatusBar status="error" onWrite={onWrite} onTakeVault={onTakeVault} />);

    fireEvent.click(screen.getByTestId("save-status"));
    expect(screen.getByTestId("status-detail")).toHaveTextContent(":e! drops it");
    fireEvent.click(screen.getByText("Write my text"));
    expect(onWrite).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByTestId("save-status"));
    // Named for what goes: there is no other writer whose text it takes.
    expect(screen.queryByText("Take the vault's")).toBeNull();
    fireEvent.click(screen.getByText("Drop my text"));
    expect(onTakeVault).toHaveBeenCalledOnce();
  });
});

describe("the quiet bar on a phone", () => {
  it("draws nothing while there is nothing to act on", () => {
    const { container } = render(<StatusBar quiet status="saved" version="1.0.0" />);

    expect(container.querySelector("footer")).toBeNull();
  });

  it("draws nothing for a save that settles itself", () => {
    const { container } = render(<StatusBar quiet status="saving" />);

    expect(container.querySelector("footer")).toBeNull();
  });

  it.each([
    ["a notice", { notice: "The vault refused it" }],
    ["a failed write", { status: "error" as const }],
    ["a conflict", { status: "conflict" as const }],
    ["a held note", { held: [{ path: "a.md", reason: "refused" }] }],
    ["the archive", { archive: true }],
  ])("comes back for %s, without the clock", (_, props) => {
    const { container } = render(<StatusBar quiet {...props} />);

    expect(container.querySelector("footer")).not.toBeNull();
    expect(container.querySelector("time")).toBeNull();
  });
});
