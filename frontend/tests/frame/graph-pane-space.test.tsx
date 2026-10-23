/**
 * Space and Enter on a focused note button in a pattern's rows table of the vault
 * graph's pane: Space presses the button and opens its note, as Enter does, with
 * vim on and off.
 */

import { waitFor } from "@testing-library/react";
import { userEvent } from "vitest/browser";
import { DESKTOP, need } from "./reader-fixture";
import {
  boxOf,
  DEV_ANSWER,
  mountPane,
  registerVaultFixture,
  serveGraph,
  setUp,
  untilCounted,
} from "./vault-graph-fixture";

vi.mock("@/lib/graph-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/graph-api")>()),
  fetchGraph: vi.fn(),
}));

registerVaultFixture();

describe("graph pane Space on a focused row button", () => {
  const P = need(
    DEV_ANSWER.nodes.find((node) => !node.missing)?.path,
    "a written note in the dev vault",
  );

  for (const vim of ["on", "off"] as const) {
    it(`A1 with vim ${vim}, Space on a focused row button opens its note`, async () => {
      await setUp(DESKTOP, "light", "folders", vim);
      serveGraph({ ...DEV_ANSWER, columns: ["?a"], rows: [{ "?a": P }] });
      const host = boxOf(DESKTOP.width, DESKTOP.height);
      const { onOpen } = await mountPane(host);
      await untilCounted(host);

      const button = await waitFor(
        () =>
          need(host.querySelector<HTMLButtonElement>(`table button[title='${P}']`), "row button"),
        { timeout: 5000 },
      );
      button.focus();
      expect(document.activeElement).toBe(button);
      await userEvent.keyboard(" ");
      expect(onOpen).toHaveBeenCalledWith(P);
    });
  }

  it("I4 Enter on a focused row button opens its note", async () => {
    await setUp(DESKTOP, "light", "folders", "on");
    serveGraph({ ...DEV_ANSWER, columns: ["?a"], rows: [{ "?a": P }] });
    const host = boxOf(DESKTOP.width, DESKTOP.height);
    const { onOpen } = await mountPane(host);
    await untilCounted(host);

    const button = await waitFor(
      () => need(host.querySelector<HTMLButtonElement>(`table button[title='${P}']`), "row button"),
      { timeout: 5000 },
    );
    button.focus();
    expect(document.activeElement).toBe(button);
    await userEvent.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledWith(P);
  });
});
