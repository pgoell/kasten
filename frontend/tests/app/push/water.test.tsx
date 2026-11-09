import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Timer } from "@/lib/app/push/timers";
import { TimersRow } from "@/lib/app/push/timers-row";
import { readPlan, stopTime, WATER_KEY, WATER_LABEL } from "@/lib/app/push/water";
import { client } from "@/lib/core/api-client";

// Local times, so the tests hold in any zone the runner has.
const NOW = new Date(2026, 10, 12, 7, 0);

describe("the water plan", () => {
  beforeEach(() => localStorage.clear());

  it("stops today at the time given, and not at one already past", () => {
    expect(stopTime("21:00", NOW)).toEqual(new Date(2026, 10, 12, 21, 0));
    expect(stopTime("06:30", NOW)).toBeNull();
  });

  it("starts from 90 minutes until 21:00, and from the plan kept here after", () => {
    expect(readPlan()).toEqual({ every: 5400, until: "21:00" });
    localStorage.setItem(WATER_KEY, JSON.stringify({ every: 3600, until: "22:30" }));
    expect(readPlan()).toEqual({ every: 3600, until: "22:30" });
    localStorage.setItem(WATER_KEY, "{not json");
    expect(readPlan()).toEqual({ every: 5400, until: "21:00" });
  });
});

describe("the water switch", () => {
  let timers: Timer[];

  function serve() {
    vi.spyOn(client, "GET").mockImplementation((async () => ({
      data: timers,
      response: new Response(null, { status: 200 }),
    })) as unknown as typeof client.GET);
    const post = vi.fn(async (_path: string, init: { body: Partial<Timer> }) => {
      const timer = { id: 7, created: NOW.toISOString(), ...init.body } as Timer;
      timers = [...timers, timer];
      return { data: timer, response: new Response(null, { status: 201 }) };
    });
    vi.spyOn(client, "POST").mockImplementation(post as unknown as typeof client.POST);
    return post;
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

  const press = () =>
    act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remind me to drink water" }));
    });

  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    timers = [];
  });

  afterEach(() => vi.useRealTimers());

  it("rings a glass now and every gap until the stop time, then keeps the plan", async () => {
    const post = serve();
    await renderRow();
    fireEvent.change(screen.getByLabelText("Gap between glasses"), { target: { value: "1h" } });
    fireEvent.change(screen.getByLabelText("Stop time"), { target: { value: "22:00" } });
    await press();
    expect(post).toHaveBeenCalledWith("/api/push/timers", {
      body: {
        label: WATER_LABEL,
        due: NOW.toISOString(),
        every: 3600,
        until: new Date(2026, 10, 12, 22, 0).toISOString(),
      },
    });
    expect(readPlan()).toEqual({ every: 3600, until: "22:00" });
    expect(await screen.findByRole("listitem")).toHaveTextContent(WATER_LABEL);
    expect(screen.queryByRole("button", { name: "Remind me to drink water" })).toBeNull();
  });

  it("refuses a stop time already past, and sends nothing", async () => {
    const post = serve();
    await renderRow();
    fireEvent.change(screen.getByLabelText("Stop time"), { target: { value: "06:00" } });
    await press();
    expect(screen.getByRole("alert")).toHaveTextContent("later today");
    expect(post).not.toHaveBeenCalled();
  });
});
