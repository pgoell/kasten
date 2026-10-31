import type { ComponentType, ReactElement } from "react";
import { expect, it, vi } from "vitest";
import { BookPane } from "@/components/book-pane";
import { ChatPane } from "@/components/chat-pane";
import { ExamPane } from "@/components/exam-pane";
import { FinancePane } from "@/components/finance-pane";
import { GraphPane } from "@/components/graph-pane";
import { HistoryPane } from "@/components/history-pane";
import { HtmlPane } from "@/components/html-pane";
import { ImagePane } from "@/components/image-pane";
import { LogPane } from "@/components/log-pane";
import { NotePane } from "@/components/note-pane";
import { OverviewPane } from "@/components/overview-pane";
import { PaneBody, type PaneExtras, type PaneShared } from "@/components/pane-body";
import { PdfPane } from "@/components/pdf-pane";
import { PersonPane } from "@/components/person-pane";
import { ReviewPane } from "@/components/review-pane";
import { TerminalPane } from "@/components/terminal-pane";
import { TodoPane } from "@/components/todo-pane";
import { VideoPane } from "@/components/video-pane";
import type { TreeCommands } from "@/lib/key-bindings";
import { type KindField, PANE_KINDS, type Pane } from "@/lib/pane-kinds";
import { stubCommands } from "./stub-commands";

/** What each kind draws, and which of the shared context it takes beyond `commands` and the focus. */
interface Expected {
  value: unknown;
  draws: ComponentType<never>;
  archive?: boolean;
  /** How the pane opens a note: with the hit's line, or the path alone. */
  open?: "line" | "path";
  notice?: boolean;
}

const EXPECTED: { [K in KindField]: Expected } = {
  path: { value: "a.md", draws: NotePane, archive: true, notice: true },
  term: { value: "main", draws: TerminalPane },
  todos: { value: true, draws: TodoPane, archive: true, open: "line", notice: true },
  log: { value: true, draws: LogPane, open: "line", notice: true },
  overview: { value: true, draws: OverviewPane, archive: true },
  finance: { value: true, draws: FinancePane, notice: true },
  book: { value: "b.md", draws: BookPane, archive: true, notice: true },
  exam: { value: "e.md", draws: ExamPane, open: "path" },
  review: { value: true, draws: ReviewPane, open: "line" },
  image: { value: "i.png", draws: ImagePane },
  pdf: { value: { path: "p.pdf", opened: 1 }, draws: PdfPane, archive: true },
  html: { value: "h.html", draws: HtmlPane, archive: true },
  video: { value: "v.md", draws: VideoPane, archive: true },
  person: { value: "p.md", draws: PersonPane, archive: true, open: "line" },
  history: { value: "n.md", draws: HistoryPane },
  graph: { value: { around: "a.md" }, draws: GraphPane, archive: true, open: "line" },
  chat: { value: true, draws: ChatPane },
};

function shared(): PaneShared {
  return {
    commands: stubCommands() as unknown as TreeCommands,
    focusSignal: 7,
    archive: true,
    openInPane: vi.fn(),
    onNotice: vi.fn(),
  };
}

const extras = {
  paths: [],
  listings: {},
  opening: {},
  writes: {},
  todos: {},
  buffer: {},
  autosave: {},
  graphAsk: { pane: "", signal: 0 },
  rsvpAsk: { pane: "", signal: 0 },
  video: { playFor: () => 0, seekFor: () => undefined, seek: vi.fn() },
} as unknown as PaneExtras;

function draw(kind: KindField, focused: boolean, context: PaneShared) {
  const shown = { id: "pane-1", [kind]: EXPECTED[kind].value } as Pane;
  return PaneBody({ shown, focused, shared: context, extras }) as ReactElement<
    Record<string, unknown>
  >;
}

it.each(Object.keys(PANE_KINDS) as KindField[])(
  "#980 A1 PaneBody draws the %s pane's component with the shared context",
  (kind) => {
    const expected = EXPECTED[kind];
    const context = shared();
    const element = draw(kind, true, context);
    const props = element.props;

    expect(element.type).toBe(expected.draws);
    expect(props.commands).toBe(context.commands);
    expect(props.focusSignal).toBe(7);
    expect(props.archive).toBe(expected.archive === true ? true : undefined);
    if (expected.notice) expect(props.onNotice).toBe(context.onNotice);
    if (expected.open !== undefined) {
      (props.onOpen as (path: string, line?: number) => void)("x.md", 3);
      expect(context.openInPane).toHaveBeenCalledWith(
        ...(expected.open === "line" ? ["x.md", 3] : ["x.md"]),
      );
    }
  },
);

it.each(Object.keys(PANE_KINDS) as KindField[])(
  "#980 I5 an unfocused %s pane gets the focus signal only where it did before",
  (kind) => {
    const props = draw(kind, false, shared()).props;

    // The note pane takes the raw signal with `focused` and decides itself.
    expect(props.focusSignal).toBe(kind === "path" ? 7 : 0);
  },
);

it("#980 I6 an empty pane draws the note pane, which shows Today", () => {
  const context = shared();
  const element = PaneBody({ shown: { id: "pane-1" }, focused: true, shared: context, extras });

  expect((element as ReactElement).type).toBe(NotePane);
});
