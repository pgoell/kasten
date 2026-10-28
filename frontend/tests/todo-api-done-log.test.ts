import { ChangedOnDisk, NoteExists, NoteMissing } from "@/lib/api";
import { noteBase } from "@/lib/note-base";
import { periodicNote } from "@/lib/periodic";
import { cycleTodoAside } from "@/lib/todo/todo-api";
import { todoApiHooks } from "./todo-api-fixture";

// Standing in for the module rather than for `fetch`, the way the pane's tests
// do: what this half owns is which notes it reads and what it sends back.
const { createNote, fetchNote, fetchTodos, saveNote, searchNotes, updateNote } = vi.hoisted(() => ({
  createNote: vi.fn(),
  fetchNote: vi.fn(),
  fetchTodos: vi.fn(),
  saveNote: vi.fn(),
  searchNotes: vi.fn(),
  updateNote: vi.fn(),
}));
vi.mock("@/lib/api", async (importOriginal) => {
  // The refusals the writes tell apart by class, which a factory leaving them
  // out would hand over as undefined.
  const real = await importOriginal<typeof import("@/lib/api")>();
  return {
    ChangedOnDisk: real.ChangedOnDisk,
    NoteExists: real.NoteExists,
    NoteMissing: real.NoteMissing,
    createNote,
    fetchNote,
    fetchTodos,
    saveNote,
    searchNotes,
    updateNote,
  };
});

todoApiHooks();

// The code stamps today's date at the write, after the test has read it. A run
// that crosses local midnight would see another day and the two would disagree
// (#1315), so the clock is pinned for every test and restored after it.
const NOW = new Date(2026, 7, 10, 12);

beforeEach(() => {
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("#538 two presses in flight on the ## Done log", () => {
  const daily = periodicNote("daily", NOW).path;
  const PATH = "projects/kasten.md";
  const DOC = "- [/] a 🆔 kt-aaaaaa\n- [/] b 🆔 kt-bbbbbb";
  const INTO_A = {
    before: "- [/] a 🆔 kt-aaaaaa",
    after: "- [x] a ✅ 2026-10-18 🆔 kt-aaaaaa",
    line: 1,
    doc: DOC,
  };
  const INTO_B = {
    before: "- [/] b 🆔 kt-bbbbbb",
    after: "- [x] b ✅ 2026-10-18 🆔 kt-bbbbbb",
    line: 2,
    doc: "- [x] a ✅ 2026-10-18 🆔 kt-aaaaaa\n- [/] b 🆔 kt-bbbbbb",
  };
  const LOG_A = "- ✅ 2026-10-18 a [[projects/kasten]] kt-aaaaaa";
  const LOG_B = "- ✅ 2026-10-18 b [[projects/kasten]] kt-bbbbbb";

  /** The vault's notes, which the fakes below read and write the way the backend does. */
  let notes: Record<string, string>;

  /** What the index answers for `id` at the moment it is asked. */
  const hits = (id: string) =>
    Object.entries(notes).flatMap(([path, text]) =>
      text
        .split("\n")
        .flatMap((line, index) =>
          line.includes(id) ? [{ path, line: index + 1, text: line }] : [],
        ),
    );

  /** Every log line a note holds, in order. */
  const logLines = (path: string) =>
    (notes[path] ?? "").split("\n").filter((line) => line.startsWith("- ✅"));

  beforeEach(() => {
    notes = { [PATH]: DOC, [daily]: "## Done\n" };
    fetchNote.mockImplementation(async (path: string) => {
      const text = notes[path];
      if (text === undefined) throw new NoteMissing(path);
      return text;
    });
    // The backend's check: a base the disk has moved past is a 409.
    saveNote.mockImplementation(
      async (path: string, text: string, _keepalive: boolean, base?: string) => {
        if (base !== undefined && base !== noteBase(notes[path] ?? "")) throw new ChangedOnDisk();
        notes[path] = text;
      },
    );
    createNote.mockImplementation(async (path: string, text: string) => {
      if (notes[path] !== undefined) throw new NoteExists(path);
      notes[path] = text;
    });
    searchNotes.mockImplementation(async (id: string) => hits(id));
    // The real three tries, since the refusal and the read after it are what
    // is under test here.
    updateNote.mockImplementation(async (path: string, change: (text: string) => string | null) => {
      for (let tries = 1; ; tries++) {
        const text: string = await fetchNote(path);
        const next = change(text);
        if (next === null) return null;
        try {
          return await saveNote(path, next, false, noteBase(text));
        } catch (error) {
          if (!(error instanceof ChangedOnDisk) || tries === 3) throw error;
        }
      }
    });
  });

  it("#538 A1 two <leader>x into done in flight on one note both log, a then b", async () => {
    const pressed = await Promise.allSettled([
      cycleTodoAside(PATH, INTO_A, "2026-10-18", [PATH, daily]),
      cycleTodoAside(PATH, INTO_B, "2026-10-18", [PATH, daily]),
    ]);

    expect(logLines(daily)).toEqual([LOG_A, LOG_B]);
    expect(pressed.map((press) => press.status)).toEqual(["fulfilled", "fulfilled"]);
  });

  it("#538 A2 a log write refused three times still says why", async () => {
    saveNote.mockRejectedValue(new ChangedOnDisk());

    await expect(cycleTodoAside(PATH, INTO_A, "2026-10-18", [PATH, daily])).rejects.toBeInstanceOf(
      ChangedOnDisk,
    );
    expect(saveNote).toHaveBeenCalledTimes(3);
  });

  it("#538 I1 a quick reopen after done drops the line the first press logged", async () => {
    // The index answers the reopen from before the first press landed, as one
    // a write behind does, and the answer arrives after that press is done.
    let first: Promise<void> = Promise.resolve();
    searchNotes.mockImplementationOnce(async (id: string) => hits(id));
    searchNotes.mockImplementationOnce(async (id: string) => {
      const found = hits(id);
      await first;
      return found;
    });

    first = cycleTodoAside(PATH, INTO_A, "2026-10-18", [PATH, daily]);
    const reopen = cycleTodoAside(
      PATH,
      {
        before: "- [x] a ✅ 2026-10-18 🆔 kt-aaaaaa",
        after: "- [ ] a 🆔 kt-aaaaaa",
        line: 1,
        doc: INTO_B.doc,
      },
      "2026-10-18",
      [PATH, daily],
    );
    const pressed = await Promise.allSettled([first, reopen]);

    expect(logLines(daily)).toEqual([]);
    expect(pressed.map((press) => press.status)).toEqual(["fulfilled", "fulfilled"]);
  });

  it("#538 I2 a stray log line in another note is dropped on the newer text", async () => {
    const OLD = "projects/old.md";
    notes[OLD] = [
      "## Done",
      "- ✅ 2026-10-17 a [[projects/kasten]] kt-aaaaaa",
      "- ✅ 2026-10-17 b [[projects/kasten]] kt-bbbbbb",
      "",
    ].join("\n");
    const done = "- [x] a ✅ 2026-10-17 🆔 kt-aaaaaa\n- [x] b ✅ 2026-10-17 🆔 kt-bbbbbb";
    notes[PATH] = done;

    const pressed = await Promise.allSettled([
      cycleTodoAside(
        PATH,
        {
          before: "- [x] a ✅ 2026-10-17 🆔 kt-aaaaaa",
          after: "- [ ] a 🆔 kt-aaaaaa",
          line: 1,
          doc: done,
        },
        "2026-10-18",
        [PATH, daily, OLD],
      ),
      cycleTodoAside(
        PATH,
        {
          before: "- [x] b ✅ 2026-10-17 🆔 kt-bbbbbb",
          after: "- [ ] b 🆔 kt-bbbbbb",
          line: 2,
          doc: "- [ ] a 🆔 kt-aaaaaa\n- [x] b ✅ 2026-10-17 🆔 kt-bbbbbb",
        },
        "2026-10-18",
        [PATH, daily, OLD],
      ),
    ]);

    expect(notes[OLD]).toBe("## Done\n");
    expect(pressed.map((press) => press.status)).toEqual(["fulfilled", "fulfilled"]);
  });

  it("#538 I3 two presses on the first log of the day both log", async () => {
    delete notes[daily];

    const pressed = await Promise.allSettled([
      cycleTodoAside(PATH, INTO_A, "2026-10-18", [PATH]),
      cycleTodoAside(PATH, INTO_B, "2026-10-18", [PATH]),
    ]);

    expect(logLines(daily)).toEqual([LOG_A, LOG_B]);
    expect(pressed.map((press) => press.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(createNote).toHaveBeenCalledTimes(2);
  });

  /** A press taking a back out of done, a moment after it went in. */
  const REOPEN_A = {
    before: "- [x] a ✅ 2026-10-18 🆔 kt-aaaaaa",
    after: "- [ ] a 🆔 kt-aaaaaa",
    line: 1,
    doc: "- [ ] a 🆔 kt-aaaaaa\n- [/] b 🆔 kt-bbbbbb",
  };

  it("#538 I1 a quick reopen whose read comes before the first save still drops the line", async () => {
    const pressed = await Promise.allSettled([
      cycleTodoAside(PATH, INTO_A, "2026-10-18", [PATH, daily]),
      cycleTodoAside(PATH, REOPEN_A, "2026-10-18", [PATH, daily]),
    ]);

    expect(logLines(daily)).toEqual([]);
    expect(pressed.map((press) => press.status)).toEqual(["fulfilled", "fulfilled"]);
  });

  it("#538 A1 two presses into done land a then b when the second's reads answer first", async () => {
    // Press a's search answers last, after every answer press b asks for.
    let answer = () => {};
    const late = new Promise<void>((resolve) => {
      answer = resolve;
    });
    searchNotes.mockImplementationOnce(async (id: string) => {
      await late;
      return hits(id);
    });

    const pressed = Promise.allSettled([
      cycleTodoAside(PATH, INTO_A, "2026-10-18", [PATH, daily]),
      cycleTodoAside(PATH, INTO_B, "2026-10-18", [PATH, daily]),
    ]);
    // A macrotask, so every answer already in hand lands before a's does.
    await new Promise((resolve) => setTimeout(resolve, 0));
    answer();

    expect((await pressed).map((press) => press.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(logLines(daily)).toEqual([LOG_A, LOG_B]);
  });

  it("#538 B1 a reopen before the listing names today's note drops its line", async () => {
    // The press that made today's note is a moment old: neither the listing
    // nor the index has caught up with it, the disk has.
    notes[daily] = `## Done\n${LOG_A}\n`;
    searchNotes.mockResolvedValue([]);

    await cycleTodoAside(PATH, REOPEN_A, "2026-10-18", [PATH]);

    expect(logLines(daily)).toEqual([]);
  });

  it("#538 B2 a press that never answers holds the next one back only so long", async () => {
    vi.useFakeTimers({ now: NOW });
    try {
      // Press a's guard asks the vault, which never answers.
      fetchTodos.mockReturnValueOnce(new Promise(() => {}));

      void cycleTodoAside(PATH, INTO_A, "2026-10-18", [PATH, daily]);
      const b = cycleTodoAside(PATH, INTO_B, "2026-10-18", [PATH, daily]);
      // The ten seconds `cycleTodoAside` waits on the press before.
      await vi.advanceTimersByTimeAsync(10_000);

      expect(logLines(daily)).toEqual([LOG_B]);
      await expect(b).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("#538 B1 a reopen with no note today writes nothing and says nothing", async () => {
    delete notes[daily];

    await expect(cycleTodoAside(PATH, REOPEN_A, "2026-10-18", [PATH])).resolves.toBeUndefined();

    expect(saveNote).not.toHaveBeenCalled();
    expect(createNote).not.toHaveBeenCalled();
    expect(notes[daily]).toBeUndefined();
  });
});
