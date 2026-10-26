import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ReviewParked } from "@/components/review-parked";
import * as api from "@/lib/api";

/** A write the vault holds until the test lets it land or fails it. */
interface Held {
  path: string;
  content: string;
  land: () => void;
  fail: (error: Error) => void;
}

/** The waits between the tries of a write the backend drops, as `use-sitting-writes` has them. */
const WAITS = [1000, 2000, 4000, 8000, 15000, 15000, 15000];

const SR = "<!--SR:!2026-08-20,4,270-->";
const A = `#flashcards/aws\n\nQ A?::answer A !suspended ${SR}\n`;
const B = `#flashcards/aws\n\nQ B?::answer B !suspended ${SR}\n`;
const B_AND_B2 = `${B}\nQ B2?::answer B2 !suspended ${SR}\n`;
const C = `#flashcards/aws\n\nQ C?::answer C !suspended ${SR}\n`;
const TWO = `#flashcards/aws\n\nQ A1?::answer A1 !suspended ${SR}\n\nQ A2?::answer A2 !suspended ${SR}\n`;

let vault: Record<string, string>;
let hits: { path: string; line: number; text: string }[];
let writes: Held[];
let readGate: Promise<void> | null;
let refused: boolean;

/** The scan's lines for a note, the way the search answers them. */
function hitsOf(path: string, text: string) {
  return text.split("\n").map((line, i) => ({ path, line: i + 1, text: line }));
}

/** The vault holds `notes`, the scan lists their lines, and writes wait in `writes`. */
function setup(notes: Record<string, string>) {
  vault = { ...notes };
  hits = Object.entries(notes).flatMap(([path, text]) => hitsOf(path, text));
  writes = [];
  readGate = null;
  refused = false;
  vi.spyOn(api, "fetchCards").mockImplementation(async () => hits);
  vi.spyOn(api, "fetchNote").mockImplementation(async (path: string) => {
    // The text is taken when the read is sent, so a read held open answers with what the vault held then.
    const text = vault[path] ?? "";
    if (path === "a.md" && refused) throw new Error("GET /api/files/a.md failed");
    if (path === "a.md" && readGate !== null) await readGate;
    return text;
  });
  vi.spyOn(api, "saveNote").mockImplementation(
    (path: string, content: string) =>
      new Promise<api.Note>((land, fail) => {
        writes.push({
          path,
          content,
          land: () => {
            vault[path] = content;
            land({ path, content });
          },
          fail,
        });
      }),
  );
}

function renderParked() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <ReviewParked onLeave={vi.fn()} onOpen={vi.fn()} />
    </QueryClientProvider>,
  );
  return { ...view, client };
}

/** Let the fake clock run on, so the screen's queries and a write's retry move. */
async function pass(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** The oldest write to `path` the vault still holds, which leaves the list. */
function takeWrite(path: string): Held {
  const write = writes.find((held) => held.path === path);
  if (write === undefined) throw new Error(`no write to ${path} is held`);
  writes.splice(writes.indexOf(write), 1);
  return write;
}

/** The error `saveNote` throws for a 502. */
function badGateway(path: string) {
  return new Error(`PUT /api/files/${path} failed with 502`, { cause: 502 });
}

function putBack(container: HTMLElement, row: string) {
  fireEvent.click(container.querySelector(`button[data-unpark="${row}"]`) as HTMLButtonElement);
}

function rowOf(container: HTMLElement, row: string) {
  return container.querySelector(`button[data-parked="${row}"]`);
}

describe("ReviewParked keeps a put-back while another write to the note is out (#1142)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("#1142 A3 a put-back retrying in one note stays put back when another note's put-back lands and the notes are read again", async () => {
    setup({ "a.md": A, "b.md": B });
    const { container } = renderParked();
    await pass();

    putBack(container, "a.md:0");
    takeWrite("a.md").fail(badGateway("a.md"));
    await pass();

    // B's write lands, and its landing reads the notes again. The scan still lists A
    // as parked, because A's write has not landed.
    putBack(container, "b.md:0");
    hits = hitsOf("a.md", A);
    takeWrite("b.md").land();
    await pass();

    expect(rowOf(container, "a.md:0")).toBeNull();

    await pass(1000);
    takeWrite("a.md").land();
    await pass();
    expect(rowOf(container, "a.md:0")).toBeNull();
  });

  it("#1142 I5 a read that left while a put-back was out and answers after it landed keeps the row put back", async () => {
    setup({ "a.md": A, "b.md": B });
    const { container, client } = renderParked();
    await pass();

    // The read of A is held open, so it answers after A's write has landed.
    let release: () => void = () => {};
    readGate = new Promise<void>((open) => {
      release = open;
    });

    putBack(container, "a.md:0");
    takeWrite("a.md").fail(badGateway("a.md"));
    await pass();

    // A card parked in C changes the scan, so the notes are read again.
    vault["c.md"] = C;
    hits = [...hits, ...hitsOf("c.md", C)];
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["cards"] });
    });
    await pass();

    await pass(1000);
    takeWrite("a.md").land();
    await pass();

    release();
    await pass();

    expect(screen.getByText("Q C?")).toBeInTheDocument();
    expect(rowOf(container, "a.md:0")).toBeNull();
  });

  it("#1142 B1 a put-back that fails at last while its re-read fails too shows the vault's text from a read that left before", async () => {
    setup({ "a.md": A, "b.md": B });
    const { container, client } = renderParked();
    await pass();

    putBack(container, "a.md:0");
    // A card parked in C changes the scan, so the notes are read again while A's write is out.
    // That read is held open.
    let release: () => void = () => {};
    readGate = new Promise<void>((open) => {
      release = open;
    });
    vault["c.md"] = C;
    hits = [...hits, ...hitsOf("c.md", C)];
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["cards"] });
    });
    await pass();

    // A's write is refused, and the re-read that follows it fails too.
    refused = true;
    takeWrite("a.md").fail(new api.ChangedOnDisk());
    await pass();

    // The held read answers with A's text from the vault, which still has it parked.
    release();
    await pass();

    expect(screen.getByText("Q C?")).toBeInTheDocument();
    expect(rowOf(container, "a.md:0")).not.toBeNull();
  });

  it("#1142 I6 a put-back that fails at last reads its note again and shows the row parked with the error", async () => {
    setup({ "a.md": A, "b.md": B });
    const { container } = renderParked();
    await pass();

    putBack(container, "a.md:0");
    for (const wait of WAITS) {
      takeWrite("a.md").fail(badGateway("a.md"));
      await pass(wait);
    }
    takeWrite("a.md").fail(badGateway("a.md"));
    await pass();

    expect(screen.getByRole("alert")).toHaveTextContent("PUT /api/files/a.md failed with 502");
    expect(rowOf(container, "a.md:0")).not.toBeNull();
  });

  it("#1142 I7 a note with no put-back out takes the read's text, so a card parked elsewhere shows up", async () => {
    setup({ "a.md": A, "b.md": B });
    const { container, client } = renderParked();
    await pass();

    putBack(container, "a.md:0");
    takeWrite("a.md").fail(badGateway("a.md"));
    await pass();

    // A second card is parked in B, and the scan picks it up while A's write is out.
    vault["b.md"] = B_AND_B2;
    hits = [...hitsOf("a.md", A), ...hitsOf("b.md", B_AND_B2)];
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["cards"] });
    });
    await pass();

    expect(screen.getByText("Q B2?")).toBeInTheDocument();
  });

  it("#1142 I8 two put-backs in one note with a read between them both stay gone and land in order", async () => {
    setup({ "a.md": TWO });
    const { container, client } = renderParked();
    await pass();

    putBack(container, "a.md:0");
    // A card parked in C changes the scan, so the notes are read again while A's first write is out.
    vault["c.md"] = C;
    hits = [...hits, ...hitsOf("c.md", C)];
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["cards"] });
    });
    await pass();

    expect(rowOf(container, "a.md:0")).toBeNull();
    expect(rowOf(container, "a.md:1")).not.toBeNull();

    putBack(container, "a.md:1");
    expect(rowOf(container, "a.md:1")).toBeNull();
    // The second put-back waits behind the first, so only one write to A has left.
    expect(writes.filter((held) => held.path === "a.md")).toHaveLength(1);

    takeWrite("a.md").land();
    await pass();

    const second = takeWrite("a.md");
    expect(second.content).not.toContain("!suspended");
    second.land();
    await pass();

    expect(rowOf(container, "a.md:0")).toBeNull();
    expect(rowOf(container, "a.md:1")).toBeNull();
  });
});
