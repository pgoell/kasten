import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { openBeside } from "@/lib/pane-contents";
import { emptyLayout, type Layout, tabPanes } from "@/lib/panes";
import { usePaneCommands } from "@/lib/use-pane-commands";
import { useVideoAsks } from "@/lib/video/use-video-player";

const NOTE = "lit/talk.md";
const OTHER = "lit/other.md";
const client = new QueryClient();

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** The pane commands and the video asks wired as the route wires them, over `layout`. */
function wired(layout: Layout, onNotice = vi.fn()) {
  return renderHook(
    () => {
      const { playSignal, commands } = usePaneCommands({
        pane: { id: "pane-1", path: NOTE },
        setLayout: vi.fn(),
        saveFirst: async () => true,
        moves: { moveTo: vi.fn(), focusToward: vi.fn(), shiftToward: vi.fn() },
        openPeriodic: vi.fn(),
        setNotice: vi.fn(),
        paths: [],
        focusedNote: { current: { path: NOTE, isWriting: () => false } },
      });
      return { commands, asks: useVideoAsks(layout, playSignal, onNotice) };
    },
    { wrapper },
  );
}

const beside = openBeside(emptyLayout(NOTE), (pane) => pane.video === NOTE, { video: NOTE }, "col");
const ids = tabPanes(beside).map((each) => each.id);

it("#980 A3 <leader>v plays the video pane through the video module, and no other pane", () => {
  const { result } = wired(beside);
  const [note, video] = ids;

  act(() => result.current.commands.toggleVideo());

  expect(result.current.asks.playFor(video ?? "")).toBe(1);
  expect(result.current.asks.playFor(note ?? "")).toBe(0);
});

it("#980 A3 a time's seek reaches the video pane of its note through the video module", () => {
  const { result } = wired(beside);

  act(() => result.current.asks.seek(NOTE, 31, "iDulhoQ2pro"));

  expect(result.current.asks.seekFor(NOTE)).toEqual({ seconds: 31, signal: 1, id: "iDulhoQ2pro" });
  expect(result.current.asks.seekFor(OTHER)).toBeUndefined();
});

it("#980 I4 a time with no player open says so and seeks nothing", () => {
  const onNotice = vi.fn();
  const { result } = wired(beside, onNotice);

  act(() => result.current.asks.seek(OTHER, 31));

  expect(onNotice).toHaveBeenCalledWith("No player is open for this note: Space g v opens it");
  expect(result.current.asks.seekFor(OTHER)).toBeUndefined();
});
