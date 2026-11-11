/** The block notes from `GET /api/training/blocks`, read, and the one that holds a given day. */

import { client } from "@/lib/core/api-client";
import { shiftDay } from "@/lib/core/clock";
import {
  type Block,
  endOf,
  parseBlock,
  weekIndex,
  weeklyCardio,
} from "@/lib/log/training/block/block-note";

export interface HeldBlock {
  path: string;
  text: string;
  block: Block;
}

/** Every block note that reads, by start. A note whose start is no date is left out. */
export async function fetchBlocks(): Promise<HeldBlock[]> {
  const { data, response } = await client.GET("/api/training/blocks");
  if (!data) throw new Error(`GET /api/training/blocks failed with ${response.status}`);
  return data.flatMap(({ path, text }) => {
    const block = parseBlock(text);
    return block === null ? [] : [{ path, text, block }];
  });
}

/** The block that holds `date`; of two that overlap, the later start wins. */
export function blockOn<T extends { block: Block }>(blocks: T[], date: string): T | null {
  return blocks.filter((held) => weekIndex(held.block, date) !== null).at(-1) ?? null;
}

/** Whether a block starts after `block` ends, so the next one is already planned. */
export function hasNext(blocks: { block: Block }[], block: Block): boolean {
  const end = endOf(block);
  return blocks.some((held) => held.block.start > end);
}

/** Per week start, whether a block marks it a deload, and the weekly cardio it asks for. */
export function blockWeeks(
  blocks: { block: Block }[],
  starts: string[],
): { deload: boolean | null; cardio: number | null }[] {
  return starts.map((monday) => {
    // A block need not start on a Monday, so any day of the week inside it counts.
    const day = [0, 1, 2, 3, 4, 5, 6]
      .map((offset) => shiftDay(monday, offset))
      .find((date) => blockOn(blocks, date) !== null);
    const held = day === undefined ? null : blockOn(blocks, day);
    if (day === undefined || held === null) return { deload: null, cardio: null };
    const week = weekIndex(held.block, day) ?? 0;
    return { deload: held.block.weeks[week]?.deload === true, cardio: weeklyCardio(held.block) };
  });
}
