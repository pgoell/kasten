import { fireEvent, screen } from "@testing-library/react";
import { press, renderTree, tree } from "./file-explorer-fixture";
import { COARSE, NARROW, stubMatchMedia } from "./match-media";

describe("FileExplorer in a narrow window", () => {
  beforeEach(() => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
  });

  afterEach(() => vi.unstubAllGlobals());

  // jsdom applies no media query, so this reads the class that carries one.
  it("makes its rows and its buttons 44px under a finger", () => {
    renderTree();

    const rows = document.querySelectorAll("[data-row]");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row).toHaveClass("pointer-coarse:min-h-11");
    // 16px of icon inside 14px of padding.
    expect(screen.getByRole("button", { name: "New note" })).toHaveClass("pointer-coarse:p-3.5");
    for (const toggle of screen.getAllByRole("button", { name: "Hide file tree" })) {
      expect(toggle).toHaveClass("pointer-coarse:p-3.5");
    }
  });

  it("is a drawer with no grip, at a width of its own", () => {
    renderTree();

    expect(screen.queryByRole("separator")).toBeNull();
    const drawer = screen.getByRole("navigation", { name: "Vault" }).closest("aside");
    expect(drawer).toHaveClass("fixed");
    expect(drawer?.style.width).toBe("");
  });

  it("closes on a tap outside it", () => {
    renderTree();

    fireEvent.click(screen.getByRole("button", { name: "Close file tree" }));

    expect(screen.queryByRole("navigation", { name: "Vault" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close file tree" })).toBeNull();
    // No rail on a phone: the route's toolbar is the way back in.
    expect(screen.queryByRole("button", { name: "Show file tree" })).toBeNull();
  });

  it("keeps the rail in a narrow window under a mouse, which has no toolbar", () => {
    stubMatchMedia({ [NARROW]: true });
    renderTree();

    fireEvent.click(screen.getByRole("button", { name: "Close file tree" }));

    expect(screen.getByRole("button", { name: "Show file tree" })).toBeInTheDocument();
  });

  it("leaves a row's tap to the route, which closes the drawer once the pane has the focus", () => {
    const onOpenFile = vi.fn();
    const onOpenChange = vi.fn();
    renderTree({ onOpenFile, onOpenChange });

    fireEvent.click(screen.getByTitle("index.md"));

    expect(onOpenFile).toHaveBeenCalledWith("index.md");
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("asks the route to take the focus on Escape, rather than finding an editor itself", () => {
    // The first editor in the document, which is where a wide window sends
    // the focus, and which may be in a pane a narrow one is not drawing.
    const editor = document.createElement("div");
    editor.className = "cm-content";
    editor.tabIndex = 0;
    document.body.append(editor);
    const onLeave = vi.fn();
    renderTree({ onLeave });

    tree().focus();
    press("Escape");

    expect(onLeave).toHaveBeenCalledOnce();
    expect(editor).not.toHaveFocus();
    editor.remove();
  });

  it("takes the rail under the drawer out of reach", () => {
    stubMatchMedia({ [NARROW]: true });
    renderTree();

    expect(
      screen.getAllByRole("button", { name: "Hide file tree" })[0]?.parentElement,
    ).toHaveAttribute("inert");
  });
});
