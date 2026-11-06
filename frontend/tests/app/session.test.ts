import { checkSession, startSessionCheck } from "@/lib/app/session";

/** The probe that sends a page whose session the gate dropped to sign in, and leaves the rest. */
describe("checkSession", () => {
  let replace: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    replace = vi.fn();
    vi.stubGlobal("location", { href: "https://kasten.test/notes?q=x", replace });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function answering(answer: () => Response) {
    const sent = vi.fn(async () => answer());
    vi.stubGlobal("fetch", sent);
    return sent;
  }

  it("reloads on the gate's redirect, marked so the worker waits for the gate", async () => {
    answering(() => Object.defineProperty(new Response(null), "type", { value: "opaqueredirect" }));
    await checkSession();
    expect(replace).toHaveBeenCalledWith("https://kasten.test/notes?q=x&signin=1");
  });

  it("reloads on a 401, which basic auth answers", async () => {
    answering(() => new Response(null, { status: 401 }));
    await checkSession();
    expect(replace).toHaveBeenCalledOnce();
  });

  it("stays when signed in", async () => {
    answering(() => new Response("{}", { status: 200 }));
    await checkSession();
    expect(replace).not.toHaveBeenCalled();
  });

  it("stays when offline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await checkSession();
    expect(replace).not.toHaveBeenCalled();
  });

  it("sends one probe for many failures at once", async () => {
    const sent = answering(() => new Response("{}", { status: 200 }));
    await Promise.all([checkSession(), checkSession(), checkSession()]);
    expect(sent).toHaveBeenCalledOnce();
  });
});

describe("startSessionCheck", () => {
  it("drops the sign-in mark from the address and keeps the rest", () => {
    history.replaceState(null, "", "/notes?q=x&signin=1");
    startSessionCheck();
    expect(window.location.pathname + window.location.search).toBe("/notes?q=x");
  });
});
