import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { KeyHelp } from "@/components/key-help";
import { WhichKey } from "@/components/which-key";
import { beginLeader, paneOpener } from "@/lib/ui/keys/which-key";
import { stubCommands } from "./keybindings-fixture";
import { COARSE, NARROW, stubMatchMedia } from "./match-media";

const REDUCED = "(prefers-reduced-motion: reduce)";

/**
 * A phone: a narrow window with a coarse pointer. Reduced motion as well, so the
 * sheet's fade is the only motion and no frame has to run for a close to land.
 */
function phone() {
  stubMatchMedia({ [NARROW]: true, [COARSE]: true, [REDUCED]: true });
}

describe("phone sheets", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("#793 A8 the desktop which-key panel sets its groups in columns", () => {
    render(
      <>
        <button type="button">Note</button>
        <WhichKey />
      </>,
    );
    const note = screen.getByRole("button", { name: "Note" });
    note.focus();
    act(() => {
      beginLeader(paneOpener(stubCommands()));
    });

    const find = screen.getByRole("heading", { name: "Find" }).closest("section")?.parentElement;
    expect(find).toHaveClass("grid-cols-[repeat(auto-fit,minmax(10.5rem,1fr))]");
    expect(find).not.toHaveClass("grid-cols-1");

    // An open group flows its rows into columns as wide as the pane allows.
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "g" });
    const goTo = screen.getByRole("heading", { name: "Go to" }).closest("section")?.parentElement;
    expect(goTo).toHaveClass("columns-[13rem]");
  });

  it("#793 A9 on a phone key help opens in the sheet with a grabber, the filter focused", () => {
    phone();
    render(<KeyHelp onClose={() => {}} />);

    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    expect(dialog.querySelector("[data-sheet-drag]")).not.toBeNull();
    // Full height, up to the top safe area, and not the desktop's 88vh cap.
    expect(dialog.className).toContain("env(safe-area-inset-top)");
    expect(dialog.className).not.toContain("88dvh");
    expect(screen.getByRole("searchbox", { name: "Filter keys" })).toHaveFocus();

    const columns = screen.getByRole("heading", { name: "After Space", level: 2 }).parentElement
      ?.parentElement;
    expect(columns).toHaveClass("grid-cols-1");
    // A finger's word for the close, pinned under the list.
    expect(screen.getByText("Drag down or tap outside to close")).toBeInTheDocument();
  });

  it("#793 R4 on a phone when the parent takes key help down, the focus goes back to the opener", () => {
    phone();
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();

    try {
      const { unmount } = render(<KeyHelp onClose={() => {}} />);
      expect(screen.getByRole("searchbox", { name: "Filter keys" })).toHaveFocus();

      unmount();

      expect(opener).toHaveFocus();
    } finally {
      opener.remove();
    }
  });

  it("#793 I4 Esc closes the key help sheet and gives the focus back", async () => {
    phone();
    const onClose = vi.fn();
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();

    try {
      render(<KeyHelp onClose={onClose} />);
      fireEvent.keyDown(screen.getByRole("searchbox", { name: "Filter keys" }), { key: "Escape" });
      // The sheet's fade ends on its opacity transitionend, which jsdom does not send.
      fireEvent.transitionEnd(screen.getByRole("dialog", { name: "Keyboard shortcuts" }), {
        propertyName: "opacity",
      });

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(opener).toHaveFocus();
    } finally {
      opener.remove();
    }
  });
});
