import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { dropText, holdText, resetHeld } from "@/lib/held-text";
import { dayNote } from "@/lib/log-edit";
import { noteBase } from "@/lib/note-base";
import { useLogActions } from "@/lib/use-log-actions";
import { useNoteWrites } from "@/lib/use-note-writes";

// The same wire-level fake as log-write.test.ts: the real api code runs, and only
// the client's calls are answered from an in-memory vault.
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
        return { data: { path, content: init.body.content }, response: { status: 201 } };
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
        return { data: { path, content: init.body.content }, response: { status: 200 } };
      },
    },
  };
});

const DAY = "2026-10-18";
const { path, body } = dayNote(DAY);

type Focus = { path: string | undefined; isWriting: (note: string) => boolean };
type Queue = ReturnType<typeof useNoteWrites>;

/** The hook under test, its listing, its focus and its notice, with a query client to read back. */
function mount({
  data,
  write,
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
}: {
  data: string[];
  write: Queue;
  client?: QueryClient;
}) {
  const focusedNote: { current: Focus } = { current: { path: undefined, isWriting: () => false } };
  const setNotice = vi.fn();
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  const { result } = renderHook(() => useLogActions({ data, write, focusedNote, setNotice }), {
    wrapper,
  });
  return { result, focusedNote, setNotice, client };
}

/** A queue of `path`'s writes, from one `useNoteWrites` that outlives the hook under test. */
function queue(): Queue {
  return renderHook(() => useNoteWrites()).result.current;
}

beforeEach(() => {
  vault.notes = {};
  vault.beforePut = undefined;
  localStorage.clear();
  resetHeld();
});

it("#624 addLine on a past day with no note creates it from the daily template with the line under ## Log", async () => {
  const { result } = mount({ data: [], write: queue() });

  await act(async () => {
    await result.current.addLine(DAY, "- 🍺 1");
  });

  expect(vault.notes[path]).toBe(`${body.replace(/\n+$/, "")}\n\n## Log\n- 🍺 1\n`);
});

it("#624 addLine on a past day finds the note made meanwhile and writes into it", async () => {
  vault.notes[path] = "## TODOs\n- [ ] x\n\n## Log\n- ☕ 1\n";
  // The listing has not caught up with the note another tab made.
  const { result } = mount({ data: [], write: queue() });

  await act(async () => {
    await result.current.addLine(DAY, "- 💧 250 ml");
  });

  expect(vault.notes[path]).toBe("## TODOs\n- [ ] x\n\n## Log\n- ☕ 1\n- 💧 250 ml\n");
});

it("#624 editLine reads again after Changed on disk and lands", async () => {
  vault.notes[path] = "## Log\n- 💧 250 ml\n";
  // Somebody else adds a section below the line once, so the first save is refused.
  vault.beforePut = (note) => {
    vault.beforePut = undefined;
    vault.notes[note] = "## Log\n- 💧 250 ml\n\n## Done\n- [ ] x\n";
  };
  const { result } = mount({ data: [path], write: queue() });

  let landed = false;
  await act(async () => {
    landed = await result.current.editLine(DAY, { line: 2, text: "- 💧 250 ml" }, "- 💧 500 ml");
  });

  expect(landed).toBe(true);
  expect(vault.notes[path]).toBe("## Log\n- 💧 500 ml\n\n## Done\n- [ ] x\n");
});

it("#624 a log write is refused while the note holds unsaved text, is open to type in or is being saved", async () => {
  const write = queue();
  vault.notes[path] = "## Log\n- ☕ 1\n";
  const { result, focusedNote, setNotice } = mount({ data: [path], write });

  // Unsaved text held for the note: refused at the press.
  holdText(path, { content: "typed", reason: "refused", conflicted: false });
  expect(await result.current.addLine(DAY, "- 🍺 1")).toBe(false);
  expect(setNotice).toHaveBeenLastCalledWith(`Nothing logged: ${path} holds text not yet saved`);
  dropText(path);

  // Open to type in at the press: refused too.
  focusedNote.current = { path, isWriting: () => false };
  expect(await result.current.addLine(DAY, "- 🍺 1")).toBe(false);
  expect(setNotice).toHaveBeenLastCalledWith(`Nothing logged: ${path} is open to type in`);
  focusedNote.current = { path: undefined, isWriting: () => false };

  // Each made while the write waits behind a save of the note: refused inside the write.
  const waitBehindSave = async (during: () => void): Promise<boolean> => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    void write(path, () => gate);
    const pending = result.current.addLine(DAY, "- 🍺 1");
    during();
    release();
    return pending;
  };

  expect(
    await waitBehindSave(() => {
      focusedNote.current = { path, isWriting: () => false };
    }),
  ).toBe(false);
  expect(setNotice).toHaveBeenLastCalledWith(`Nothing logged: ${path} is open to type in`);
  focusedNote.current = { path: undefined, isWriting: () => false };

  expect(
    await waitBehindSave(() => {
      focusedNote.current = { path: undefined, isWriting: (note) => note === path };
    }),
  ).toBe(false);
  expect(setNotice).toHaveBeenLastCalledWith(`Nothing logged: ${path} is still being saved`);

  expect(vault.notes[path]).toBe("## Log\n- ☕ 1\n");
});

it("#624 undoDelete puts the deleted line back where it was and refuses when the note changed there", async () => {
  vault.notes[path] = "## Log\n- ☕ 1\n- 🍺 1\n- 💧 250 ml\n";
  const { result, setNotice } = mount({ data: [path], write: queue() });

  await act(async () => {
    await result.current.deleteLine(DAY, { line: 3, text: "- 🍺 1" });
  });
  expect(vault.notes[path]).toBe("## Log\n- ☕ 1\n- 💧 250 ml\n");
  expect(result.current.canUndo).toBe(true);

  // The line above the deleted one has changed, so the line has no place to go back to.
  vault.notes[path] = "## Log\n- ☕ 2\n- 💧 250 ml\n";
  let undone = true;
  await act(async () => {
    undone = await result.current.undoDelete();
  });
  expect(undone).toBe(false);
  expect(setNotice).toHaveBeenLastCalledWith(
    "Nothing logged: the note has changed where the line was",
  );
  expect(vault.notes[path]).toBe("## Log\n- ☕ 2\n- 💧 250 ml\n");
  expect(result.current.canUndo).toBe(true);

  vault.notes[path] = "## Log\n- ☕ 1\n- 💧 250 ml\n";
  await act(async () => {
    undone = await result.current.undoDelete();
  });
  expect(undone).toBe(true);
  expect(vault.notes[path]).toBe("## Log\n- ☕ 1\n- 🍺 1\n- 💧 250 ml\n");
  expect(result.current.canUndo).toBe(false);
});

it("#624 a log write puts the written text in the note's query and asks the log again", async () => {
  vault.notes[path] = "## Log\n- ☕ 1\n";
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const { result } = mount({ data: [path], write: queue(), client });

  await act(async () => {
    await result.current.addLine(DAY, "- 🍺 1");
  });

  expect(client.getQueryData(["note", path])).toBe("## Log\n- ☕ 1\n- 🍺 1\n");
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["log"] });
});
