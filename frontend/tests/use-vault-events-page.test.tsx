/**
 * A `page` event on the stream (#1277): it reaches the html panes through
 * `onPageWritten` and asks no cache again, since no note, todo or file list is
 * held under an html page's path. The `listing` the same change sends is what
 * asks for the file lists.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { useRef } from "react";
import { onPageWritten } from "@/lib/html/page-written";
import { useVaultEvents } from "@/lib/use-vault-events";
import type { VaultEvent } from "@/lib/vault-events";

class FakeStream {
  static last: FakeStream | undefined;
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  close = vi.fn();

  constructor() {
    FakeStream.last = this;
  }

  send(event: VaultEvent) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}

function Route() {
  const focusedNote = useRef({
    path: undefined as string | undefined,
    isWriting: () => false,
    reconcile: () => true,
    isConflicted: () => false,
  });
  useVaultEvents(focusedNote, () => {});
  return null;
}

beforeEach(() => {
  vi.stubGlobal("EventSource", FakeStream);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("a page event tells the panes its path and asks no cache again", () => {
  const client = new QueryClient();
  client.setQueryData(["files"], ["a.md"]);
  render(
    <QueryClientProvider client={client}>
      <Route />
    </QueryClientProvider>,
  );
  const heard: string[] = [];
  const stop = onPageWritten((path) => heard.push(path));
  const invalidate = vi.spyOn(client, "invalidateQueries");

  FakeStream.last?.send({ path: "r/report.html", change: "page", digest: "abc" });
  stop();

  expect({ heard, asked: invalidate.mock.calls.length }).toEqual({
    heard: ["r/report.html"],
    asked: 0,
  });
});
