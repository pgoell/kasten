import { unstamped } from "@/lib/held-text";

const LIMIT = 1_000_000;

export interface DiffLine {
  /** `-` a line only the vault has, `+` a line only mine has. */
  op: " " | "-" | "+";
  text: string;
}

/**
 * The vault's text against the reader's, line by line. Skips the `modified` stamp, which
 * the backend rewrites on every write and would show as a change nobody made.
 */
export function lineDiff(vault: string, mine: string): DiffLine[] {
  const a = unstamped(vault).split("\n");
  const b = unstamped(mine).split("\n");
  const head = sameHead(a, b);
  const tail = sameTail(a, b, head);
  const x = a.slice(head, a.length - tail);
  const y = b.slice(head, b.length - tail);
  const same = (text: string): DiffLine => ({ op: " ", text });
  const ends = (middle: DiffLine[]) => [
    ...a.slice(0, head).map(same),
    ...middle,
    ...a.slice(a.length - tail).map(same),
  ];
  // Past a million cells the table costs more memory than a coarse diff is worth.
  if (x.length * y.length > LIMIT) {
    return ends([
      ...x.map((text) => ({ op: "-" as const, text })),
      ...y.map((text) => ({ op: "+" as const, text })),
    ]);
  }
  return ends(middleDiff(x, y));
}

function sameHead(a: string[], b: string[]): number {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  return head;
}

function sameTail(a: string[], b: string[], head: number): number {
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  )
    tail++;
  return tail;
}

/** The longest common run from each `x[i]`, `y[j]` onwards. */
function lcsTable(x: string[], y: string[]): (i: number, j: number) => number {
  const width = y.length + 1;
  const table = new Array<number>((x.length + 1) * width).fill(0);
  const lcs = (i: number, j: number) => table[i * width + j] ?? 0;
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--)
      table[i * width + j] =
        x[i] === y[j] ? lcs(i + 1, j + 1) + 1 : Math.max(lcs(i + 1, j), lcs(i, j + 1));
  return lcs;
}

function middleDiff(x: string[], y: string[]): DiffLine[] {
  const lcs = lcsTable(x, y);
  const middle: DiffLine[] = [];
  let i = 0;
  let j = 0;
  for (;;) {
    const theirs = x[i];
    const ours = y[j];
    if (theirs === undefined && ours === undefined) break;
    if (theirs !== undefined && theirs === ours) {
      middle.push({ op: " ", text: theirs });
      i++;
      j++;
    } else if (theirs !== undefined && (ours === undefined || lcs(i + 1, j) >= lcs(i, j + 1))) {
      // The vault's line before mine on a tie, the order a reader expects.
      middle.push({ op: "-", text: theirs });
      i++;
    } else if (ours !== undefined) {
      middle.push({ op: "+", text: ours });
      j++;
    }
  }
  return middle;
}
