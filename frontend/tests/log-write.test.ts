import { drinkTarget, logDrinkInVault } from "@/lib/log-write";
import { noteBase } from "@/lib/note-base";
import { periodicNote } from "@/lib/periodic";

// The vault sits behind the api client, not behind the api module's own
// functions: `updateNote` calls `fetchNote` and `saveNote` from inside that
// module, so a mock of those would never be reached by its retry. Here the
// real api code runs, with its refusals, and only the wire is faked.
const vault = vi.hoisted(() => ({
  notes: {} as Record<string, string>,
  /** Runs before a save is checked, so a test can move the note under it. */
  beforePut: undefined as undefined | ((path: string) => Promise<void> | void),
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...real,
    client: {
      GET: async (_url: string, init: { params: { path: { path: string } } }) => {
        const path = init.params.path.path;
        const text = vault.notes[path];
        if (text === undefined) return { data: undefined, response: { status: 404 } };
        return { data: { path, content: text }, response: { status: 200 } };
      },
      POST: async (
        _url: string,
        init: { params: { path: { path: string } }; body: { content: string } },
      ) => {
        const path = init.params.path.path;
        if (vault.notes[path] !== undefined) return { data: undefined, response: { status: 409 } };
        vault.notes[path] = init.body.content;
        return { data: { path }, response: { status: 201 } };
      },
      PUT: async (
        _url: string,
        init: { params: { path: { path: string } }; body: { content: string; base?: string } },
      ) => {
        const path = init.params.path.path;
        await vault.beforePut?.(path);
        const { base } = init.body;
        if (base !== undefined && base !== noteBase(vault.notes[path] ?? "")) {
          return { data: undefined, response: { status: 409 } };
        }
        vault.notes[path] = init.body.content;
        return { data: { path }, response: { status: 200 } };
      },
    },
  };
});

const { path: daily, body } = periodicNote("daily", new Date(2026, 9, 20, 9, 0));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 20, 9, 0));
  vault.notes = {};
  vault.beforePut = undefined;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a drink logged into the vault", () => {
  it("writes the default line under an existing ## Log", async () => {
    vault.notes[daily] = "## Log\n- ☕ 1\n\n## Done\n";

    await logDrinkInVault("water", [daily]);

    expect(vault.notes[daily]).toBe("## Log\n- ☕ 1\n- 💧 250 ml\n\n## Done\n");
  });

  it("makes ## Log at the end when the note has none", async () => {
    vault.notes[daily] = "## TODOs\n- [ ] x\n";

    await logDrinkInVault("alcohol", [daily]);

    expect(vault.notes[daily]).toBe("## TODOs\n- [ ] x\n\n## Log\n- 🍺 1\n");
  });

  it("creates today's note with the template and ## Log when the listing lacks it", async () => {
    await logDrinkInVault("water", []);

    expect(vault.notes[daily]).toBe(`${body.replace(/\n+$/, "")}\n\n## Log\n- 💧 250 ml\n`);
  });

  it("updates the note that is there when the create finds it already made", async () => {
    vault.notes[daily] = "## TODOs\n- [ ] x\n\n## Log\n- ☕ 1\n";

    await logDrinkInVault("water", []);

    expect(vault.notes[daily]).toBe("## TODOs\n- [ ] x\n\n## Log\n- ☕ 1\n- 💧 250 ml\n");
  });

  it("reads the note again after a changed-on-disk refusal and lands", async () => {
    vault.notes[daily] = "## Log\n- ☕ 1\n";
    // Somebody else adds a line between the read and the save, once.
    vault.beforePut = (path) => {
      vault.beforePut = undefined;
      vault.notes[path] = "## Log\n- ☕ 1\n- 🍺 1\n";
    };

    await logDrinkInVault("water", [daily]);

    expect(vault.notes[daily]).toBe("## Log\n- ☕ 1\n- 🍺 1\n- 💧 250 ml\n");
  });

  it("lands two quick taps in order even when the first save answers late", async () => {
    vault.notes[daily] = "## TODOs\n";
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Only the first save waits, so the second would land first if it were
    // not queued behind it.
    vault.beforePut = async () => {
      vault.beforePut = undefined;
      await gate;
    };

    const first = logDrinkInVault("water", [daily]);
    const second = logDrinkInVault("coffee", [daily]);
    release();
    await Promise.all([first, second]);

    expect(vault.notes[daily]).toBe("## TODOs\n\n## Log\n- 💧 250 ml\n- ☕ 1\n");
  });

  it("rejects a failed write, and the next tap still lands", async () => {
    vault.notes[daily] = "## TODOs\n";
    vault.beforePut = () => {
      vault.beforePut = undefined;
      throw new Error("the vault is down");
    };

    await expect(logDrinkInVault("water", [daily])).rejects.toThrow("the vault is down");
    await logDrinkInVault("coffee", [daily]);

    expect(vault.notes[daily]).toBe("## TODOs\n\n## Log\n- ☕ 1\n");
  });
});

it("the palette logs nothing while today's note is being saved", () => {
  expect(
    drinkTarget({ today: daily, focusedPath: "other.md", held: false, writing: true }),
  ).toEqual({ why: `${daily} is still being saved` });
});

it("a queued drink writes nothing when today's note became unsaved while it waited", async () => {
  vault.notes[daily] = "## TODOs\n";
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  // Only the first save waits, so the second tap sits in the queue behind it.
  vault.beforePut = async () => {
    vault.beforePut = undefined;
    await gate;
  };
  let unsaved = false;
  const stillOk = () => (unsaved ? { why: `${daily} holds text not yet saved` } : null);

  const first = logDrinkInVault("water", [daily]);
  const second = logDrinkInVault("coffee", [daily], stillOk);
  const refused = expect(second).rejects.toThrow(
    `Nothing logged: ${daily} holds text not yet saved`,
  );
  // The note becomes unsaved after the second tap was queued, before its turn.
  unsaved = true;
  release();
  await first;
  await refused;

  expect(vault.notes[daily]).toBe("## TODOs\n\n## Log\n- 💧 250 ml\n");
});
