import { fireEvent, render, screen } from "@testing-library/react";
import { KeyHelp } from "@/components/key-help";
import { FORMAT, LEADER, TREE } from "@/lib/key-bindings";

describe("KeyHelp", () => {
  it("lists every leader key and what it does", () => {
    render(<KeyHelp onClose={() => {}} />);

    for (const { key, label } of LEADER) {
      expect(screen.getByText(`Space ${key}`)).toBeInTheDocument();
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("lists every formatting key", () => {
    render(<KeyHelp onClose={() => {}} />);

    for (const { label } of FORMAT) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("lists every tree key", () => {
    render(<KeyHelp onClose={() => {}} />);

    for (const { label } of TREE) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("closes on escape", () => {
    const onClose = vi.fn();
    render(<KeyHelp onClose={onClose} />);

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on q, the key that closes things everywhere else", () => {
    const onClose = vi.fn();
    render(<KeyHelp onClose={onClose} />);

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "q" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("the key tables", () => {
  it("names a command for every leader key that the editor can run", () => {
    // The panel and the docs both read these tables. A leader entry naming a
    // command nothing provides would show a key that does nothing.
    const commands = new Set(["toggleTree", "togglePreview", "closeNote", "showHelp"]);

    for (const { command } of LEADER) {
      expect(commands).toContain(command);
    }
  });

  it("spells every formatting key the way vim spells keys", () => {
    for (const { key } of FORMAT) {
      expect(key).toMatch(/^<[CS-]*-?[a-zA-Z]>$/);
    }
  });
});
