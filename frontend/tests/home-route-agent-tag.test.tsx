import { fireEvent, screen } from "@testing-library/react";
import { useMemo } from "react";
import type { TodoHit } from "@/lib/api";
import { holdText } from "@/lib/held-text";
import { noteBase } from "@/lib/note-base";
import type { PdfRenderer } from "@/lib/pdf-view";
import type { TodoState } from "@/lib/todo";
import { hashed } from "./digests";
import { defineFoliateFake } from "./foliate-fake";
import { pageHooks, renderApp, settle, theRoute, VAULT } from "./home-route-fixture";
import { COARSE, NARROW, stubMatchMedia } from "./match-media";

defineFoliateFake();

// The doubles, the same in every home-route file: see home-route-fixture.tsx.
const {
  fetchFiles,
  fetchNote,
  saveNote,
  updateNote,
  searchNotes,
  fetchMentions,
  createNote,
  renameNote,
  moveFolder,
  deleteNote,
  fetchTrash,
  restoreEntry,
  fetchTerminals,
  fetchTodos,
  fetchBook,
  uploadAsset,
  fetchImages,
  fetchHtml,
  fetchAssets,
  deleteImage,
  fetchVersion,
  fetchTags,
  fetchHistory,
  fetchHistoryText,
} = vi.hoisted(() => {
  const beside = (note: string, suffix = ".epub") => ({
    path: note.replace(/\.md$/, suffix),
    blob: new Blob(["a book"]),
  });

  const fetchNote = vi.fn();
  const saveNote = vi.fn();

  return {
    beside,
    fetchFiles: vi.fn(),
    fetchNote,
    saveNote,
    updateNote: vi.fn(async (path: string, change: (text: string) => string | null) => {
      const text: string = await fetchNote(path);
      const next = change(text);
      return next === null ? null : saveNote(path, next, false, noteBase(text));
    }),
    searchNotes: vi.fn(),
    fetchMentions: vi.fn(),
    createNote: vi.fn(),
    renameNote: vi.fn(),
    moveFolder: vi.fn(),
    deleteNote: vi.fn(),
    fetchTrash: vi.fn(),
    restoreEntry: vi.fn(),
    fetchTerminals: vi.fn().mockResolvedValue([]),
    fetchTodos: vi.fn().mockResolvedValue([]),
    fetchBook: vi.fn(async (note: string) => beside(note)),
    uploadAsset: vi.fn().mockResolvedValue(undefined),
    fetchImages: vi.fn().mockResolvedValue([]),
    fetchHtml: vi.fn().mockResolvedValue([]),
    fetchAssets: vi.fn().mockResolvedValue([]),
    fetchTags: vi.fn().mockResolvedValue([]),
    deleteImage: vi.fn(),
    fetchVersion: vi.fn().mockResolvedValue("0.8.0"),
    fetchHistory: vi.fn(),
    fetchHistoryText: vi.fn(),
  };
});
vi.mock("@/lib/api", () => ({
  fetchFiles,
  fetchNote,
  saveNote,
  updateNote,
  searchNotes,
  fetchMentions,
  createNote,
  fetchTerminals,
  fetchTodos,
  fetchBook,
  uploadAsset,
  fetchImages,
  fetchHtml,
  fetchAssets,
  fetchVersion,
  fetchTags,
  fetchWeather: async () => [],
  UPLOAD_LIMIT_BYTES: 1024 * 1024 * 1024,
  ChangedOnDisk: class ChangedOnDisk extends Error {},
  NoteExists: class NoteExists extends Error {},
  NoteMissing: class NoteMissing extends Error {},
}));
vi.mock("@/lib/move-api", () => ({ renameNote, moveFolder }));
vi.mock("@/lib/trash-api", () => ({ deleteNote, fetchTrash, restoreEntry, deleteImage }));
vi.mock("@/lib/history-api", () => ({ fetchHistory, fetchHistoryText }));
vi.mock("foliate-js/view.js", () => ({}));
const pdfPaneRenderer = vi.hoisted(() => ({ current: null as PdfRenderer | null }));
vi.mock("@/lib/pdf-view", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/pdf-view")>();
  return {
    ...real,
    pdfjsRenderer: {
      open: (url: string) => (pdfPaneRenderer.current ?? real.pdfjsRenderer).open(url),
    },
  };
});
const paneProps = vi.hoisted(() => ({
  current: null as {
    onRefile: (hit: TodoHit, project?: string) => void;
    onCycle: (hit: TodoHit, state?: TodoState, twins?: number[]) => void;
  } | null,
}));
vi.mock("@/components/todo-pane", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/todo-pane")>();
  function TodoPane(props: Parameters<typeof real.TodoPane>[0]) {
    paneProps.current = props;
    return <real.TodoPane {...props} />;
  }
  return { ...real, TodoPane };
});
const outbox = vi.hoisted(() => ({
  keep: vi.fn(),
  flush: vi.fn(),
  start: vi.fn(),
  subscribe: vi.fn(() => () => {}),
}));
vi.mock("@/lib/outbox", () => outbox);
vi.mock("@/lib/fuzzy", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/fuzzy")>();
  return {
    ...real,
    noteCandidates: vi.fn(real.noteCandidates),
    folderCandidates: vi.fn(real.folderCandidates),
    lineCandidates: vi.fn(real.lineCandidates),
  };
});
vi.mock("@/components/file-explorer", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/file-explorer")>();
  const buildTree = vi.fn(real.buildTree);
  function FileExplorer(props: Parameters<typeof real.FileExplorer>[0]) {
    useMemo(
      () => buildTree(props.paths, props.images, props.html, props.pdfs),
      [props.paths, props.images, props.html, props.pdfs],
    );
    return <real.FileExplorer {...props} />;
  }
  return { ...real, buildTree, FileExplorer };
});

pageHooks();

describe("the route", () => {
  theRoute();

  describe("sending a todo to the agent worker", () => {
    const PATH = "inbox.md";
    const ROW = {
      path: PATH,
      line: 2,
      text: "- [ ] send the deck 📅 2026-10-20",
      project: null,
      shared: false,
    };

    /** What the vault holds, which the writes change as a real vault would. */
    let notes: Record<string, string>;

    /** The pane listing `rows` over `text` in `PATH`, opened by the toolbar on a phone. */
    async function listing(rows: TodoHit[], text: string, phone = false) {
      notes = { ...VAULT, [PATH]: text };
      fetchFiles.mockImplementation(async () => Object.keys(notes));
      fetchNote.mockImplementation(async (path: string) => notes[path]);
      saveNote.mockImplementation(async (path: string, content: string) => {
        notes[path] = content;
        return { path, content };
      });
      fetchTodos.mockResolvedValue(rows);
      const app = await renderApp();
      await settle();
      if (phone) fireEvent.click(screen.getByRole("button", { name: "Open the todo pane" }));
      else app.leader("g", "t");
      await settle();
      return app;
    }

    /** `keys` pressed in the desktop pane, and the writes they start settled. */
    async function press(app: Awaited<ReturnType<typeof renderApp>>, ...keys: string[]) {
      const pane = app.todoPane() as HTMLElement;
      pane.focus();
      for (const key of keys) fireEvent.keyDown(pane, { key });
      await hashed();
      await settle();
    }

    /** The paths saved, in the order they went out. */
    const saved = () => saveNote.mock.calls.map(([path]) => path);

    it("#523 A1 the pane's @ adds #agent before the fields", async () => {
      const app = await listing([ROW], `## TODOs\n${ROW.text}\n- [ ] buy milk`);

      await press(app, "@");

      expect(notes[PATH]).toBe(
        "## TODOs\n- [ ] send the deck #agent 📅 2026-10-20\n- [ ] buy milk",
      );
    });

    it("#523 A1 the pane's @ adds #agent to a todo in progress", async () => {
      const row = { ...ROW, text: "- [/] send the deck" };
      const app = await listing([row], `## TODOs\n${row.text}`);

      await press(app, "@");

      expect(notes[PATH]).toBe("## TODOs\n- [/] send the deck #agent");
    });

    it("#523 A2 the pane's @ on an open todo carrying #agent takes it off", async () => {
      const row = { ...ROW, text: "- [ ] send the deck #agent 📅 2026-10-20" };
      const app = await listing([row], `## TODOs\n${row.text}`);

      await press(app, "@");

      expect(notes[PATH]).toBe("## TODOs\n- [ ] send the deck 📅 2026-10-20");
    });

    it("#523 A3 the pane's @ on a todo in progress carrying #agent leaves it and says so", async () => {
      const row = { ...ROW, text: "- [/] send the deck #agent" };
      const app = await listing([row], `## TODOs\n${row.text}`);

      await press(app, "@");

      expect.soft(saveNote).not.toHaveBeenCalled();
      expect(app.notice()).toBe("Nothing moved: that todo is already with the agent");
    });

    it("#523 A5 the pane's @ on a todo carrying #client writes nothing and says why", async () => {
      const row = { ...ROW, text: "- [ ] bill them #client" };
      const app = await listing([row], `## TODOs\n${row.text}`);

      await press(app, "@");

      expect.soft(saveNote).not.toHaveBeenCalled();
      expect(app.notice()).toBe("Nothing moved: the agent skips client work");
    });

    it("#523 A5 the pane's @ on a part of a #client todo writes nothing and says why", async () => {
      const row = { ...ROW, line: 3, text: "  - [ ] send the invoice" };
      const app = await listing([row], `## TODOs\n- [ ] the job #client\n${row.text}`);

      await press(app, "@");

      expect.soft(saveNote).not.toHaveBeenCalled();
      expect(app.notice()).toBe("Nothing moved: the agent skips client work");
    });

    it("#523 A7 the pane's @ changes the tag and not one other byte of the note", async () => {
      const text = [
        "---",
        "id: inbox",
        "---",
        "## TODOs",
        "- [ ] send the deck #p/fde ⏫ 📅 2026-10-20 🆔 kt-abc123",
        "  - [ ] draw the chart",
        "",
        "Some prose with #agent in it.",
        "",
      ].join("\n");
      const row = {
        ...ROW,
        line: 5,
        text: "- [ ] send the deck #p/fde ⏫ 📅 2026-10-20 🆔 kt-abc123",
      };
      const app = await listing([row], text);

      await press(app, "@");

      expect(notes[PATH]).toBe(text.replace("#p/fde ⏫", "#p/fde #agent ⏫"));
    });

    it("#523 A8 I3 the pane's @ writes nothing while the note holds text not yet saved", async () => {
      holdText(PATH, { content: "typed", reason: "PUT failed with 500", conflicted: false });
      const app = await listing([ROW], `## TODOs\n${ROW.text}`);

      await press(app, "@");

      expect.soft(saveNote).not.toHaveBeenCalled();
      expect(app.notice()).toBe("Nothing moved: inbox.md holds text not yet saved");
    });

    it("#523 A8 I3 the pane's @ that the vault refuses says Nothing moved and why", async () => {
      const app = await listing([ROW], `## TODOs\n${ROW.text}`);
      saveNote.mockRejectedValue(new Error("PUT failed with 500"));

      await press(app, "@");

      expect(app.notice()).toBe("Nothing moved: PUT failed with 500");
    });

    it("#523 A9 the phone strip's agent adds #agent", async () => {
      stubMatchMedia({ [NARROW]: true, [COARSE]: true });
      await listing([ROW], `## TODOs\n${ROW.text}`, true);

      fireEvent.click(screen.getByLabelText("more for send the deck"));
      // Queried, not got, so a strip without the button fails on the note below.
      const agent = screen.queryByLabelText("agent send the deck");
      expect.soft(agent, "the strip holds agent").not.toBeNull();
      if (agent !== null) fireEvent.click(agent);
      await hashed();
      await settle();

      expect(notes[PATH]).toBe("## TODOs\n- [ ] send the deck #agent 📅 2026-10-20");
    });

    it("#523 A10 the pane's footer names @ agent", async () => {
      await listing([ROW], `## TODOs\n${ROW.text}`);

      expect(screen.getByTestId("todo-footer").textContent).toContain("@ agent");
    });

    /** The palette's row for the pane's `@`, or null where it lists none. */
    const agentEntry = () =>
      screen.queryByRole("option", { name: /^Send the todo under the cursor to the agent/ });

    it("#523 A10 the palette over the todo pane sends the row's todo to the agent", async () => {
      const app = await listing([ROW], `## TODOs\n${ROW.text}`);

      await press(app, " ", ":");
      const entry = agentEntry();
      expect.soft(entry, "the palette lists the pane's @").not.toBeNull();
      if (entry !== null) fireEvent.click(entry);
      await hashed();
      await settle();

      expect(notes[PATH]).toBe("## TODOs\n- [ ] send the deck #agent 📅 2026-10-20");
    });

    it("#523 A10 the palette over a note lists no pane agent entry", async () => {
      const app = await listing([ROW], `## TODOs\n${ROW.text}`);
      // Back to a note in the focused pane, then the palette over its editor.
      app.click("index.md");
      await settle();
      app.leader(":");
      await settle();

      expect.soft(screen.queryByRole("dialog", { name: "Run a command" })).not.toBeNull();
      expect(agentEntry()).toBeNull();
    });

    it("#523 I2 the pane's @ tags its todo after a line was written above it", async () => {
      const app = await listing([ROW], `## TODOs\n- [ ] new one\n${ROW.text}`);

      await press(app, "@");

      expect(notes[PATH]).toBe("## TODOs\n- [ ] new one\n- [ ] send the deck #agent 📅 2026-10-20");
    });

    it("#523 I2 the pane's @ on a twin tags that twin after a shift", async () => {
      const twins = [
        { path: PATH, line: 1, text: "- [ ] a", project: null, shared: false },
        { path: PATH, line: 2, text: "- [ ] a", project: null, shared: false },
      ];
      const app = await listing(twins, "## TODOs\n- [ ] a\n- [ ] a");

      await press(app, "j", "@");

      expect(notes[PATH]).toBe("## TODOs\n- [ ] a\n- [ ] a #agent");
    });

    it("#523 I2 the pane's @ on a line gone since the listing writes nothing and says so", async () => {
      const app = await listing([ROW], "## TODOs\n- [ ] buy milk");

      await press(app, "@");

      expect.soft(saveNote).not.toHaveBeenCalled();
      expect(app.notice()).toBe("Nothing moved: that line has changed since it was listed");
    });

    it("#523 I5 two @ before the list redraws add the tag and take it off again", async () => {
      const text = `## TODOs\n${ROW.text}`;
      const app = await listing([ROW], text);

      await press(app, "@", "@");

      expect.soft(notes[PATH]).toBe(text);
      expect(saved()).toEqual([PATH, PATH]);
    });

    /** `- [ ] foo` and the same words tagged, both listed. */
    const FOOS = [
      { path: PATH, line: 2, text: "- [ ] foo", project: null, shared: false },
      { path: PATH, line: 3, text: "- [ ] foo #agent", project: null, shared: false },
    ];

    it("#523 B1 the pane's @ on a row whose line was deleted leaves the tag on the todo below", async () => {
      // Line 2 deleted by another writer since the listing: line 2 is now the
      // tagged todo, which is not the row pressed.
      const app = await listing(FOOS, "## TODOs\n- [ ] foo #agent");

      await press(app, "@");

      expect.soft(saveNote).not.toHaveBeenCalled();
      expect(app.notice()).toBe("Nothing moved: that line has changed since it was listed");
    });

    it("#523 B1 three quick @ on two rows of the same words each press their own todo", async () => {
      const app = await listing(FOOS, "## TODOs\n- [ ] foo\n- [ ] foo #agent");

      // The second row off, the first on, the second on again, before a redraw.
      await press(app, "j", "@", "k", "@", "j", "@");

      expect(notes[PATH]).toBe("## TODOs\n- [ ] foo #agent\n- [ ] foo #agent");
    });

    it("#523 B2 a second @ whose line now has a twin below a deleted line writes nothing and says so", async () => {
      const rows = [
        { path: PATH, line: 2, text: "- [ ] x", project: null, shared: false },
        ...FOOS.map((row) => ({ ...row, line: row.line + 1 })),
      ];
      const app = await listing(rows, "## TODOs\n- [ ] x\n- [ ] foo\n- [ ] foo #agent");
      // Another writer takes `x` out the moment the first press lands, before
      // the second reads the note: the pressed todo is now line 2, and line 3
      // holds the other one, word for word the same.
      saveNote.mockImplementationOnce(async (path: string, content: string) => {
        notes[path] = content.replace("- [ ] x\n", "");
        return { path, content };
      });

      await press(app, "j", "@", "@");

      expect.soft(app.notice()).toBe("Nothing moved: that line has changed since it was listed");
      expect(notes[PATH]).toBe("## TODOs\n- [ ] foo #agent\n- [ ] foo #agent");
    });
  });
});
