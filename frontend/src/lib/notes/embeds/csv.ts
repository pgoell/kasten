/**
 * A csv in the vault drawn as a table, in a note's `![[data.csv]]` and in a pane. Every cell goes
 * in as text, so nothing a cell holds is ever read as html.
 */

/** The most rows the table draws, the head row among them. */
export const ROW_CAP = 500;
/** The most columns the table draws: a 1 MiB file of commas would be a million cells in one row. */
export const COLUMN_CAP = 50;
/** The most of the file read: a bigger csv is a table nobody scrolls through in a note. */
export const BYTE_CAP = 1024 * 1024;

export interface Csv {
  /** The rows drawn, each cut to `COLUMN_CAP` cells. */
  rows: string[][];
  /** Every row the text read holds, past the cap too. */
  total: number;
  /** The most cells any row holds. */
  widest: number;
}

/** The separator a file uses: whichever of comma, semicolon and tab its first line holds most. */
function separatorOf(text: string): string {
  const counts = new Map([
    [",", 0],
    [";", 0],
    ["\t", 0],
  ]);
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === "\n" || char === "\r")) break;
    else if (!quoted && counts.has(char)) counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  let best = ",";
  for (const [char, count] of counts) if (count > (counts.get(best) ?? 0)) best = char;
  return best;
}

/** Collects cells into rows up to the caps, counting past them. */
class Rows {
  readonly rows: string[][] = [];
  total = 0;
  widest = 0;
  private row: string[] = [];
  private cells = 0;

  cell(text: string): void {
    if (this.rows.length < ROW_CAP && this.row.length < COLUMN_CAP) this.row.push(text);
    this.cells += 1;
  }

  /** Whether a row holds a cell `end` has not closed yet. */
  get open(): boolean {
    return this.cells > 0;
  }

  /** Ends the row the last `cell` closed. A blank line is no row, as a spreadsheet reads it. */
  end(): void {
    const blank = this.cells === 1 && this.row.length === 1 && this.row[0] === "";
    if (!blank) {
      this.widest = Math.max(this.widest, this.cells);
      if (this.rows.length < ROW_CAP) this.rows.push(this.row);
      this.total += 1;
    }
    this.row = [];
    this.cells = 0;
  }
}

/** The cell starting at `at`, and where the text after it starts. A quote held open runs to the end. */
function cellAt(text: string, at: number, separator: string): { cell: string; next: number } {
  if (text[at] !== '"') {
    let next = at;
    while (next < text.length && !"\r\n".includes(text[next] ?? "") && text[next] !== separator) {
      next++;
    }
    return { cell: text.slice(at, next), next };
  }
  let cell = "";
  let next = at + 1;
  for (;;) {
    const close = text.indexOf('"', next);
    if (close < 0) return { cell: cell + text.slice(next), next: text.length };
    cell += text.slice(next, close);
    if (text[close + 1] !== '"') {
      // Anything between the closing quote and the separator joins the cell, as Excel reads it.
      const rest = cellAt(text, close + 1, separator);
      return { cell: cell + rest.cell, next: rest.next };
    }
    cell += '"';
    next = close + 2;
  }
}

/**
 * Reads RFC 4180 text in one pass: quotes hold separators, line ends and `""` for a quote.
 * CRLF, LF and a lone CR each end a row.
 */
export function parseCsv(source: string): Csv {
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const separator = separatorOf(text);
  const found = new Rows();
  let at = 0;
  while (at < text.length) {
    const { cell, next } = cellAt(text, at, separator);
    found.cell(cell);
    at = next + 1;
    if (text[next] === separator) {
      // A separator at the very end leaves one more empty cell.
      if (at === text.length) found.cell("");
      continue;
    }
    if (text[next] === "\r" && text[at] === "\n") at++;
    found.end();
  }
  if (found.open) found.end();
  return { rows: found.rows, total: found.total, widest: found.widest };
}

/** The line under a cut table, or null when the table is whole. */
export function cutNote(csv: Csv, truncated: boolean): string | null {
  const parts: string[] = [];
  if (truncated) parts.push(`Showing the first ${csv.rows.length} rows: the file runs past 1 MiB.`);
  else if (csv.total > csv.rows.length)
    parts.push(`Showing ${csv.rows.length} of ${csv.total} rows.`);
  if (csv.widest > COLUMN_CAP) parts.push(`Showing ${COLUMN_CAP} of ${csv.widest} columns.`);
  return parts.length === 0 ? null : parts.join(" ");
}

/** Builds the table into `box` with `textContent` only. The first row is the head row. */
export function drawCsv(box: HTMLElement, csv: Csv, truncated: boolean): void {
  const scroll = document.createElement("div");
  scroll.className = "cm-table-scroll";
  const table = document.createElement("table");
  table.className = "cm-table-grid";
  const columns = Math.min(csv.widest, COLUMN_CAP);
  csv.rows.forEach((cells, index) => {
    const line = document.createElement("tr");
    // A short row gets empty cells, so every column stays under its heading.
    for (let column = 0; column < columns; column++) {
      const cell = document.createElement(index === 0 ? "th" : "td");
      cell.textContent = cells[column] ?? "";
      line.append(cell);
    }
    (index === 0 ? table.createTHead() : (table.tBodies[0] ?? table.createTBody())).append(line);
  });
  scroll.append(table);
  box.replaceChildren(scroll);
  const note = cutNote(csv, truncated);
  if (note !== null) {
    const cut = document.createElement("p");
    cut.className = "cm-csv-cut";
    cut.textContent = note;
    box.append(cut);
  }
}

/** Reads at most `BYTE_CAP` of the body, and whether the file went on past it. */
async function readHead(response: Response): Promise<{ text: string; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (reader === undefined) return { text: await response.text(), truncated: false };
  const decoder = new TextDecoder();
  let text = "";
  let read = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return { text: text + decoder.decode(), truncated: false };
    const room = BYTE_CAP - read;
    read += value.length;
    if (value.length > room) {
      void reader.cancel();
      text += decoder.decode(value.subarray(0, room));
      // The last line is cut somewhere inside, so it goes rather than draw half a row.
      const end = Math.max(text.lastIndexOf("\n"), text.lastIndexOf("\r"));
      return { text: end < 0 ? text : text.slice(0, end), truncated: true };
    }
    text += decoder.decode(value, { stream: true });
  }
}

/**
 * Fetches the csv at `url` and draws it into `box`, or a message when it cannot. `drawn` runs once
 * the box has its height. Returns what stops a read still under way.
 */
export function showCsv(
  box: HTMLElement,
  url: string,
  name: string,
  drawn: () => void,
): () => void {
  const stop = new AbortController();
  box.textContent = "Loading…";
  const fail = () => {
    if (stop.signal.aborted) return;
    box.classList.add("cm-embed-missing");
    box.textContent = `Not found: ${name}`;
    drawn();
  };
  fetch(url, { signal: stop.signal })
    .then(async (response) => {
      if (!response.ok) return fail();
      const { text, truncated } = await readHead(response);
      if (stop.signal.aborted) return;
      drawCsv(box, parseCsv(text), truncated);
      drawn();
    })
    // A dropped connection or the abort above: neither has anything to draw.
    .catch((error: unknown) => {
      if (error instanceof Error) fail();
      else throw error;
    });
  return () => stop.abort();
}
