import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Suspense } from "react";
import type { Mock } from "vitest";
import type { components } from "@/lib/api-types";
import { BUILD, versionText } from "@/lib/app/build";
import { client } from "@/lib/core/api-client";
import { Route } from "@/routes/settings";

type PushOut = components["schemas"]["PushOut"];
type PushHours = components["schemas"]["PushHours-Output"];
type PushSubscriptionOptionsInit = { userVisibleOnly: boolean; applicationServerKey: Uint8Array };

const DEVICES: PushOut["devices"] = [
  {
    id: 1,
    name: "Android Chrome",
    endpoint: "https://push.test/a",
    created: "2026-11-01T08:00:00Z",
  },
  {
    id: 2,
    name: "Linux Firefox",
    endpoint: "https://push.test/b",
    created: "2026-11-02T08:00:00Z",
  },
];

const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";

/** A subscription as the browser hands it over, with the keys a device is saved with. */
function subscriptionAt(endpoint: string) {
  return {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: "p256", auth: "auth-secret" } }),
    unsubscribe: vi.fn(async () => true),
  };
}

/** What this browser has: its permission answer, its current subscription and the subscribe call. */
let permission: NotificationPermission;
let current: ReturnType<typeof subscriptionAt> | null;
let subscribe: Mock<(options: PushSubscriptionOptionsInit) => Promise<unknown>>;
/** The backend's list, which a POST and a DELETE change as the real one does. */
let state: PushOut;
/** The backend's stored times, which a PUT replaces. */
let hours: PushHours;

/** The page's two reads, and the POST and DELETE it sends, answered by the fake backend. */
function serve(push: PushOut) {
  state = push;
  hours = { morning: null, quiet_start: null, quiet_end: null };
  const get = vi.fn(async (path: string) => ({
    data:
      path === "/api/version"
        ? { backend: "0.8.0" }
        : path === "/api/push/settings"
          ? hours
          : state,
    response: new Response(null, { status: 200 }),
  }));
  const post = vi.fn(async (_path: string, init: { body: { endpoint: string; name: string } }) => {
    const device = {
      id: 3,
      name: init.body.name,
      endpoint: init.body.endpoint,
      created: "2026-11-08T09:00:00Z",
    };
    state = { ...state, devices: [...state.devices, device] };
    return { data: device, response: new Response(null, { status: 201 }) };
  });
  const del = vi.fn(async () => ({
    data: undefined,
    response: new Response(null, { status: 204 }),
  }));
  vi.spyOn(client, "GET").mockImplementation(get as unknown as typeof client.GET);
  vi.spyOn(client, "POST").mockImplementation(post as unknown as typeof client.POST);
  vi.spyOn(client, "DELETE").mockImplementation(del as unknown as typeof client.DELETE);
  return { post, del };
}

async function renderPage() {
  const Page = Route.options.component;
  if (Page === undefined) throw new Error("the settings route has no component");
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // The route's component is code-split, so its first render suspends on an import.
  await act(async () => {
    render(
      <QueryClientProvider client={queries}>
        <Suspense fallback={null}>
          <Page />
        </Suspense>
      </QueryClientProvider>,
    );
  });
  await screen.findByRole("heading", { name: "Reminders on this device" });
}

/** The list row a device is in, found by its name. */
function rowOf(name: string): HTMLElement {
  const row = screen.getByText(name).closest("li");
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

beforeEach(() => {
  permission = "granted";
  current = null;
  subscribe = vi.fn(async () => (current = subscriptionAt("https://push.test/new")));
  const registration = {
    pushManager: { subscribe, getSubscription: vi.fn(async () => current) },
  };
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      ready: Promise.resolve(registration),
      getRegistration: vi.fn(async () => registration),
    },
  });
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal("Notification", { requestPermission: vi.fn(async () => permission) });
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ANDROID);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

describe("the settings page's reminders", () => {
  it("says push is not set up, and disables the subscribe button, when the server has no key", async () => {
    serve({ public_key: null, devices: [] });
    await renderPage();

    expect(await screen.findByText("Push is not set up on this server.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send reminders to this device" })).toBeDisabled();
  });

  it("asks for permission, subscribes with the decoded key and posts the subscription with a name", async () => {
    const { post } = serve({ public_key: "-_8", devices: [] });
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Send reminders to this device" }));

    expect(await screen.findByText("This device gets reminders")).toBeInTheDocument();
    expect(Notification.requestPermission).toHaveBeenCalled();
    const options = subscribe.mock.calls[0]?.[0];
    expect(options?.userVisibleOnly).toBe(true);
    expect(Array.from(options?.applicationServerKey ?? [])).toEqual([251, 255]);
    expect(post).toHaveBeenCalledWith("/api/push/devices", {
      body: {
        endpoint: "https://push.test/new",
        keys: { p256dh: "p256", auth: "auth-secret" },
        name: "Android Chrome",
      },
    });
  });

  it("shows the refusal in an alert when permission is denied, and posts nothing", async () => {
    permission = "denied";
    const { post } = serve({ public_key: "-_8", devices: [] });
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Send reminders to this device" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Notifications are blocked in this browser",
    );
    expect(post).not.toHaveBeenCalled();
  });

  it("lists each device with a Remove, and Remove deletes that device by its id", async () => {
    const { del } = serve({ public_key: "-_8", devices: DEVICES });
    await renderPage();

    expect(await screen.findByText("Linux Firefox")).toBeInTheDocument();
    expect(screen.getByText("Android Chrome")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(2);

    fireEvent.click(within(rowOf("Linux Firefox")).getByRole("button", { name: "Remove" }));

    await vi.waitFor(() => expect(del).toHaveBeenCalled());
    expect(del).toHaveBeenCalledWith("/api/push/devices/{device_id}", {
      params: { path: { device_id: 2 } },
    });
  });

  it("removing the device this browser is on also unsubscribes the browser", async () => {
    const { del } = serve({ public_key: "-_8", devices: DEVICES });
    current = subscriptionAt("https://push.test/b");
    await renderPage();

    expect(await screen.findByText("this device")).toBeInTheDocument();
    fireEvent.click(within(rowOf("Linux Firefox")).getByRole("button", { name: "Remove" }));

    await vi.waitFor(() => expect(current?.unsubscribe).toHaveBeenCalled());
    expect(del).toHaveBeenCalledWith("/api/push/devices/{device_id}", {
      params: { path: { device_id: 2 } },
    });
  });
});

describe("the settings page's push times", () => {
  /** The PUT the page sends, answered as the backend does, or refused with `refusal`. */
  function serveHours(stored: PushHours, refusal?: string) {
    serve({ public_key: "-_8", devices: [] });
    hours = stored;
    const put = vi.fn(async (_path: string, init: { body: PushHours }) => {
      if (refusal !== undefined) {
        const detail = [{ msg: `Value error, ${refusal}` }];
        return { error: { detail }, response: new Response(null, { status: 422 }) };
      }
      hours = init.body;
      return { data: hours, response: new Response(null, { status: 200 }) };
    });
    vi.spyOn(client, "PUT").mockImplementation(put as unknown as typeof client.PUT);
    return put;
  }

  it("shows the stored morning time and quiet hours after a reload", async () => {
    serveHours({ morning: "07:30", quiet_start: "22:00", quiet_end: "07:00", goals: "20:00" });
    await renderPage();

    expect(await screen.findByLabelText("Morning push time")).toHaveValue("07:30");
    expect(screen.getByLabelText("Quiet hours start")).toHaveValue("22:00");
    expect(screen.getByLabelText("Quiet hours end")).toHaveValue("07:00");
    expect(screen.getByLabelText("Log goals push time")).toHaveValue("20:00");
  });

  it("saves the times, sending an emptied one as null for off", async () => {
    const put = serveHours({
      morning: "07:30",
      quiet_start: null,
      quiet_end: null,
      goals: "20:00",
    });
    await renderPage();

    fireEvent.change(await screen.findByLabelText("Morning push time"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Quiet hours start"), { target: { value: "22:00" } });
    fireEvent.change(screen.getByLabelText("Quiet hours end"), { target: { value: "07:00" } });
    fireEvent.change(screen.getByLabelText("Log goals push time"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save times" }));

    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(put).toHaveBeenCalledWith("/api/push/settings", {
      body: { morning: null, quiet_start: "22:00", quiet_end: "07:00", goals: null },
    });
  });

  it("says why when the server refuses the times", async () => {
    serveHours(
      { morning: null, quiet_start: null, quiet_end: null },
      "quiet hours need a start and an end",
    );
    await renderPage();

    fireEvent.change(await screen.findByLabelText("Quiet hours start"), {
      target: { value: "22:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save times" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "quiet hours need a start and an end",
    );
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("keeps each time and the save button a touch target", async () => {
    serveHours({ morning: null, quiet_start: null, quiet_end: null });
    await renderPage();

    const controls = [
      await screen.findByLabelText("Morning push time"),
      screen.getByLabelText("Quiet hours start"),
      screen.getByLabelText("Quiet hours end"),
      screen.getByRole("button", { name: "Save times" }),
    ];
    for (const control of controls) expect(control.className).toContain("min-h-11");
  });
});

describe("the settings page's version", () => {
  it("names the code the page runs", async () => {
    serve({ public_key: "-_8", devices: [] });
    await renderPage();

    expect(await screen.findByTestId("version")).toHaveTextContent(
      `Version ${versionText("0.8.0", BUILD)}`,
    );
  });
});
