import { loadOnce } from "@/lib/load-once";

it("#647 A3 forgets a failed load and keeps a good one, not asking again", async () => {
  const load = vi
    .fn<() => Promise<string>>()
    .mockRejectedValueOnce(new TypeError("Failed to fetch"))
    .mockResolvedValue("module");
  const once = loadOnce(load);

  await expect.soft(once()).rejects.toThrow("Failed to fetch");
  const results = [await once(), await once()];

  expect({ results, asked: load.mock.calls.length }).toEqual({
    results: ["module", "module"],
    asked: 2,
  });
});
