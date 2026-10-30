/**
 * A deck's cards, parsed off the main thread so a 1 MB deck's open is no long task on a phone (#1359).
 * The same `cardsRead` the sitting runs, so both read the same cards at the same lines.
 */

import type { Deck } from "@/lib/review/review";
import { cardsRead } from "@/lib/review/review-queue";

self.onmessage = ({ data }: MessageEvent<{ deck: Deck; texts: [string, string][] }>) => {
  self.postMessage([...cardsRead(data.deck, new Map(data.texts))]);
};
