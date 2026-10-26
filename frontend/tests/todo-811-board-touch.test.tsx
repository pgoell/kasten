import { screen } from "@testing-library/react";
import { COARSE, NARROW, stubMatchMedia } from "./match-media";
import { boardHooks, boardPane } from "./todo-board-pane-fixture";

// The module rather than `fetch`, as the list's own tests stand it in.
const { fetchTodos, fetchNote, fetchFiles, createNote } = vi.hoisted(() => ({
  fetchTodos: vi.fn(),
  fetchNote: vi.fn(),
  fetchFiles: vi.fn(),
  createNote: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ fetchTodos, fetchNote, fetchFiles, createNote }));

boardHooks();

describe("the board's tap targets on a phone (#811 I6)", () => {
  it("#811 I6 every tap target on a phone board is at least 44 px high", async () => {
    stubMatchMedia({ [NARROW]: true, [COARSE]: true });
    const pane = await boardPane();
    const heading = screen.getAllByRole("heading").find((one) => one.textContent === "#client");
    const lane = heading?.querySelector("button");

    // The lanes switch, a state tab, a lane's heading, a card and its `⋯`.
    for (const target of [
      screen.getByRole("button", { name: "kind" }),
      screen.getByRole("button", { name: "project" }),
      screen.getByRole("tab", { name: "Open 3" }),
      lane,
      pane.card("send the invoice"),
      screen.getByLabelText(/^more for send the invoice/),
    ]) {
      expect(target?.className).toContain("min-h-11");
    }
  });
});
