import { waitFor } from "@testing-library/react";
import { Editor } from "@/components/editor";
import { loadKatex } from "@/lib/math";
import { finishParsing, renderStarved } from "./parsing";

// Spied, so a test can wait on the load the formula asked for.
vi.mock("@/lib/math", { spy: true });

/** Whether the next fetch of KaTeX fails, the way a chunk does while offline. */
const network = vi.hoisted(() => ({ down: false }));

// A factory that throws is not cached, so the next import runs it again: the
// shape of a chunk fetch that failed once and may succeed when asked again.
vi.mock("katex", async (importOriginal) => {
  if (network.down) throw new TypeError("Failed to fetch dynamically imported module");
  return importOriginal();
});

/** The source of every formula KaTeX drew, which it writes into the MathML it hides. */
function drawn(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".cm-math .katex-mathml annotation")].map(
    (node) => node.textContent ?? "",
  );
}

/**
 * Wait for the last load asked for to fail, rather than for a time.
 *
 * Only a parsed formula asks for KaTeX, so a parse that never reached `$x$`
 * fails here by name rather than as a `.rejects` on `undefined` (#666).
 */
async function failed(): Promise<void> {
  expect(loadKatex).toHaveBeenCalled();
  await expect(vi.mocked(loadKatex).mock.results.at(-1)?.value).rejects.toThrow();
}

beforeEach(() => {
  localStorage.setItem("kasten.vim", "on");
  vi.mocked(loadKatex).mockClear();
});
afterEach(() => {
  network.down = false;
  localStorage.clear();
});

// In this order: a load that succeeds is kept for the rest of the file, so the
// test that needs every load to fail runs before the one that ends in a draw.
describe("a failed KaTeX load", () => {
  it("#637 I5 leaves the formula as its source and logs no unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const listen = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", listen);
    try {
      network.down = true;
      // Starve the first parse and then finish it, so the formula is reached
      // however busy the machine is (#666).
      const { container } = renderStarved(<Editor initialDoc={"intro\n\narea $x$"} />);
      finishParsing(container);
      await failed();
      // Node reports a rejection nobody handled once the microtasks drain.
      await new Promise((done) => setTimeout(done, 0));

      expect(container.querySelector(".cm-math")?.textContent).toBe("x");
      expect(drawn(container)).toEqual([]);
      expect(unhandled).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", listen);
    }
  });

  it("#637 A8 the next formula tries the load again and draws, with no reload", async () => {
    network.down = true;
    // As in I5: the formula must be parsed before it asks for KaTeX (#666).
    const first = renderStarved(<Editor initialDoc={"intro\n\narea $x$"} />);
    finishParsing(first.container);
    await failed();
    expect(drawn(first.container)).toEqual([]);
    first.unmount();

    network.down = false;
    // The second formula too, or only the idle parse 500 ms later reaches it,
    // racing the wait below (#666).
    const { container } = renderStarved(<Editor initialDoc={"intro\n\narea $y$"} />);
    finishParsing(container);

    await waitFor(() => expect(drawn(container)).toEqual(["y"]));
  });
});
