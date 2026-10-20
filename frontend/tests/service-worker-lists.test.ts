import { registerServiceWorker } from "@/lib/service-worker";

function registration(path: string, unregister: () => Promise<boolean> = async () => true) {
  return {
    active: { scriptURL: `https://kasten.test${path}` },
    waiting: null,
    installing: null,
    unregister: vi.fn(unregister),
  };
}

type Registration = ReturnType<typeof registration>;

function stubWorkers(
  getRegistrations: () => Promise<Registration[]>,
  register = vi.fn(async () => ({})),
) {
  Object.defineProperty(navigator, "serviceWorker", {
    value: { getRegistrations, register },
    configurable: true,
  });
  return register;
}

function stubCaches(names: string[]) {
  const store = new Set(names);
  Object.defineProperty(globalThis, "caches", {
    value: {
      keys: async () => [...store],
      delete: async (name: string) => store.delete(name),
    },
    configurable: true,
  });
  return store;
}

// Mocks resolve at once, so one macrotask lets the whole chain finish.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("dropping the lists app's worker", () => {
  // Each registerServiceWorker() call adds a load listener to window. Listeners
  // from earlier tests would run in this one against its mocks, so they are
  // recorded here and removed in afterEach.
  const loadListeners: EventListenerOrEventListenerObject[] = [];

  beforeEach(() => {
    vi.stubEnv("PROD", true);
    const addEventListener = window.addEventListener.bind(window);
    vi.spyOn(window, "addEventListener").mockImplementation((type, listener, options) => {
      if (type === "load") loadListeners.push(listener);
      addEventListener(type, listener, options);
    });
  });

  afterEach(() => {
    for (const listener of loadListeners.splice(0)) {
      window.removeEventListener("load", listener);
    }
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, "serviceWorker");
    Reflect.deleteProperty(globalThis, "caches");
  });

  function startWorker() {
    registerServiceWorker();
    window.dispatchEvent(new Event("load"));
  }

  it("unregisters the lists app's worker and leaves kasten's own", async () => {
    const lists = registration("/lists-sw.js");
    const kasten = registration("/sw.js");
    stubWorkers(async () => [lists, kasten]);
    stubCaches([]);
    startWorker();
    await flush();
    const unregistered = [lists, kasten]
      .filter((reg) => reg.unregister.mock.calls.length > 0)
      .map((reg) => new URL(reg.active.scriptURL).pathname);
    expect(unregistered).toEqual(["/lists-sw.js"]);
  });

  it("deletes the lists app's caches and keeps kasten's", async () => {
    const names = stubCaches(["lists-shell-2", "lists-shell-1", "kasten-abc"]);
    stubWorkers(async () => []);
    startWorker();
    await flush();
    expect([...names]).toEqual(["kasten-abc"]);
  });

  it("registers kasten's worker even when the cleanup fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const register = stubWorkers(async () => {
      throw new Error("refused");
    });
    stubCaches([]);
    startWorker();
    await flush();
    expect(register).toHaveBeenCalledWith("/sw.js");
  });

  it("registers kasten's worker after the lists worker is unregistered", async () => {
    const order: string[] = [];
    const lists = registration("/lists-sw.js", async () => {
      order.push("unregister");
      return true;
    });
    stubWorkers(
      async () => [lists],
      vi.fn(async () => {
        order.push("register");
        return {};
      }),
    );
    stubCaches([]);
    startWorker();
    await flush();
    expect(order).toEqual(["unregister", "register"]);
  });
});
