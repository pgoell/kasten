/**
 * What the long tasks of the `tab` and `open` steps ran (#972): their style, the
 * invalidations behind it, their script, their layouts and their handlers.
 *
 * `phone-trace-report.ts` cuts each step's window and prints the report. This module
 * reads what is inside the windows. It is a file of its own so that neither file
 * passes the size limit. It takes `locate` and `caller` as arguments, so it does not
 * import the report at run time.
 */
import type { CpuNode, Data, Ev, Frame, Lane, Place } from "./phone-trace-report";

/** A task longer than this, in microseconds, is a long task. */
export const LONG_US = 50_000;

/** The events that say why a style was invalidated, and on which node. */
const INVALIDATIONS = new Set([
  "StyleRecalcInvalidationTracking",
  "ScheduleStyleInvalidationTracking",
  "StyleInvalidatorInvalidationTracking",
]);

/** A count of events under one key: their summed ms, their elements and the nodes they hit. */
export interface Stat {
  count: number;
  ms: number;
  elements: number;
  maxElements: number;
  nodes: Map<string, number>;
}

export type Tally = Map<string, Stat>;

/** What the long tasks of one step ran, cut out of one run. */
export interface Work {
  tasks: { startMs: number; durMs: number }[];
  style: Stat;
  styleCallers: Tally;
  invalidations: Tally;
  selfTime: Tally;
  ownSource: Tally;
  layout: Stat;
  calls: { text: string; ms: number }[];
}

/** One CPU profile sample, lasting until the next one, with its frame and its first `src/` frame. */
interface Sample {
  ts: number;
  durUs: number;
  self: string;
  inSource: string | null;
}

export type WorkStep = "tab" | "open";
export const WORK_STEPS: WorkStep[] = ["tab", "open"];

type Locate = (frame: Frame) => Place;
type CallerOf = (stack: Frame[]) => string;

const blank = (): Stat => ({ count: 0, ms: 0, elements: 0, maxElements: 0, nodes: new Map() });

function emptyWork(): Work {
  return {
    tasks: [],
    style: blank(),
    styleCallers: new Map(),
    invalidations: new Map(),
    selfTime: new Map(),
    ownSource: new Map(),
    layout: blank(),
    calls: [],
  };
}

/** Counts one event into a stat: its ms, its element count and the node it hit, if any. */
function record(stat: Stat, ms: number, elements = 0, nodeName = ""): void {
  stat.count += 1;
  stat.ms += ms;
  stat.elements += elements;
  stat.maxElements = Math.max(stat.maxElements, elements);
  if (nodeName !== "") stat.nodes.set(nodeName, (stat.nodes.get(nodeName) ?? 0) + 1);
}

function recordIn(tally: Tally, key: string, ms: number, elements = 0, nodeName = ""): void {
  const stat = tally.get(key) ?? blank();
  record(stat, ms, elements, nodeName);
  tally.set(key, stat);
}

/** Adds one stat into another, so the runs of a prefix sum into one. */
function absorb(into: Stat, from: Stat): void {
  into.count += from.count;
  into.ms += from.ms;
  into.elements += from.elements;
  into.maxElements = Math.max(into.maxElements, from.maxElements);
  for (const [name, n] of from.nodes) into.nodes.set(name, (into.nodes.get(name) ?? 0) + n);
}

function absorbTally(into: Tally, from: Tally): void {
  for (const [key, stat] of from) {
    const seen = into.get(key) ?? blank();
    absorb(seen, stat);
    into.set(key, seen);
  }
}

/**
 * A CDP call frame as a trace stack frame. V8 counts lines and columns from 0 and a
 * trace stack from 1, so both are shifted up here before `locate` reads them. This is
 * for the CPU profile only: the `FunctionCall` data is already 1-based.
 */
function oneBased(frame: Frame): Frame {
  return {
    ...frame,
    lineNumber: (frame.lineNumber ?? 0) + 1,
    columnNumber: (frame.columnNumber ?? 0) + 1,
  };
}

interface Timed {
  ts: number;
  node: CpuNode;
  profile: Map<number, CpuNode>;
}

/**
 * The renderer's CPU profile samples in time order. A sample's time is the profile's
 * start plus the running sum of the deltas.
 */
/** The start time of each profile, from its `Profile` event. */
function startsOf(events: Ev[]): Map<string, number> {
  const starts = new Map<string, number>();
  for (const e of events) {
    const startTime = e.args?.data?.startTime;
    if (e.name === "Profile" && e.id !== undefined && startTime !== undefined) {
      starts.set(e.id, startTime);
    }
  }
  return starts;
}

function timedSamples(events: Ev[]): Timed[] {
  const starts = startsOf(events);

  // The chunks of one profile come in time order, but not necessarily in file order.
  const chunks = events
    .filter((e) => e.name === "ProfileChunk" && e.id !== undefined)
    .sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
  const nodes = new Map<string, Map<number, CpuNode>>();
  const times = new Map<string, number>();
  const timed: Timed[] = [];
  for (const chunk of chunks) {
    const id = chunk.id ?? "";
    const profile = nodes.get(id) ?? new Map<number, CpuNode>();
    nodes.set(id, profile);
    for (const node of chunk.args?.data?.cpuProfile?.nodes ?? []) profile.set(node.id, node);
    let time = times.get(id) ?? starts.get(id) ?? 0;
    const deltas = chunk.args?.data?.timeDeltas ?? [];
    for (const [i, nodeId] of (chunk.args?.data?.cpuProfile?.samples ?? []).entries()) {
      time += deltas[i] ?? 0;
      const node = profile.get(nodeId);
      if (node !== undefined) timed.push({ ts: time, node, profile });
    }
    times.set(id, time);
  }

  return timed;
}

/**
 * Every sample, with its frame and its first `src/` frame, in time order. A sample lasts
 * until the next one. A node is located once, and its first `src/` frame is the nearest
 * one up its chain, itself included.
 */
export function samplesOf(events: Ev[], locate: Locate): Sample[] {
  const timed = timedSamples(events);
  const memo = new Map<CpuNode, { self: string; inSource: string | null }>();
  const resolve = (node: CpuNode, profile: Map<number, CpuNode>) => {
    const known = memo.get(node);
    if (known !== undefined) return known;
    const place = locate(oneBased(node.callFrame));
    const parent = node.parent === undefined ? undefined : profile.get(node.parent);
    const above = parent === undefined ? null : resolve(parent, profile).inSource;
    const found = { self: place.text, inSource: place.inSrc ? place.text : above };
    memo.set(node, found);
    return found;
  };

  return timed.map((sample, i) => {
    const next = timed[i + 1];
    const found = resolve(sample.node, sample.profile);
    return {
      ts: sample.ts,
      durUs: next === undefined ? 0 : next.ts - sample.ts,
      self: found.self,
      inSource: found.inSource,
    };
  });
}

/** The part of an invalidation's key that names what changed. */
function selectorOf(data: Data | undefined): string {
  return (
    data?.selectors?.[0]?.selector ||
    data?.changedClass ||
    data?.changedAttribute ||
    data?.changedPseudo ||
    data?.selectorPart ||
    data?.invalidatedSelectorId ||
    "(none)"
  );
}

/** Adds one event inside a long task to the work it belongs to. */
function tallyEvent(e: Ev, work: Work, locate: Locate, callerOf: CallerOf): void {
  const ms = (e.dur ?? 0) / 1000;
  const data = e.args?.data;
  if (e.name === "UpdateLayoutTree" || e.name === "RecalculateStyles") {
    const elements = e.args?.elementCount ?? 0;
    record(work.style, ms, elements);
    const stack = e.args?.beginData?.stackTrace ?? [];
    if (stack.length > 0) recordIn(work.styleCallers, callerOf(stack), ms, elements);
  } else if (e.name === "Layout") {
    record(work.layout, ms);
  } else if (INVALIDATIONS.has(e.name ?? "")) {
    // `invalidatedSelectorId` holds the kind ("class", "attribute"), not the name, so
    // the name comes from the `changed*` field beside it.
    const key = `${data?.reason ?? e.name} | ${selectorOf(data)}`;
    recordIn(work.invalidations, key, 0, 0, data?.nodeName ?? "");
  } else if (e.name === "FunctionCall") {
    // Unlike the profile, a FunctionCall's line and column are already 1-based.
    work.calls.push({ text: data === undefined ? "(none)" : locate(data).text, ms });
  }
}

/** Adds the samples inside a long task, each to its own frame and to its first `src/` frame. */
function addSamples(work: Work, samples: Sample[], from: number, to: number): void {
  for (const sample of samples) {
    if (sample.ts < from || sample.ts >= to) continue;
    recordIn(work.selfTime, sample.self, sample.durUs / 1000);
    if (sample.inSource !== null) recordIn(work.ownSource, sample.inSource, sample.durUs / 1000);
  }
}

/** What the long tasks that start in a window ran, read from the renderer main thread. */
export function workOf(
  lane: Lane,
  window: [number, number],
  samples: Sample[],
  locate: Locate,
  callerOf: CallerOf,
): Work {
  const [start, end] = window;
  const work = emptyWork();
  const tasks = lane.main.filter(
    (e) => e.name === lane.taskName && (e.ts ?? 0) >= start && (e.ts ?? 0) < end,
  );
  for (const task of tasks.filter((e) => (e.dur ?? 0) > LONG_US)) {
    const from = task.ts ?? 0;
    const to = from + (task.dur ?? 0);
    work.tasks.push({ startMs: (from - start) / 1000, durMs: (task.dur ?? 0) / 1000 });

    for (const e of lane.main) {
      if ((e.ts ?? 0) >= from && (e.ts ?? 0) < to) tallyEvent(e, work, locate, callerOf);
    }
    addSamples(work, samples, from, to);
  }
  return work;
}

/** The `n` biggest entries of a tally by one measure, biggest first. */
function top(tally: Tally, by: (stat: Stat) => number, n = Number.POSITIVE_INFINITY) {
  return [...tally].sort((a, b) => by(b[1]) - by(a[1])).slice(0, n);
}

/** The node name an invalidation hit most often, with its count. */
function topNode(stat: Stat): string {
  const best = [...stat.nodes].sort((a, b) => b[1] - a[1])[0];
  return best === undefined ? "none" : `${best[0]} (${best[1]}x)`;
}

function printList(rows: string[]): void {
  if (rows.length === 0) console.log("  - none");
  for (const row of rows) console.log(`  - ${row}`);
}

/** The long tasks of each step, run by run, then what they ran summed over the runs. */
export function printWork(runs: { label: string; work: Record<WorkStep, Work> }[]): void {
  for (const step of WORK_STEPS) {
    console.log(`\n### What runs in the long tasks: ${step}\n`);
    for (const run of runs) {
      const { tasks } = run.work[step];
      const spans = tasks.map((t) => `+${t.startMs.toFixed(1)} ms for ${t.durMs.toFixed(1)} ms`);
      console.log(`- ${run.label}: ${tasks.length} long tasks: ${spans.join("; ") || "none"}`);
    }

    const total = emptyWork();
    for (const run of runs) {
      const work = run.work[step];
      absorb(total.style, work.style);
      absorbTally(total.styleCallers, work.styleCallers);
      absorbTally(total.invalidations, work.invalidations);
      absorbTally(total.selfTime, work.selfTime);
      absorbTally(total.ownSource, work.ownSource);
      absorb(total.layout, work.layout);
      total.calls.push(...work.calls);
    }

    const { style, layout } = total;
    console.log("\n- style, UpdateLayoutTree and RecalculateStyles together:");
    console.log(
      `  - ${style.count}x, ${style.ms.toFixed(1)} ms, elements ${style.elements} sum, ${style.maxElements} max`,
    );
    console.log("- style by caller, for the events that carry a stack:");
    printList(
      top(total.styleCallers, (s) => s.ms).map(
        ([key, s]) =>
          `${s.count}x, ${s.ms.toFixed(1)} ms, elements ${s.elements} sum, ${s.maxElements} max: ${key}`,
      ),
    );
    console.log("- style invalidations by reason and selector, top 15 by count:");
    printList(
      top(total.invalidations, (s) => s.count, 15).map(
        ([key, s]) => `${s.count}x, most hit ${topNode(s)}: ${key}`,
      ),
    );
    console.log("- script, top 20 functions by self time:");
    printList(
      top(total.selfTime, (s) => s.ms, 20).map(
        ([key, s]) => `${s.ms.toFixed(1)} ms, ${s.count} samples: ${key}`,
      ),
    );
    console.log("- script, top 15 by time in our own source (first src/ frame up the chain):");
    printList(
      top(total.ownSource, (s) => s.ms, 15).map(
        ([key, s]) => `${s.ms.toFixed(1)} ms, ${s.count} samples: ${key}`,
      ),
    );
    console.log(`- Layout: ${layout.count}x, ${layout.ms.toFixed(1)} ms`);
    console.log("- FunctionCall, top 5 by duration (handlers and timers):");
    printList(
      [...total.calls]
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 5)
        .map((call) => `${call.ms.toFixed(1)} ms: ${call.text}`),
    );
  }
}
