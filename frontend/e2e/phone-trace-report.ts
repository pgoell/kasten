/**
 * The report for the traces `e2e/phone-trace.ts` writes (#934).
 *
 * `bun e2e/phone-trace-report.ts new old` reads every `traces/new*.json` and
 * `traces/old*.json` (not the `.meta.json` beside each) and prints one table per
 * prefix: its runs, their mean, the forced layouts by source line, and the
 * first-load JS. The numbers are read on the renderer main thread, between the
 * `<step>:start` and `<step>:end` marks the trace script set.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";

interface Frame {
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
  functionName?: string;
}

interface Ev {
  name?: string;
  cat?: string;
  ph?: string;
  ts?: number;
  dur?: number;
  pid?: number;
  tid?: number;
  args?: { name?: string; beginData?: { stackTrace?: Frame[] } };
}

interface Meta {
  label: string;
  dist: string;
  firstLoadJsGzip: number;
  firstLoadJsRaw: number;
  firstLoadJsFiles: number;
}

type Step = "tab" | "open" | "type" | "rest";
const STEPS: Step[] = ["tab", "open", "type", "rest"];

/** The events a script run is made of. Only the top of each nesting counts. */
const SCRIPT = new Set([
  "FunctionCall",
  "EvaluateScript",
  "FireAnimationFrame",
  "TimerFire",
  "EventDispatch",
  "v8.compile",
  "v8.compileModule",
]);

/** A task longer than this, in microseconds, is a long task. */
const LONG_US = 50_000;

const TRACES = path.join(import.meta.dirname, "../traces");

interface Cell {
  longCount: number;
  longMs: number;
  slowMs: number;
  scriptMs: number;
  layoutMs: number;
  styleMs: number;
  forced: number;
  forcedMs: number;
  fire: number;
}

interface Caller {
  count: number;
  ms: number;
}

interface Run {
  meta: Meta;
  cells: Record<Step, Cell>;
  callers: Record<Step, Map<string, Caller>>;
}

interface Lane {
  /** The renderer main thread's events. */
  main: Ev[];
  /** Every event of that renderer process, for the frames it draws. */
  pidEvents: Ev[];
  taskName: string;
  frameName: string;
}

interface Place {
  text: string;
  inSrc: boolean;
}

/** Where a stack frame sits in the source, through the build's map for its file. */
function locate(frame: Frame, dist: string, maps: Map<string, TraceMap | null>): Place {
  const url = frame.url ?? "";
  const line = (frame.lineNumber ?? 0) + 1;
  const raw = {
    text: `${url || "(native)"}:${line} ${frame.functionName ?? ""}`.trim(),
    inSrc: false,
  };
  if (url === "") return raw;

  const file = path.join(dist, "assets", `${path.basename(new URL(url).pathname)}.map`);
  const map = mapFor(file, maps);
  if (map === null) return raw;
  const at = originalPositionFor(map, { line, column: frame.columnNumber ?? 0 });
  if (at.source === null) return raw;

  const source = at.source.replace(/^(\.\.\/)+/, "");
  return {
    text: `${source}:${at.line} ${at.name ?? frame.functionName ?? ""}`.trim(),
    inSrc: source.startsWith("src/") && !source.includes("node_modules"),
  };
}

function mapFor(file: string, maps: Map<string, TraceMap | null>): TraceMap | null {
  const known = maps.get(file);
  if (known !== undefined) return known;
  const map = existsSync(file) ? new TraceMap(readFileSync(file, "utf8")) : null;
  maps.set(file, map);
  return map;
}

/** The first frame in our own source, else the top frame, named as the source map names it. */
function caller(stack: Frame[], dist: string, maps: Map<string, TraceMap | null>): string {
  const places = stack.map((frame) => locate(frame, dist, maps));
  return (places.find((place) => place.inSrc) ?? places[0])?.text ?? "(none)";
}

/** The microseconds of the union of the script events in a window, nested ones counted once. */
function scriptUs(main: Ev[], start: number, end: number): number {
  const spans = main
    .filter((e) => SCRIPT.has(e.name ?? "") && e.dur !== undefined)
    .map((e) => [Math.max(e.ts ?? 0, start), Math.min((e.ts ?? 0) + (e.dur ?? 0), end)] as const)
    .filter(([from, to]) => to > from)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let reach = Number.NEGATIVE_INFINITY;
  for (const [from, to] of spans) {
    total += Math.max(0, to - Math.max(from, reach));
    reach = Math.max(reach, to);
  }
  return total;
}

/** The longest gap between consecutive frame events in a window, in microseconds. */
function longestGapUs(times: number[]): number {
  const sorted = [...times].sort((a, b) => a - b);
  let gap = 0;
  for (let i = 1; i < sorted.length; i++) {
    gap = Math.max(gap, (sorted[i] ?? 0) - (sorted[i - 1] ?? 0));
  }
  return gap;
}

const sumDur = (events: Ev[]) => events.reduce((total, e) => total + (e.dur ?? 0), 0);

/** The microseconds of each mark the script set, by name. */
function markTimes(events: Ev[]): Map<string, number> {
  const marks = new Map<string, number>();
  for (const e of events) {
    if (e.cat?.includes("user_timing") && e.name?.includes(":") && e.ts !== undefined) {
      marks.set(e.name ?? "", e.ts);
    }
  }
  return marks;
}

/** The renderer main thread of the process that holds the marks, with what the process drew. */
function laneOf(events: Ev[], label: string): Lane {
  const pid = events.find((e) => e.cat?.includes("user_timing") && e.name === "tab:start")?.pid;
  const tid = events.find(
    (e) =>
      e.ph === "M" &&
      e.name === "thread_name" &&
      e.pid === pid &&
      e.args?.name === "CrRendererMain",
  )?.tid;
  if (pid === undefined || tid === undefined) {
    console.error(`${label}: no CrRendererMain thread beside the tab:start mark`);
    process.exit(1);
  }
  const main = events.filter((e) => e.pid === pid && e.tid === tid);
  const pidEvents = events.filter((e) => e.pid === pid);
  return {
    main,
    pidEvents,
    taskName: main.some((e) => e.name === "RunTask") ? "RunTask" : "ThreadControllerImpl::RunTask",
    frameName: pidEvents.some((e) => e.name === "DrawFrame") ? "DrawFrame" : "BeginFrame",
  };
}

/** The forced layouts of a window, by the source line that asked for each. */
function callersOf(
  forced: Ev[],
  dist: string,
  maps: Map<string, TraceMap | null>,
): Map<string, Caller> {
  const byCaller = new Map<string, Caller>();
  for (const e of forced) {
    const key = caller(e.args?.beginData?.stackTrace ?? [], dist, maps);
    const seen = byCaller.get(key) ?? { count: 0, ms: 0 };
    byCaller.set(key, { count: seen.count + 1, ms: seen.ms + (e.dur ?? 0) / 1000 });
  }
  return byCaller;
}

/** One step's numbers, cut to the window between its two marks. */
function stepOf(
  lane: Lane,
  window: [number, number],
  dist: string,
  maps: Map<string, TraceMap | null>,
): { cell: Cell; callers: Map<string, Caller> } {
  const [start, end] = window;
  const within = (e: Ev) => (e.ts ?? 0) >= start && (e.ts ?? 0) < end;
  const named = (name: string) => lane.main.filter((e) => e.name === name && within(e));

  const tasks = named(lane.taskName).filter((e) => (e.dur ?? 0) > LONG_US);
  const frames = lane.pidEvents
    .filter((e) => e.name === lane.frameName && within(e))
    .map((e) => e.ts ?? 0);
  const forced = named("Layout").filter((e) => (e.args?.beginData?.stackTrace?.length ?? 0) > 0);

  const cell: Cell = {
    longCount: tasks.length,
    longMs: sumDur(tasks) / 1000,
    slowMs: longestGapUs(frames) / 1000,
    scriptMs: scriptUs(lane.main, start, end) / 1000,
    layoutMs: sumDur(named("Layout")) / 1000,
    styleMs: (sumDur(named("UpdateLayoutTree")) + sumDur(named("RecalculateStyles"))) / 1000,
    forced: forced.length,
    forcedMs: sumDur(forced) / 1000,
    fire: named("FireAnimationFrame").length,
  };
  return { cell, callers: callersOf(forced, dist, maps) };
}

function analyse(events: Ev[], meta: Meta): Run {
  const marks = markTimes(events);
  const lane = laneOf(events, meta.label);
  const maps = new Map<string, TraceMap | null>();
  const cells = {} as Record<Step, Cell>;
  const callers = {} as Record<Step, Map<string, Caller>>;

  for (const step of STEPS) {
    const start = marks.get(`${step}:start`);
    const end = marks.get(`${step}:end`);
    if (start === undefined || end === undefined) {
      console.error(`${meta.label}: marks ${step}:start and ${step}:end are not both in the trace`);
      process.exit(1);
    }
    const found = stepOf(lane, [start, end], meta.dist, maps);
    cells[step] = found.cell;
    callers[step] = found.callers;
  }

  reportMissing(events, meta.label);
  return { meta, cells, callers };
}

/** Names the trace has none of, so a zero in the table is not taken for a measurement. */
function reportMissing(events: Ev[], label: string): void {
  const groups: string[][] = [
    ["RunTask", "ThreadControllerImpl::RunTask"],
    ["DrawFrame", "BeginFrame"],
    ["Layout"],
    ["UpdateLayoutTree"],
    ["FireAnimationFrame"],
  ];
  for (const names of groups) {
    if (!events.some((e) => names.includes(e.name ?? ""))) {
      console.log(`missing event ${names.join(" or ")} in ${label}`);
    }
  }
  const layouts = events.filter((e) => e.name === "Layout");
  const stacked = layouts.filter((e) => (e.args?.beginData?.stackTrace?.length ?? 0) > 0);
  console.log(`${label}: Layout events ${layouts.length}, with a stack trace ${stacked.length}`);
}

async function loadRun(base: string): Promise<Run> {
  const meta = JSON.parse(readFileSync(path.join(TRACES, `${base}.meta.json`), "utf8")) as Meta;
  const json = (await Bun.file(path.join(TRACES, `${base}.json`)).json()) as
    | { traceEvents?: Ev[] }
    | Ev[];
  const events = Array.isArray(json) ? json : (json.traceEvents ?? []);
  return analyse(events, meta);
}

const ROWS: { key: keyof Cell; label: string; digits: number }[] = [
  { key: "longCount", label: "long tasks over 50 ms (count)", digits: 0 },
  { key: "longMs", label: "long tasks over 50 ms (total ms)", digits: 1 },
  { key: "slowMs", label: "slowest frame gap (ms)", digits: 1 },
  { key: "scriptMs", label: "scripting (ms)", digits: 1 },
  { key: "layoutMs", label: "layout (ms)", digits: 1 },
  { key: "styleMs", label: "style (ms)", digits: 1 },
  { key: "forced", label: "forced layouts (count)", digits: 0 },
  { key: "forcedMs", label: "forced layouts (ms)", digits: 1 },
  { key: "fire", label: "FireAnimationFrame (count)", digits: 0 },
];

const mean = (values: number[]) => values.reduce((total, v) => total + v, 0) / values.length;

function printRows(runs: Run[]): void {
  const labels = runs.map((run) => run.meta.label);
  console.log(`| step | metric | ${labels.join(" | ")} | mean |`);
  console.log(`|---|---|${labels.map(() => "---:").join("|")}|---:|`);
  for (const step of STEPS) {
    for (const row of ROWS) {
      if (row.key === "fire" && step !== "rest") continue;
      const values = runs.map((run) => run.cells[step][row.key]);
      const cells = values.map((v) => v.toFixed(row.digits)).join(" | ");
      console.log(`| ${step} | ${row.label} | ${cells} | ${mean(values).toFixed(row.digits)} |`);
    }
  }
}

/** Each step's top callers, summed over the runs. */
function printCallers(runs: Run[]): void {
  console.log("\nForced layout callers (counts and ms summed over the runs):\n");
  for (const step of STEPS) {
    const total = new Map<string, Caller>();
    for (const run of runs) {
      for (const [key, value] of run.callers[step]) {
        const seen = total.get(key) ?? { count: 0, ms: 0 };
        total.set(key, { count: seen.count + value.count, ms: seen.ms + value.ms });
      }
    }
    console.log(`- ${step}:`);
    const top = [...total].sort((a, b) => b[1].count - a[1].count).slice(0, 5);
    if (top.length === 0) console.log("  - none");
    for (const [key, value] of top) {
      console.log(`  - ${value.count}x, ${value.ms.toFixed(1)} ms: ${key}`);
    }
  }
}

function printFirstLoad(runs: Run[]): void {
  console.log("\n| run | first-load JS gzip KB | first-load JS raw KB | JS files |");
  console.log("|---|---:|---:|---:|");
  const kb = (bytes: number) => (bytes / 1024).toFixed(1);
  for (const { meta } of runs) {
    console.log(
      `| ${meta.label} | ${kb(meta.firstLoadJsGzip)} | ${kb(meta.firstLoadJsRaw)} | ${meta.firstLoadJsFiles} |`,
    );
  }
  const metas = runs.map((run) => run.meta);
  const gzip = mean(metas.map((m) => m.firstLoadJsGzip));
  const raw = mean(metas.map((m) => m.firstLoadJsRaw));
  const files = mean(metas.map((m) => m.firstLoadJsFiles));
  console.log(`| mean | ${kb(gzip)} | ${kb(raw)} | ${files.toFixed(1)} |`);
}

function printPrefix(prefix: string, runs: Run[]): void {
  console.log(`\n## ${prefix}\n`);
  printRows(runs);
  printCallers(runs);
  printFirstLoad(runs);
}

const prefixes = process.argv.slice(2);
if (prefixes.length === 0) {
  console.error("usage: bun e2e/phone-trace-report.ts <label prefix> [...]");
  process.exit(1);
}

const files = readdirSync(TRACES);
for (const prefix of prefixes) {
  const bases = files
    .filter(
      (file) => file.startsWith(prefix) && file.endsWith(".json") && !file.endsWith(".meta.json"),
    )
    .map((file) => file.slice(0, -".json".length))
    .sort();
  if (bases.length === 0) {
    console.error(`no traces/${prefix}*.json`);
    process.exit(1);
  }
  const runs: Run[] = [];
  for (const base of bases) runs.push(await loadRun(base));
  printPrefix(prefix, runs);
}
