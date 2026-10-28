import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient } from "@tanstack/react-query";
import type { Note } from "@/lib/api";
import { heldTexts, resetHeld } from "@/lib/held-text";
import * as queueModule from "@/lib/note/save-queue";
import { type Asked, SaveQueue, Skipped } from "@/lib/note/save-queue";

const { saveNote, fetchNote } = vi.hoisted(() => ({ saveNote: vi.fn(), fetchNote: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => ({
  saveNote,
  fetchNote,
  ChangedOnDisk: (await importOriginal<typeof import("@/lib/api")>()).ChangedOnDisk,
}));

/** A save the test answers by hand. */
function deferred() {
  let land!: (note: Note) => void;
  const promise = new Promise<Note>((resolve) => {
    land = resolve;
  });
  return { promise, land: (content: string) => land({ content } as Note) };
}

function asked(over: Partial<Asked> = {}): Asked {
  return {
    to: "a.md",
    content: "T1",
    keepalive: false,
    leaving: false,
    restoring: false,
    wasConflicted: false,
    base: "B",
    sent: 0,
    carried: null,
    ...over,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let queue: SaveQueue;
let client: QueryClient;

beforeEach(() => {
  queue = new SaveQueue();
  client = new QueryClient();
  resetHeld();
  saveNote.mockReset();
  fetchNote.mockReset();
  saveNote.mockImplementation((_to: string, content: string) => Promise.resolve({ content }));
});

describe("save queue", () => {
  it("no module outside save-queue reaches the queue's maps", () => {
    // The module hands out the object, its class and its refusal, no holder.
    expect(Object.keys(queueModule).sort()).toEqual(["SaveQueue", "Skipped", "saveQueue"]);
    const allowed = new Set(["saveQueue", "Skipped"]);
    const src = join(__dirname, "../src");
    const files = readdirSync(src, { recursive: true, encoding: "utf8" }).filter(
      (file) => /\.tsx?$/.test(file) && !file.endsWith("save-queue.ts"),
    );
    const imports = /import\s*\{([^}]*)\}\s*from\s*"(?:@\/lib\/note\/|\.\/)save-queue"/g;
    const reached = files.flatMap((file) =>
      [...readFileSync(join(src, file), "utf8").matchAll(imports)]
        .flatMap((match) => (match[1] ?? "").split(",").map((name) => name.trim()))
        .filter((name) => name !== "" && !name.startsWith("type ") && !allowed.has(name))
        .map((name) => `${file}: ${name}`),
    );
    expect(reached).toEqual([]);
    const whole = files.filter((file) =>
      /import\s*\*\s*as\s*\w+\s*from\s*"[^"]*save-queue"/.test(
        readFileSync(join(src, file), "utf8"),
      ),
    );
    expect(whole).toEqual([]);
  });

  it("enqueue stamps the write record and hands it on whole", async () => {
    queue.open();
    queue.reload("a.md");
    queue.drop("a.md");
    const first = asked();
    const queueing = queue.enqueue(first, client);
    expect(queueing.write).toEqual({ ...first, seq: 1, opened: 1, loaded: 1, kept: 1 });
    expect(queue.busy("a.md")).toBe(true);
    expect(queue.enqueue(asked({ content: "T2" }), client).write.seq).toBe(2);
    await queueing.request;
  });

  it("answered takes the note out of the air with its last write and reads a missed note again", async () => {
    const invalidate = vi.spyOn(client, "invalidateQueries");
    queue.enqueue(asked(), client);
    queue.enqueue(asked({ content: "T2" }), client);
    queue.miss("a.md");
    queue.answered("a.md", client);
    expect(queue.air("a.md")).toBeDefined();
    expect(invalidate).not.toHaveBeenCalled();
    queue.answered("a.md", client);
    expect(queue.air("a.md")).toBeUndefined();
    expect(invalidate).toHaveBeenCalledTimes(1);
    await flush();
  });

  it("busy counts the writes in the air rather than flagging them", () => {
    expect(queue.busy("a.md")).toBe(false);
    queue.enqueue(asked(), client);
    queue.enqueue(asked({ content: "T2" }), client);
    queue.answered("a.md", client);
    expect(queue.busy("a.md")).toBe(true);
    expect(queue.busy("b.md")).toBe(false);
    queue.answered("a.md", client);
    expect(queue.busy("a.md")).toBe(false);
  });

  it("staleRead follows the text in the air and declines text from before it", async () => {
    const save = deferred();
    saveNote.mockReturnValueOnce(save.promise);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    queue.enqueue(asked(), client);
    expect(queue.staleRead("b.md", "B")).toBeUndefined();
    expect(queue.staleRead("a.md", "R")).toBeUndefined();
    expect(queue.staleRead("a.md", "B")).toBe(false);
    queue.open();
    expect(queue.follows("a.md")).toBe(false);
    expect(queue.staleRead("a.md", "T1")).toBe(true);
    expect(queue.follows("a.md")).toBe(true);
    // The declined read is read again once the write answers.
    queue.answered("a.md", client);
    expect(invalidate).toHaveBeenCalledTimes(1);
    save.land("T1");
    await flush();
  });

  it("resendLeft holds and resends the writes left in the air, not the note open, a reloaded one or a restore", async () => {
    saveNote.mockReturnValue(new Promise(() => undefined));
    queue.enqueue(asked({ to: "a.md" }), client);
    queue.enqueue(asked({ to: "open.md" }), client);
    queue.enqueue(asked({ to: "restore.md", restoring: true }), client);
    queue.enqueue(asked({ to: "reloaded.md" }), client);
    queue.reload("reloaded.md");
    saveNote.mockClear();
    queue.resendLeft("open.md");
    expect(saveNote.mock.calls.map(([to, , keepalive]) => [to, keepalive])).toEqual([
      ["a.md", true],
    ]);
    expect(heldTexts("a.md").map((entry) => entry.content)).toEqual(["T1"]);
    expect(heldTexts("open.md")).toEqual([]);
  });

  it("drop throws a queued write away as it would go out, for its note only", async () => {
    const save = deferred();
    saveNote.mockReturnValueOnce(save.promise);
    queue.enqueue(asked(), client);
    const behind = queue.enqueue(asked({ content: "T2" }), client);
    const other = queue.enqueue(asked({ to: "b.md" }), client);
    queue.drop("a.md");
    expect(queue.kept(behind.write)).toBe(false);
    expect(queue.kept(other.write)).toBe(true);
    save.land("T1");
    await expect(behind.request).rejects.toBeInstanceOf(Skipped);
    await expect(other.request).resolves.toEqual({ content: "T1" });
  });

  it("revert takes the note out of the air, or puts the thrown text into the restore's stale list", () => {
    saveNote.mockReturnValue(new Promise(() => undefined));
    queue.enqueue(asked({ to: "gone.md" }), client);
    queue.revert("gone.md");
    expect(queue.air("gone.md")).toBeUndefined();
    // T1 went out; the thrown text waits behind it, never sent.
    queue.enqueue(asked(), client);
    queue.enqueue(asked({ content: "thrown" }), client);
    queue.revert("a.md", () => {
      queue.enqueue(asked({ content: "B", restoring: true }), client);
    });
    expect(queue.air("a.md")?.restoring).toBe(true);
    expect(queue.air("a.md")?.stale).toContain("thrown");
    expect(queue.air("a.md")?.stale).toContain("T1");
    expect(queue.staleRead("a.md", "thrown")).toBe(false);
  });

  it("reload, open, visit and reloadsOf keep the counts a write is stamped with", () => {
    expect(queue.visit).toBe(0);
    expect(queue.open()).toBe(1);
    expect(queue.visit).toBe(1);
    queue.reload("a.md");
    queue.reload("a.md");
    expect(queue.reloadsOf("a.md")).toBe(2);
    expect(queue.reloadsOf("b.md")).toBe(0);
    const write = queue.enqueue(asked(), client).write;
    expect([write.opened, write.loaded]).toEqual([1, 2]);
  });

  it("follow moves the queue onto the visit on screen and follows reads it", async () => {
    expect(queue.follow("a.md")).toBeUndefined();
    const { mine } = queue.enqueue(asked(), client);
    expect(queue.follows("a.md")).toBe(true);
    queue.open();
    expect(queue.follows("a.md")).toBe(false);
    expect(queue.follow("a.md")?.link).toBe(mine.link);
    expect(queue.follows("a.md")).toBe(true);
    queue.reload("a.md");
    expect(queue.follows("a.md")).toBe(false);
    await mine.link;
  });

  it("settled answers whether every write in the queue landed", async () => {
    expect(queue.settled("a.md")).toBe(true);
    saveNote.mockReturnValueOnce(Promise.reject(new Error("500")));
    queue.enqueue(asked(), client);
    const failed = queue.settled("a.md");
    await expect(failed).resolves.toBe(false);
    queue.enqueue(asked({ to: "b.md" }), client);
    await expect(queue.settled("b.md")).resolves.toBe(true);
  });

  it("markHeld, newerHeld and isNewest order held entries against later writes", async () => {
    const first = queue.enqueue(asked(), client).write;
    const older = { content: "H0", reason: "", conflicted: false };
    queue.markHeld(older, { seq: 0, visit: 0 });
    const newer = { content: "H1", reason: "", conflicted: false };
    queue.markHeld(newer);
    expect(queue.sends).toBe(1);
    expect(queue.newerHeld(older, first)).toBe(false);
    expect(queue.newerHeld(newer, first)).toBe(true);
    expect(queue.isNewest(first)).toBe(true);
    queue.open();
    const other = { content: "H2", reason: "", conflicted: false };
    queue.markHeld(other);
    expect(queue.newerHeld(other, first)).toBe(false);
    queue.enqueue(asked({ content: "T2" }), client);
    expect(queue.isNewest(first)).toBe(false);
    await flush();
  });

  it("air hands out the live entry, which a later send updates", async () => {
    const save = deferred();
    saveNote.mockReturnValueOnce(save.promise);
    queue.enqueue(asked(), client);
    queue.enqueue(asked({ content: "T2" }), client);
    const air = queue.air("a.md");
    expect(air?.content).toBe("T2");
    expect(air?.sent?.content).toBe("T1");
    save.land("T1");
    await flush();
    expect(air?.sent?.content).toBe("T2");
    expect(air?.stale).toContain("T1");
  });

  it("forget resets every map and count", () => {
    saveNote.mockReturnValue(new Promise(() => undefined));
    queue.open();
    queue.reload("a.md");
    queue.drop("a.md");
    queue.miss("a.md");
    // Stamped as the first write after the reset would read it, were it kept.
    const held = { content: "H", reason: "", conflicted: false };
    queue.markHeld(held, { seq: 1, visit: 0 });
    queue.enqueue(asked(), client);
    queue.forget();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    expect([queue.visit, queue.sends, queue.reloadsOf("a.md")]).toEqual([0, 0, 0]);
    expect([queue.busy("a.md"), queue.air("a.md"), queue.follow("a.md")]).toEqual([
      false,
      undefined,
      undefined,
    ]);
    expect(queue.settled("a.md")).toBe(true);
    const write = queue.enqueue(asked(), client).write;
    expect(write.kept).toBe(0);
    expect(queue.newerHeld(held, write)).toBe(false);
    queue.answered("a.md", client);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
