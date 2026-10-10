import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { keyBytes, withCtrl } from "@/components/terminal-keys";
import { TerminalPane } from "@/components/terminal-pane";
import { encodeInput } from "@/lib/ttyd";
import { COARSE, stubMatchMedia } from "./match-media";
import { stubCommands } from "./stub-commands";

// xterm draws into a canvas and measures fonts, neither of which jsdom has.
// What the pane does with a socket is the question here, and the only part of
// the terminal that answers it is what got written.
const { written, term } = vi.hoisted(() => ({
  written: [] as unknown[],
  /** What the keyboard under the row would do: type, and switch DECCKM. */
  term: { type: (_data: string) => {}, modes: { applicationCursorKeysMode: false } },
}));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    modes = term.modes;
    open() {}
    attachCustomKeyEventHandler() {}
    loadAddon() {}
    write(data: unknown) {
      written.push(data);
    }
    onData(listener: (data: string) => void) {
      term.type = listener;
      return { dispose() {} };
    }
    // As xterm's own does: input is handed to whoever listens on `onData`.
    input(data: string) {
      term.type(data);
    }
    onResize() {
      return { dispose() {} };
    }
    focus() {}
    dispose() {}
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
  },
}));

/** A socket the test opens and closes by hand. */
class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static last: FakeSocket | null = null;
  readyState = FakeSocket.CONNECTING;
  binaryType = "";
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onmessage: (() => void) | null = null;
  sent: unknown[] = [];
  constructor() {
    FakeSocket.last = this;
  }
  send(data: unknown) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  /** The server answered the upgrade. */
  accept() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
  /** The connection went, from the other end. */
  drop(code: number) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

function socket(): FakeSocket {
  if (FakeSocket.last === null) throw new Error("the pane opened no socket");
  return FakeSocket.last;
}

/** Everything the pane wrote into the terminal, as one string. */
function screenText(): string {
  return written.filter((chunk) => typeof chunk === "string").join("");
}

describe("TerminalPane", () => {
  beforeEach(() => {
    written.length = 0;
    term.modes.applicationCursorKeysMode = false;
    FakeSocket.last = null;
    vi.stubGlobal("WebSocket", FakeSocket);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("says the shell could not be reached when the socket never opens", () => {
    render(<TerminalPane session="notes" commands={stubCommands()} />);

    act(() => socket().drop(1006));

    expect(screenText()).toContain("Could not reach the shell at /term/ws.");
  });

  it("says the shell closed when a socket that was open goes", () => {
    render(<TerminalPane session="notes" commands={stubCommands()} />);

    act(() => socket().accept());
    act(() => socket().drop(1000));

    expect(screenText()).toContain("The shell closed the connection (code 1000).");
    expect(screenText()).not.toContain("Could not reach");
  });

  it("says nothing when the pane closes the socket itself", () => {
    const { unmount } = render(<TerminalPane session="notes" commands={stubCommands()} />);
    const open = socket();
    act(() => open.accept());

    unmount();
    // A browser still fires `close` for a socket the page closed.
    open.onclose?.({ code: 1005 });

    expect(screenText()).toBe("");
  });

  describe("key row", () => {
    /** A phone, with the socket open so a key has somewhere to go. */
    function phone() {
      stubMatchMedia({ [COARSE]: true });
      render(<TerminalPane session="notes" commands={stubCommands()} />);
      act(() => socket().accept());
      // The auth frame is not a key.
      socket().sent.length = 0;
    }

    function tap(name: string) {
      fireEvent.click(screen.getByRole("button", { name }));
    }

    it("is not drawn for a mouse", () => {
      render(<TerminalPane session="notes" commands={stubCommands()} />);

      expect(screen.queryByRole("toolbar")).toBeNull();
    });

    it("sends what the hardware key sends", () => {
      phone();

      for (const name of ["Esc", "Tab", "Left", "Down", "Up", "Right", "|", "/", "-"]) tap(name);

      expect(socket().sent).toEqual(
        ["\x1b", "\t", "\x1b[D", "\x1b[B", "\x1b[A", "\x1b[C", "|", "/", "-"].map(encodeInput),
      );
    });

    it("sends the application arrows once a program has asked for them", () => {
      phone();
      term.modes.applicationCursorKeysMode = true;

      tap("Up");

      expect(socket().sent).toEqual([encodeInput("\x1bOA")]);
    });

    it("holds Ctrl for the next typed key and no longer", () => {
      phone();

      tap("Ctrl");
      expect(screen.getByRole("button", { name: "Ctrl" }).getAttribute("aria-pressed")).toBe(
        "true",
      );
      expect(socket().sent).toEqual([]);

      act(() => term.type("c"));
      act(() => term.type("c"));

      expect(socket().sent).toEqual([encodeInput("\x03"), encodeInput("c")]);
      expect(screen.getByRole("button", { name: "Ctrl" }).getAttribute("aria-pressed")).toBe(
        "false",
      );
    });

    it("spends Ctrl on a key of the row", () => {
      phone();

      tap("Ctrl");
      tap("Left");
      tap("Left");

      expect(socket().sent).toEqual([encodeInput("\x1b[1;5D"), encodeInput("\x1b[D")]);
    });

    it("lets go of Ctrl on a second tap", () => {
      phone();

      tap("Ctrl");
      tap("Ctrl");
      act(() => term.type("c"));

      expect(socket().sent).toEqual([encodeInput("c")]);
    });

    it("keeps the focus where it was when a key is pressed", () => {
      phone();

      // An unhandled press is what moves the focus onto a button.
      expect(fireEvent.mouseDown(screen.getByRole("button", { name: "Esc" }))).toBe(false);
      expect(fireEvent.pointerDown(screen.getByRole("button", { name: "Esc" }))).toBe(false);
    });

    it("pads away what an on-screen keyboard covers, and gives it back", () => {
      const listeners = new Map<string, () => void>();
      const viewport = {
        scale: 1,
        offsetTop: 0,
        height: 800,
        addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
        removeEventListener: (type: string) => listeners.delete(type),
      };
      vi.stubGlobal("visualViewport", viewport);
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
        bottom: 800,
      } as DOMRect);
      phone();
      const frame = screen.getByRole("toolbar").parentElement as HTMLElement;
      expect(frame.style.paddingBottom).toBe("0px");

      viewport.height = 500;
      listeners.get("resize")?.();
      expect(frame.style.paddingBottom).toBe("300px");

      viewport.height = 800;
      listeners.get("resize")?.();
      expect(frame.style.paddingBottom).toBe("0px");
    });
  });
});

describe("keyBytes", () => {
  it("sends the control character a keyboard sends for the punctuation", () => {
    expect(keyBytes("/", true, false)).toBe("\x1f");
    expect(keyBytes("-", true, false)).toBe("\x1f");
    expect(keyBytes("|", true, false)).toBe("\x1c");
  });

  it("sends a Ctrl arrow the same in either cursor mode", () => {
    expect(keyBytes("Right", true, true)).toBe("\x1b[1;5C");
  });
});

describe("withCtrl", () => {
  it("turns a letter of either case into its control character", () => {
    expect(withCtrl("d")).toBe("\x04");
    expect(withCtrl("D")).toBe("\x04");
  });

  it("leaves everything else as it came", () => {
    expect(withCtrl("1")).toBe("1");
    expect(withCtrl("ls")).toBe("ls");
    expect(withCtrl("\x1b[A")).toBe("\x1b[A");
  });
});
