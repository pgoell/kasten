import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

const { fetchNote } = vi.hoisted(() => ({ fetchNote: vi.fn() }));

vi.mock("@/lib/core/api", () => ({ fetchNote }));

import { COLUMN_CAP, cutNote, parseCsv, ROW_CAP } from "@/lib/notes/embeds/csv";
import { queryEmbedSource } from "@/lib/notes/embeds/embed";

afterEach(() => {
  fetchNote.mockReset();
});

describe("queryEmbedSource", () => {
  it("hands the listener the note's text, and the new text each time the vault's changes", async () => {
    const client = new QueryClient();
    fetchNote.mockResolvedValue("first");
    const listener = vi.fn();
    const stop = queryEmbedSource(client, vi.fn(), vi.fn()).watch("a.md", listener);

    await vi.waitFor(() => expect(listener).toHaveBeenLastCalledWith("first"));
    expect(fetchNote).toHaveBeenCalledWith("a.md");

    // The autosave's way in: the note the vault answered a write with.
    client.setQueryData(["note", "a.md"], "saved");
    await vi.waitFor(() => expect(listener).toHaveBeenLastCalledWith("saved"));

    // The route's way in: a vault event invalidates the key and it is read again.
    fetchNote.mockResolvedValue("written elsewhere");
    await client.invalidateQueries({ queryKey: ["note", "a.md"] });
    await vi.waitFor(() => expect(listener).toHaveBeenLastCalledWith("written elsewhere"));

    stop();
  });

  it("hands the listener a note already in the cache straight away", () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: 10_000 } } });
    client.setQueryData(["note", "a.md"], "open beside it");
    const listener = vi.fn();
    const stop = queryEmbedSource(client, vi.fn(), vi.fn()).watch("a.md", listener);

    expect(listener).toHaveBeenCalledWith("open beside it");
    expect(fetchNote).not.toHaveBeenCalled();

    stop();
  });

  it("hands the listener null when the note is taken out of the cache, as trashing it does", () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: 10_000 } } });
    client.setQueryData(["note", "a.md"], "body");
    client.setQueryData(["note", "b.md"], "other");
    const listener = vi.fn();
    const stop = queryEmbedSource(client, vi.fn(), vi.fn()).watch("a.md", listener);

    client.removeQueries({ queryKey: ["note", "b.md"] });
    expect(listener).toHaveBeenLastCalledWith("body");

    client.removeQueries({ queryKey: ["note", "a.md"] });
    expect(listener).toHaveBeenLastCalledWith(null);

    stop();
  });

  it("hears a note again once it is back in the cache, as restoring and opening it does", () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: 10_000 } } });
    client.setQueryData(["note", "a.md"], "body");
    const listener = vi.fn();
    const stop = queryEmbedSource(client, vi.fn(), vi.fn()).watch("a.md", listener);
    client.removeQueries({ queryKey: ["note", "a.md"] });

    client.setQueryData(["note", "a.md"], "body");
    expect(listener).toHaveBeenLastCalledWith("body");
    client.setQueryData(["note", "a.md"], "edited");
    expect(listener).toHaveBeenLastCalledWith("edited");

    stop();
  });

  it("leaves nothing on the cache that calls the listener once it is unsubscribed", () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: 10_000 } } });
    client.setQueryData(["note", "a.md"], "body");
    const listener = vi.fn();
    const stop = queryEmbedSource(client, vi.fn(), vi.fn()).watch("a.md", listener);
    stop();
    listener.mockClear();

    client.removeQueries({ queryKey: ["note", "a.md"] });
    client.setQueryData(["note", "a.md"], "back");

    expect(listener).not.toHaveBeenCalled();
  });

  it("hands the listener null when the note cannot be read", async () => {
    const client = new QueryClient();
    fetchNote.mockRejectedValue(new Error("GET /api/files/gone.md failed with 404"));
    const listener = vi.fn();
    const stop = queryEmbedSource(client, vi.fn(), vi.fn()).watch("gone.md", listener);

    await vi.waitFor(() => expect(listener).toHaveBeenLastCalledWith(null));
    // No retries: a missing note stays missing, and three reads say so no better.
    expect(fetchNote).toHaveBeenCalledTimes(1);

    stop();
  });

  it("stops calling the listener once it is unsubscribed", async () => {
    const client = new QueryClient();
    fetchNote.mockResolvedValue("first");
    const listener = vi.fn();
    const stop = queryEmbedSource(client, vi.fn(), vi.fn()).watch("a.md", listener);
    await vi.waitFor(() => expect(listener).toHaveBeenLastCalledWith("first"));

    stop();
    const calls = listener.mock.calls.length;
    client.setQueryData(["note", "a.md"], "saved");
    fetchNote.mockResolvedValue("written elsewhere");
    // Every query is refetched, observed or not, so an observer left behind
    // would hear this one.
    await client.refetchQueries({ queryKey: ["note", "a.md"] });

    expect(listener).toHaveBeenCalledTimes(calls);
  });

  it("opens the note through the handler it was given, line and all", () => {
    const open = vi.fn();
    queryEmbedSource(new QueryClient(), open, vi.fn()).open("a.md", 7);

    expect(open).toHaveBeenCalledWith("a.md", 7);
  });

  it("opens a csv in its table, in any case, not in a tab", () => {
    const openTable = vi.fn();
    const opened = vi.spyOn(window, "open").mockReturnValue(null);

    queryEmbedSource(new QueryClient(), vi.fn(), vi.fn(), openTable).open("data/Sales.CSV");

    expect(openTable).toHaveBeenCalledWith("data/Sales.CSV");
    expect(opened).not.toHaveBeenCalled();
    opened.mockRestore();
  });

  it("opens a video file in the pane, in any case, not in a tab", () => {
    const openTable = vi.fn();
    const opened = vi.spyOn(window, "open").mockReturnValue(null);
    const source = queryEmbedSource(new QueryClient(), vi.fn(), vi.fn(), openTable);

    source.open("clips/walk.mp4");
    source.open("clips/RUN.WEBM");

    expect(openTable.mock.calls).toEqual([["clips/walk.mp4"], ["clips/RUN.WEBM"]]);
    expect(opened).not.toHaveBeenCalled();
    opened.mockRestore();
  });

  it("I1 opens a pdf in kasten's pdf view, not the browser's, at no page", () => {
    const open = vi.fn();
    const openPdf = vi.fn();
    const tab = vi.spyOn(window, "open").mockReturnValue(null);

    queryEmbedSource(new QueryClient(), open, openPdf).open("my docs/Plan.PDF");

    expect(openPdf).toHaveBeenCalledWith("my docs/Plan.PDF", undefined);
    expect(open).not.toHaveBeenCalled();
    expect(tab).not.toHaveBeenCalled();
    tab.mockRestore();
  });

  it("A1 opens a pdf in kasten's pdf view at the page it was given", () => {
    const openPdf = vi.fn();
    const tab = vi.spyOn(window, "open").mockReturnValue(null);

    queryEmbedSource(new QueryClient(), vi.fn(), openPdf).open("my docs/plan.pdf", 3);

    expect(openPdf).toHaveBeenCalledWith("my docs/plan.pdf", 3);
    expect(tab).not.toHaveBeenCalled();
    tab.mockRestore();
  });

  it("opens any other file in a tab of its own", () => {
    const open = vi.fn();
    const openPdf = vi.fn();
    const tab = vi.spyOn(window, "open").mockReturnValue(null);

    queryEmbedSource(new QueryClient(), open, openPdf).open("my docs/talk.mp3");

    expect(tab).toHaveBeenCalledWith("/api/assets/my%20docs/talk.mp3", "_blank");
    expect(open).not.toHaveBeenCalled();
    expect(openPdf).not.toHaveBeenCalled();
    tab.mockRestore();
  });
});

describe("parseCsv", () => {
  it("reads quotes, doubled quotes, separators and line breaks inside them, and every line end", () => {
    const text = 'a,b,c\r\n"x, y","say ""hi""","two\nlines"\n1,2,3\r4,5,6';

    expect(parseCsv(text).rows).toEqual([
      ["a", "b", "c"],
      ["x, y", 'say "hi"', "two\nlines"],
      ["1", "2", "3"],
      ["4", "5", "6"],
    ]);
  });

  it("reads a semicolon or a tab file by its first line, and leaves a BOM out of the head", () => {
    expect(parseCsv("﻿Name;Wert\r\nÄpfel;1,50\r\n").rows).toEqual([
      ["Name", "Wert"],
      ["Äpfel", "1,50"],
    ]);
    expect(parseCsv("a\tb\n1,5\t2").rows).toEqual([
      ["a", "b"],
      ["1,5", "2"],
    ]);
  });

  it("keeps ragged rows as they are, skips blank lines, and runs an unclosed quote to the end", () => {
    const csv = parseCsv('a,b,c\n\n1\n1,2,3,4\n"open,\nnever');

    expect(csv.rows).toEqual([["a", "b", "c"], ["1"], ["1", "2", "3", "4"], ["open,\nnever"]]);
    expect(csv.widest).toBe(4);
  });

  it("stops at the row and column caps but counts past them", () => {
    const csv = parseCsv(`${"x,".repeat(COLUMN_CAP + 9)}x\n${"1\n".repeat(ROW_CAP + 99)}`);

    expect(csv.rows).toHaveLength(ROW_CAP);
    expect(csv.rows[0]).toHaveLength(COLUMN_CAP);
    expect([csv.total, csv.widest]).toEqual([ROW_CAP + 100, COLUMN_CAP + 10]);
    expect(cutNote(csv, false)).toBe(
      `Showing ${ROW_CAP} of ${ROW_CAP + 100} rows. Showing ${COLUMN_CAP} of ${COLUMN_CAP + 10} columns.`,
    );
  });

  it("skips blank lines past the row cap too, so the count stays the rows", () => {
    const csv = parseCsv("x\n\n".repeat(ROW_CAP + 100));

    expect([csv.rows.length, csv.total]).toEqual([ROW_CAP, ROW_CAP + 100]);
  });

  it("reads a long file in one pass, quotes and commas alike", () => {
    for (const text of ["a,".repeat(500_000), `"${'""'.repeat(300_000)}`, "x\n".repeat(500_000)]) {
      const started = performance.now();
      parseCsv(text);
      expect(performance.now() - started).toBeLessThan(2000);
    }
  });
});
