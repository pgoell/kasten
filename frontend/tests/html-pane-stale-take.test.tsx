import "fake-indexeddb/auto";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HtmlPane } from "@/components/html-pane";
import { reset } from "@/lib/outbox";
import {
  answering,
  answeringLate,
  drained,
  dropped,
  dumpsSent,
  fromPage,
  PATH,
  renderPane,
  selection,
  settled,
  takeButton,
  yFromPage,
} from "./html-pane-fixture";
import { stubMatchMedia } from "./match-media";
import { stubCommands } from "./stub-commands";

const { fetchNote, saveNote, updateNote, searchNotes } = vi.hoisted(() => ({
  fetchNote: vi.fn(),
  saveNote: vi.fn(),
  updateNote: vi.fn(),
  searchNotes: vi.fn(),
}));
vi.mock("@/lib/api", () => {
  // A class of its own, as the real one is, so `instanceof` in the pane answers the same.
  class ChangedOnDisk extends Error {}
  return { fetchNote, saveNote, updateNote, searchNotes, ChangedOnDisk };
});

/**
 * Holds each take's keep until the test lets it go, and makes it fail where the test
 * says so, so a take can be left in flight while the pane moves on.
 */
const { gate } = vi.hoisted(() => ({
  gate: { hold: null as Promise<void> | null, refuse: null as Error | null },
}));
vi.mock("@/lib/outbox", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/outbox")>();
  return {
    ...real,
    keep: async (text: string, date: string) => {
      if (gate.hold !== null) await gate.hold;
      if (gate.refuse !== null) throw gate.refuse;
      return real.keep(text, date);
    },
  };
});

beforeEach(async () => {
  localStorage.clear();
  stubMatchMedia({});
  gate.hold = null;
  gate.refuse = null;
  await reset();
  await dropped();
  fetchNote.mockResolvedValue("");
  saveNote.mockImplementation(async (path: string, content: string) => ({ path, content }));
  searchNotes.mockResolvedValue([]);
  updateNote.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  // Puts back the measured sizes the tests spy on, which `resetAllMocks` keeps.
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("a take out of an html page that moved on before it landed", () => {
  it("a take whose send lands after the pane got a new page shows no toast and no Undo over it", async () => {
    const { sent, land } = answeringLate();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <HtmlPane path={PATH} commands={stubCommands()} onFocus={() => {}} />
      </QueryClientProvider>,
    );
    const frame = view.container.querySelector("iframe") as HTMLIFrameElement;

    frame.focus();
    fromPage(frame.contentWindow, selection());
    yFromPage(frame);
    await settled(() => dumpsSent(sent).length > 0);

    view.rerender(
      <QueryClientProvider client={client}>
        <HtmlPane path="31 Research/other.html" commands={stubCommands()} onFocus={() => {}} />
      </QueryClientProvider>,
    );
    land();
    await drained();

    expect({
      sent: dumpsSent(sent).length,
      toast: screen.queryByRole("status") !== null,
      undo: screen.queryByRole("button", { name: "Undo" }) !== null,
    }).toEqual({ sent: 1, toast: false, undo: false });
  });

  it("a selection made after y is still held when the take is kept", async () => {
    let release = () => {};
    gate.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sent = answering();
    const { frame } = renderPane();

    frame.focus();
    fromPage(frame.contentWindow, selection());
    yFromPage(frame);
    fromPage(frame.contentWindow, selection({ text: "A later passage." }));
    release();

    await settled(() => dumpsSent(sent).length > 0);
    await screen.findByRole("status");
    expect(takeButton()).not.toBeNull();
  });

  it("a take the device did not keep, after the pane moved on, puts no passage back on hold", async () => {
    let release = () => {};
    gate.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    gate.refuse = new Error("No room on this device");
    answering();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <HtmlPane path={PATH} commands={stubCommands()} onFocus={() => {}} />
      </QueryClientProvider>,
    );
    const frame = view.container.querySelector("iframe") as HTMLIFrameElement;

    frame.focus();
    fromPage(frame.contentWindow, selection());
    yFromPage(frame);
    view.rerender(
      <QueryClientProvider client={client}>
        <HtmlPane path="31 Research/other.html" commands={stubCommands()} onFocus={() => {}} />
      </QueryClientProvider>,
    );
    release();
    await drained();

    expect({
      message: screen.queryByText("No room on this device") !== null,
      button: takeButton() !== null,
    }).toEqual({ message: true, button: false });
  });

  it("a take kept after the pane moved on posts no take mark to the page", async () => {
    let release = () => {};
    gate.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sent = answering();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <HtmlPane path={PATH} commands={stubCommands()} onFocus={() => {}} />
      </QueryClientProvider>,
    );
    const frame = view.container.querySelector("iframe") as HTMLIFrameElement;

    frame.focus();
    fromPage(frame.contentWindow, selection());
    yFromPage(frame);
    view.rerender(
      <QueryClientProvider client={client}>
        <HtmlPane path="31 Research/other.html" commands={stubCommands()} onFocus={() => {}} />
      </QueryClientProvider>,
    );
    // Spied on once the pane shows the new page, the window the take would post to.
    const posted = vi
      .spyOn(frame.contentWindow as Window, "postMessage")
      .mockImplementation(() => {});
    release();
    await settled(() => dumpsSent(sent).length > 0);
    await drained();

    expect({
      sent: dumpsSent(sent).length,
      takes: posted.mock.calls
        .map(([message]) => message)
        .filter((message) => {
          return (message as { kasten?: unknown }).kasten === "take";
        }),
    }).toEqual({ sent: 1, takes: [] });
  });

  it("Put it in a note links a page whose path holds brackets with the brackets escaped", async () => {
    answering();
    // A note in another folder, so the link is written relative to it.
    searchNotes.mockResolvedValue([
      { path: "y/n.md", line: 1, text: "modified: 2026-10-20T10:00" },
    ]);
    updateNote.mockResolvedValue({ path: "y/n.md", content: "" });
    const { frame } = renderPane("x/a]]b.html");

    frame.focus();
    fromPage(frame.contentWindow, selection({ heading: "H", anchor: "s1" }));
    yFromPage(frame);
    fireEvent.click(await screen.findByRole("button", { name: "Put it in a note" }));
    fireEvent.click(await screen.findByRole("button", { name: "n" }));

    await screen.findByText("Put into n");
    const change = updateNote.mock.calls[0]?.[1] as (text: string) => string;
    expect(change("# n\n")).toContain("[H](../x/a%5D%5Db.html#s1)");
  });
});
