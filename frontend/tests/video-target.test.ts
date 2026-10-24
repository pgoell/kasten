import { nextSeek, pressTarget, seekTarget, videoTarget } from "@/components/workspace-panes";
import { openTodosInFocused, openVideoBeside } from "@/lib/pane-contents";
import { emptyLayout, focusPane, type Layout, type Pane, tabPanes } from "@/lib/panes";

const NOTE = "lit/talk.md";
const OTHER = "lit/other.md";

/** The id of the first pane of the tab that `match` picks out. */
function idOf(layout: Layout, match: (pane: Pane) => boolean): string | undefined {
  return tabPanes(layout).find(match)?.id;
}

it("#791 A10 Space v with the focus in a todo pane plays the video pane on screen", () => {
  const beside = openVideoBeside(emptyLayout(NOTE), NOTE);
  const video = idOf(beside, (pane) => pane.video !== undefined);
  const note = idOf(beside, (pane) => pane.path === NOTE);
  const layout = openTodosInFocused(focusPane(beside, note ?? ""));

  expect(videoTarget(layout)).toBe(video);
});

it("#791 A10 Space v with the focus on a note plays the video of that note", () => {
  // Another note's video sits in the tab before this note's, so the first video
  // pane of the tab is not the one the key means.
  const beside = openVideoBeside(emptyLayout(NOTE), NOTE);
  const note = idOf(beside, (pane) => pane.path === NOTE);
  const both = openVideoBeside(focusPane(beside, note ?? ""), OTHER);
  const video = idOf(both, (pane) => pane.video === NOTE);

  expect(videoTarget(focusPane(both, note ?? ""))).toBe(video);
});

it("#791 A10 Space v with no video pane on screen has nothing to play", () => {
  expect(videoTarget(emptyLayout(NOTE))).toBeUndefined();
});

it("#791 A11 I6 a time asks for a seek when a video pane of the tab plays its note", () => {
  expect(seekTarget(openVideoBeside(emptyLayout(NOTE), NOTE), NOTE)).toBe(true);
});

it("#791 I6 a time with no video pane for its note asks for nothing", () => {
  expect(seekTarget(emptyLayout(NOTE), NOTE)).toBe(false);
});

it("#791 B a time's seek carries the video its take names", () => {
  const first = nextSeek({ note: "", seconds: 0, signal: 0 }, NOTE, 754, "iDulhoQ2pro");

  expect(first).toEqual({ note: NOTE, seconds: 754, id: "iDulhoQ2pro", signal: 1 });
});

/** Two video panes: OTHER's first, NOTE's after it, the focus on OTHER's. */
function twoVideos() {
  const beside = openVideoBeside(emptyLayout(NOTE), NOTE);
  const both = openVideoBeside(
    focusPane(beside, idOf(beside, (p) => p.path === NOTE) ?? ""),
    OTHER,
  );
  return {
    first: idOf(both, (p) => p.video === OTHER),
    second: idOf(both, (p) => p.video === NOTE),
    layout: both,
  };
}

it("#791 R7 a pane that becomes the target after a press does not play", () => {
  const { first, second, layout } = twoVideos();
  // The press is taken with NOTE's pane focused, then the focus moves to OTHER's.
  const pressed = pressTarget({ signal: 0, target: undefined }, 1, focusPane(layout, second ?? ""));
  const after = pressTarget(pressed, 1, focusPane(layout, first ?? ""));

  expect(pressed.target).toBe(second);
  expect(after.target).toBe(second);
  expect(after.target).not.toBe(first);
});

it("#791 R7 a press while a video pane is the target plays that pane", () => {
  const { first, layout } = twoVideos();

  expect(
    pressTarget({ signal: 0, target: undefined }, 1, focusPane(layout, first ?? "")).target,
  ).toBe(first);
});
