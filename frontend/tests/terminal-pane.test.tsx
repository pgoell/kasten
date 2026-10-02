import { act, cleanup, render } from "@testing-library/react";
import { TerminalPane } from "@/components/terminal-pane";
import { stubCommands } from "./stub-commands";

// xterm draws into a canvas and measures fonts, neither of which jsdom has.
// What the pane does with a socket is the question here, and the only part of
// the terminal that answers it is what got written.
const { written } = vi.hoisted(() => ({ written: [] as unknown[] }));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    open() {}
    attachCustomKeyEventHandler() {}
    loadAddon() {}
    write(data: unknown) {
      written.push(data);
    }
    onData() {
      return { dispose() {} };
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
});
