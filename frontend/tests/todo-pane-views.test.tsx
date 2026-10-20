import { waitFor } from "@testing-library/react";
import { DEFAULT_VIEWS } from "@/lib/todo-view";
import { paneHooks, renderPane } from "./todo-pane-fixture";

// The doubles, the same in every todo-pane file: see todo-pane-fixture.tsx.
const { fetchTodos, fetchNote, fetchFiles, createNote } = vi.hoisted(() => ({
  fetchTodos: vi.fn(),
  fetchNote: vi.fn(),
  fetchFiles: vi.fn(),
  createNote: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ fetchTodos, fetchNote, fetchFiles, createNote }));

paneHooks();

describe("the todo pane", () => {
  it("puts the first view's terms in the filter line on v", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("v");

    await waitFor(() => expect(pane.view()).toBe("today"));
    expect(fetchNote).toHaveBeenCalledWith("99 Misc/01 Config/todo-views.md");
    expect(pane.filter().value).toBe("due:today");
    // The two due today, and neither of the four that are not.
    expect(pane.rows()).toHaveLength(2);
    expect(pane.texts().join()).toContain("wire up the pane");
    expect(pane.texts().join()).not.toContain("call the dentist");
  });

  it("walks to the next view on a second v", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("v");
    pane.press("v");

    await waitFor(() => expect(pane.view()).toBe("doing"));
    expect(pane.filter().value).toBe("/doing");
    expect(pane.rows()).toHaveLength(1);
  });

  it("gives the whole list back one press past the last view", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    // One press per view the defaults hold, which lands on the last of them.
    pane.press("v");
    pane.press("v");
    pane.press("v");
    pane.press("v");
    await waitFor(() => expect(pane.view()).toBe("important"));
    pane.press("v");

    await waitFor(() => expect(pane.rows()).toHaveLength(6));
    expect(pane.view()).toBe("");
    expect(pane.filter().value).toBe("");
  });

  it("takes the name out of the header when the line is typed into", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("v");
    await waitFor(() => expect(pane.view()).toBe("today"));
    pane.type("#kasten");

    await waitFor(() => expect(pane.view()).toBe(""));
    expect(pane.filter().value).toBe("#kasten");
  });

  it("says so and narrows nothing where the vault answers with no views", async () => {
    fetchNote.mockRejectedValueOnce(new Error("GET /api/files/… failed with 404"));
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("v");

    await waitFor(() => expect(pane.view()).toBe("no views"));
    expect(pane.rows()).toHaveLength(6);
  });

  it("writes the views note on the first v in a vault with none", async () => {
    fetchFiles.mockResolvedValue(["projects/kasten.md"]);
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("v");

    await waitFor(() => expect(pane.view()).toBe("today"));
    expect(createNote).toHaveBeenCalledWith("99 Misc/01 Config/todo-views.md", DEFAULT_VIEWS);
    expect(pane.filter().value).toBe("due:today");
    expect(pane.rows()).toHaveLength(2);
  });

  it("sends one create however fast the second v comes", async () => {
    fetchFiles.mockResolvedValue(["projects/kasten.md"]);
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("v");
    pane.press("v");

    await waitFor(() => expect(pane.view()).toBe("doing"));
    expect(createNote).toHaveBeenCalledTimes(1);
  });

  it("writes nothing where the vault already holds the note", async () => {
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("v");

    await waitFor(() => expect(pane.view()).toBe("today"));
    expect(createNote).not.toHaveBeenCalled();
  });

  it("says so where the vault refuses the create", async () => {
    fetchFiles.mockResolvedValue(["projects/kasten.md"]);
    createNote.mockRejectedValueOnce(new Error("POST /api/files/… failed with 500"));
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("v");

    await waitFor(() => expect(pane.view()).toBe("no views"));
    expect(pane.rows()).toHaveLength(6);
  });

  it("says so for a note holding no line it can read", async () => {
    fetchNote.mockResolvedValue("# Todo views\n\nNone written yet.\n");
    const pane = renderPane();
    await waitFor(() => expect(pane.rows()).toHaveLength(6));

    pane.press("v");

    await waitFor(() => expect(pane.view()).toBe("no views"));
    expect(pane.rows()).toHaveLength(6);
  });
});
