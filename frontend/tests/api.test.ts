import { fetchBook } from "@/lib/api";

describe("fetchBook", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks for the book at the path, percent encoded", async () => {
    const bytes = new Blob(["book"]);
    const fetching = vi.fn().mockResolvedValue({ ok: true, blob: async () => bytes });
    vi.stubGlobal("fetch", fetching);

    await fetchBook("20 Literature/DDIA.epub");

    expect(fetching).toHaveBeenCalledWith("/api/assets/20%20Literature%2FDDIA.epub");
  });

  it("says what the vault answered when it refused", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    await expect(fetchBook("gone.epub")).rejects.toThrow("404");
  });

  it("hands back the bytes when the vault has them", async () => {
    const bytes = new Blob(["book"]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => bytes }));

    await expect(fetchBook("there.epub")).resolves.toBe(bytes);
  });
});
