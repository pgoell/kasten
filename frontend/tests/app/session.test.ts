import { checkSession } from "@/lib/app/session";

/** The probe that sends a page whose session the gate dropped to sign in, and leaves the rest. */
describe("checkSession", () => {
  let reload: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function answering(answer: () => Response) {
    const sent = vi.fn(async () => answer());
    vi.stubGlobal("fetch", sent);
    return sent;
  }

  it("reloads on the gate's redirect", async () => {
    answering(() => Object.defineProperty(new Response(null), "type", { value: "opaqueredirect" }));
    await checkSession();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("reloads on a 401, which basic auth answers", async () => {
    answering(() => new Response(null, { status: 401 }));
    await checkSession();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("stays when signed in", async () => {
    answering(() => new Response("{}", { status: 200 }));
    await checkSession();
    expect(reload).not.toHaveBeenCalled();
  });

  it("stays when offline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await checkSession();
    expect(reload).not.toHaveBeenCalled();
  });

  it("sends one probe for many failures at once", async () => {
    const sent = answering(() => new Response("{}", { status: 200 }));
    await Promise.all([checkSession(), checkSession(), checkSession()]);
    expect(sent).toHaveBeenCalledOnce();
  });
});
