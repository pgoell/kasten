import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

const { fetchNote } = vi.hoisted(() => ({ fetchNote: vi.fn() }));

vi.mock("@/lib/api", () => ({ fetchNote }));

import { queryEmbedSource } from "@/lib/embed";

afterEach(() => {
  fetchNote.mockReset();
});

describe("queryEmbedSource", () => {
  it("hands the listener the note's text, and the new text each time the vault's changes", async () => {
    const client = new QueryClient();
    fetchNote.mockResolvedValue("first");
    const listener = vi.fn();
    const stop = queryEmbedSource(client, vi.fn()).watch("a.md", listener);

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
    const stop = queryEmbedSource(client, vi.fn()).watch("a.md", listener);

    expect(listener).toHaveBeenCalledWith("open beside it");
    expect(fetchNote).not.toHaveBeenCalled();

    stop();
  });

  it("hands the listener null when the note is taken out of the cache, as trashing it does", () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: 10_000 } } });
    client.setQueryData(["note", "a.md"], "body");
    client.setQueryData(["note", "b.md"], "other");
    const listener = vi.fn();
    const stop = queryEmbedSource(client, vi.fn()).watch("a.md", listener);

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
    const stop = queryEmbedSource(client, vi.fn()).watch("a.md", listener);
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
    const stop = queryEmbedSource(client, vi.fn()).watch("a.md", listener);
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
    const stop = queryEmbedSource(client, vi.fn()).watch("gone.md", listener);

    await vi.waitFor(() => expect(listener).toHaveBeenLastCalledWith(null));
    // No retries: a missing note stays missing, and three reads say so no better.
    expect(fetchNote).toHaveBeenCalledTimes(1);

    stop();
  });

  it("stops calling the listener once it is unsubscribed", async () => {
    const client = new QueryClient();
    fetchNote.mockResolvedValue("first");
    const listener = vi.fn();
    const stop = queryEmbedSource(client, vi.fn()).watch("a.md", listener);
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
    queryEmbedSource(new QueryClient(), open).open("a.md", 7);

    expect(open).toHaveBeenCalledWith("a.md", 7);
  });
});
