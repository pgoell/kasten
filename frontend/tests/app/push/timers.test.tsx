import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import {
  durationLabel,
  keepRecent,
  parseDuration,
  RECENT_KEY,
  readRecent,
  remaining,
  type Timer,
} from "@/lib/app/push/timers";
import { TimersPane } from "@/lib/app/push/timers-pane";
import { TimersRow } from "@/lib/app/push/timers-row";
import { client } from "@/lib/core/api-client";
import { stubCommands } from "../../stub-commands";

const NOW = new Date("2026-11-12T08:00:00Z");

describe("a typed duration", () => {
  it.each([
    ["90", 5400],
    ["1:25", 5100],
    ["1h 25m", 5100],
    ["1h25m", 5100],
    ["45 min", 2700],
    ["2 hours", 7200],
    ["30s", 30],
    [" 10 M ", 600],
  ])("reads %j as %i seconds", (typed, seconds) => {
    expect(parseDuration(typed)).toBe(seconds);
  });

  it.each(["", "0", "soon", "1h later", "1:75", "-5", "0m"])("refuses %j", (typed) => {
    expect(parseDuration(typed)).toBeNull();
  });

  it("names a duration by its units and counts down as a clock", () => {
    expect(durationLabel(5100)).toBe("1h 25m");
    expect(durationLabel(2700)).toBe("45m");
    expect(remaining("2026-11-12T09:25:00Z", NOW)).toBe("1:25:00");
    expect(remaining("2026-11-12T08:42:13Z", NOW)).toBe("42:13");
    expect(remaining("2026-11-12T07:00:00Z", NOW)).toBe("0:00");
  });
});

describe("the recent timers", () => {
  beforeEach(() => localStorage.clear());

  it("keeps the last four, newest first and each once", () => {
    for (const label of ["A", "B", "C", "D", "E"]) keepRecent({ label, seconds: 60 });
    keepRecent({ label: "C", seconds: 60 });
    expect(readRecent().map((recent) => recent.label)).toEqual(["C", "E", "D", "B"]);
  });

  it("reads nothing from a broken or blocked store", () => {
    localStorage.setItem(RECENT_KEY, "{not json");
    expect(readRecent()).toEqual([]);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(readRecent()).toEqual([]);
  });
});

describe("the Today page's timers", () => {
  let timers: Timer[];

  function serve() {
    const get = vi.fn(async () => ({
      data: timers,
      response: new Response(null, { status: 200 }),
    }));
    const post = vi.fn(async (_path: string, init: { body: { label: string; due: string } }) => {
      const timer = { id: 9, every: null, until: null, created: NOW.toISOString(), ...init.body };
      timers = [...timers, timer];
      return { data: timer, response: new Response(null, { status: 201 }) };
    });
    const del = vi.fn(async () => {
      timers = [];
      return { data: undefined, response: new Response(null, { status: 204 }) };
    });
    vi.spyOn(client, "GET").mockImplementation(get as unknown as typeof client.GET);
    vi.spyOn(client, "POST").mockImplementation(post as unknown as typeof client.POST);
    vi.spyOn(client, "DELETE").mockImplementation(del as unknown as typeof client.DELETE);
    return { post, del };
  }

  async function renderRow() {
    const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      render(
        <QueryClientProvider client={queries}>
          <TimersRow />
        </QueryClientProvider>,
      );
    });
  }

  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    timers = [
      {
        id: 4,
        label: "Washer",
        due: "2026-11-12T08:42:13Z",
        every: null,
        until: null,
        created: NOW.toISOString(),
      },
      {
        id: 5,
        label: "Drink water",
        due: "2026-11-12T09:30:00Z",
        every: 5400,
        until: null,
        created: NOW.toISOString(),
      },
    ];
  });

  afterEach(() => vi.useRealTimers());

  it("lists each timer with the time left, and a repeat with its step", async () => {
    serve();
    await renderRow();
    const [washer, water] = await screen.findAllByRole("listitem");
    expect(washer).toHaveTextContent("Washer");
    expect(washer).toHaveTextContent("42:13");
    expect(water).toHaveTextContent("every 1h 30m");
  });

  it("starts a timer from the form, then offers it again as a chip", async () => {
    const { post } = serve();
    await renderRow();
    fireEvent.change(screen.getByLabelText("Timer name"), { target: { value: "Dryer" } });
    fireEvent.change(screen.getByLabelText("Duration"), { target: { value: "1h 5m" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start" }));
    });
    expect(post).toHaveBeenCalledWith("/api/push/timers", {
      body: { label: "Dryer", due: "2026-11-12T09:05:00.000Z" },
    });
    expect(await screen.findByRole("button", { name: "Dryer · 1h 5m" })).toBeInTheDocument();
    expect(screen.getByLabelText("Duration")).toHaveValue("");
  });

  it("says what to type for a time it cannot read, and sends nothing", async () => {
    const { post } = serve();
    await renderRow();
    fireEvent.change(screen.getByLabelText("Duration"), { target: { value: "soon" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("1h 25m");
    expect(post).not.toHaveBeenCalled();
  });

  it("stops a timer", async () => {
    const { del } = serve();
    await renderRow();
    const washer = (await screen.findAllByRole("listitem"))[0] as HTMLElement;
    await act(async () => {
      fireEvent.click(within(washer).getByRole("button", { name: "Stop" }));
    });
    expect(del).toHaveBeenCalledWith("/api/push/timers/{timer_id}", {
      params: { path: { timer_id: 4 } },
    });
  });
});

describe("the timers tab", () => {
  it("takes the focus, sends i to the name field and Escape back", async () => {
    vi.spyOn(client, "GET").mockResolvedValue({
      data: [],
      response: new Response(null, { status: 200 }),
    } as never);
    const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      render(
        <QueryClientProvider client={queries}>
          <TimersPane commands={stubCommands()} focusSignal={1} />
        </QueryClientProvider>,
      );
    });
    const pane = screen.getByRole("region", { name: "timers pane" });
    expect(pane).toHaveFocus();
    fireEvent.keyDown(pane, { key: "i" });
    expect(screen.getByLabelText("Timer name")).toHaveFocus();
    fireEvent.keyDown(screen.getByLabelText("Timer name"), { key: "Escape" });
    expect(pane).toHaveFocus();
  });
});
