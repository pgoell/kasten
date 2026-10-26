import { type CSSProperties, useId, useState } from "react";
import type { Flow, FlowNode as FlowNodeOut } from "@/lib/finance-budget-api";
import { euros, monthName, monthOf, percent } from "@/lib/finance-words";
import { tagVariable } from "@/lib/graph";
import { layout, NODE_WIDTH, type PlacedLink, type PlacedNode } from "@/lib/sankey";

/** Drawn at this width and scrolled inside the card on a phone, so the labels keep their size. */
const WIDTH = 870;
const COLUMNS = [210, 365, 520, 685];
/** Room for a label beside its node; a longer name is cut and read whole in the readout. */
const LABEL = 190;
const MARGIN = 6;

interface Node extends Omit<FlowNodeOut, "amount"> {
  amount: number;
}

interface Link {
  source: string;
  target: string;
  amount: number;
}

type Point = { node: Node } | { link: Link };

/** Each kind's tag slot, so a kind and every stream out of it read as one in both scopes. */
const KIND_SLOTS: Record<string, string> = {
  fixed: "var(--tg-3)",
  flexible: "var(--tg-2)",
  non_monthly: "var(--tg-8)",
  reserved: "var(--tg-5)",
  saved: "var(--tg-9)",
  into_household: "var(--tg-6)",
};

/**
 * Each named category's tag slot: the one its name hashes to, as everywhere in the pane, or the
 * next free one when a category above already took it, so no two in one chart look alike.
 */
function categorySlots(nodes: Node[]): Map<string, string> {
  const used = new Set<number>();
  const slots = new Map<string, string>();
  for (const node of nodes) {
    if (node.role !== "category" || node.category_id == null) continue;
    let slot = Number(tagVariable(node.name).replace("--tg-", ""));
    for (let step = 0; step < 10 && used.has(slot); step++) slot = (slot % 10) + 1;
    used.add(slot);
    slots.set(node.key, `var(--tg-${slot})`);
  }
  return slots;
}

/** The kind a node stands for, from its key `kind-<scope>-<kind>`; none for other nodes. */
function kindOf(node: Node | undefined): string | undefined {
  return node?.key.startsWith("kind-") ? node.key.split("-")[2] : undefined;
}

/** A node's colour: its category's or its kind's slot, danger for money taken from before. */
function colourOf(node: Node, slots: Map<string, string>): string {
  if (node.role === "from_savings") return "var(--k-danger)";
  if (node.role === "category") return slots.get(node.key) ?? "var(--tg-none)";
  return KIND_SLOTS[kindOf(node) ?? ""] ?? "var(--k-muted)";
}

/** A stream out of a kind takes the kind's colour, one from before danger; the rest stay muted. */
function bandColour(link: Link, nodes: Map<string, Node>): string {
  const source = nodes.get(link.source);
  if (source?.role === "from_savings") return "var(--k-danger)";
  return KIND_SLOTS[kindOf(source) ?? ""] ?? "var(--k-muted)";
}

function shortName(name: string): string {
  return name.length > 24 ? `${name.slice(0, 23)}…` : name;
}

/** A kind's or left over's name with its scope, `Fixed from Household`, as both scopes have one. */
function nameOf(node: Node, links: Link[], nodes: Map<string, Node>): string {
  if (node.column !== 2) return node.name;
  const scope = nodes.get(links.find((link) => link.target === node.key)?.source ?? "");
  return scope?.role === "scope" ? `${node.name} from ${scope.name}` : node.name;
}

/** The words the readout and a screen reader give a node or a band. */
function describe(point: Point, links: Link[], nodes: Map<string, Node>, total: number): string {
  if ("node" in point) {
    const share = total > 0 ? `, ${percent(point.node.amount / total)} of the money in` : "";
    return `${nameOf(point.node, links, nodes)}, ${euros(point.node.amount)}${share}`;
  }
  const from = nodes.get(point.link.source)?.name ?? "";
  const to = nodes.get(point.link.target)?.name ?? "";
  return `${from} to ${to}, ${euros(point.link.amount)}`;
}

/** The month in one line, `October 2026 so far: 6.600 € in, 5.711 € out, 889 € left`. */
function headline(flow: Flow, nodes: Node[], month: string, today: string): string {
  const sum = (role: Node["role"]) =>
    nodes.filter((node) => node.role === role).reduce((total, node) => total + node.amount, 0);
  const left = sum("left_over");
  const taken = sum("from_savings");
  const total = Number(flow.total);
  const when = month === monthOf(today) ? `${monthName(month)} so far` : monthName(month);
  return [
    `${when}: ${euros(total)} in, ${euros(total - left)} out`,
    left > 0 ? `, ${euros(left)} left` : "",
    taken > 0 ? `, ${euros(taken)} from savings or earlier months` : "",
  ].join("");
}

/** The headline and where the most went, for the caption. */
function summary(head: string, nodes: Node[]): string {
  const top = nodes
    .filter((node) => node.role === "category" && node.category_id != null)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 3)
    .map((node) => `${node.name} ${euros(node.amount)}`);
  return top.length > 0 ? `${head}. The most went to ${top.join(", ")}.` : `${head}.`;
}

/**
 * A node's name and amount beside it. In the middle columns the label stands over the streams
 * leaving the node, so it sits on a chip of the card's colour (`chip`, an svg filter's id).
 */
function Label({ placed, chip }: { placed: PlacedNode<Node>; chip: string }) {
  const { node, x, y, height } = placed;
  const before = node.column === 0;
  const middle = node.column > 0 && node.column < COLUMNS.length - 1;
  return (
    <text
      className="finance-sankey-label"
      filter={middle ? `url(#${chip})` : undefined}
      x={before ? x - MARGIN : x + NODE_WIDTH + MARGIN}
      y={y + height / 2}
      textAnchor={before ? "end" : "start"}
      dominantBaseline="middle"
    >
      {shortName(node.name)}
      <tspan className="finance-sankey-amount"> {euros(node.amount)}</tspan>
    </text>
  );
}

/** A button over a node and its label, placed in percent of the drawing so it scales with it. */
function Hit({
  placed,
  height,
  words,
  onPoint,
  onCategory,
}: {
  placed: PlacedNode<Node>;
  height: number;
  words: string;
  onPoint: (point: Point | undefined) => void;
  onCategory: (id: number) => void;
}) {
  const { node, x, y } = placed;
  const tall = Math.max(placed.height, 22);
  const left = node.column === 0 ? x - LABEL : x;
  // A middle column's button stops short of the next column, whose own buttons start there.
  const middle = node.column > 0 && node.column < COLUMNS.length - 1;
  const wide = Math.min(middle ? 140 : LABEL + NODE_WIDTH, WIDTH - left);
  const category = node.category_id;
  const style: CSSProperties = {
    left: `${(left / WIDTH) * 100}%`,
    width: `${(wide / WIDTH) * 100}%`,
    top: `${((y + placed.height / 2 - tall / 2) / height) * 100}%`,
    height: `${(tall / height) * 100}%`,
  };
  return (
    <button
      type="button"
      className="finance-sankey-hit"
      style={style}
      aria-label={category == null ? words : `${words}; open the category`}
      onClick={() => (category == null ? onPoint({ node }) : onCategory(category))}
      onFocus={() => onPoint({ node })}
      onBlur={() => onPoint(undefined)}
      // Only a mouse hovers: a finger's press would leave the readout on a node nobody points at.
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") onPoint({ node });
      }}
      onPointerLeave={() => onPoint(undefined)}
    />
  );
}

function Band({
  placed,
  colour,
  lit,
  onPoint,
}: {
  placed: PlacedLink<Link>;
  colour: string;
  lit: boolean;
  onPoint: (point: Point | undefined) => void;
}) {
  return (
    <path
      className={lit ? "finance-sankey-band finance-sankey-lit" : "finance-sankey-band"}
      d={placed.path}
      style={{ fill: colour }}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") onPoint({ link: placed.link });
      }}
      onPointerLeave={() => onPoint(undefined)}
    />
  );
}

/** Whether a band touches what the reader points at, so it stands out from the rest. */
function touches(link: Link, point: Point | undefined): boolean {
  if (point === undefined) return false;
  if ("link" in point) return point.link === link;
  return link.source === point.node.key || link.target === point.node.key;
}

/** Every stream as a row, so each amount reads without pointing at the chart. */
function Streams({ links, nodes }: { links: Link[]; nodes: Map<string, Node> }) {
  return (
    <details className="finance-sums">
      <summary>Every stream</summary>
      <table>
        <tbody>
          {links.map((link) => (
            <tr key={`${link.source}-${link.target}`}>
              <th scope="row">{nodes.get(link.source)?.name}</th>
              <td className="finance-muted">to {nodes.get(link.target)?.name}</td>
              <td>{euros(link.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/**
 * Where the month's money went: each income into mine or household, on into the kinds and the
 * categories, with what was left over or taken from before. A category's button opens its
 * drilldown for the month; every node's names it and its amount on hover, focus or a tap.
 */
export function FinanceSankey({
  flow,
  month,
  today,
  onCategory,
}: {
  flow: Flow;
  month: string;
  today: string;
  onCategory: (id: number) => void;
}) {
  const [point, setPoint] = useState<Point>();
  const nodes: Node[] = flow.nodes.map((node) => ({ ...node, amount: Number(node.amount) }));
  const links: Link[] = flow.links.map((link) => ({ ...link, amount: Number(link.amount) }));
  const byKey = new Map(nodes.map((node) => [node.key, node]));
  const slots = categorySlots(nodes);
  // useId's own characters are not all allowed in a url(#…) reference.
  const chip = `chip${useId().replace(/[^\w-]/g, "")}`;
  const total = Number(flow.total);
  if (links.length === 0) {
    // After the hooks, which run on every render.
    return <p className="overview-words">nothing booked in {monthName(month)} yet</p>;
  }
  const drawn = layout(nodes, links, COLUMNS, WIDTH);
  const height = drawn.height + 2;
  const head = headline(flow, nodes, month, today);
  return (
    <figure className="finance-sankey">
      <p className="finance-trend-readout" aria-live="polite">
        {point === undefined ? head : describe(point, links, byKey, total)}
      </p>
      <div className="finance-sankey-scroll">
        <div className="finance-sankey-plot">
          <svg
            className="chart-svg"
            viewBox={`0 0 ${WIDTH} ${height}`}
            width="100%"
            role="img"
            aria-label={`where the money of ${monthName(month)} went`}
          >
            <defs>
              {/* In sRGB, so the chip is the card's colour exactly and not a shade off it. */}
              <filter
                id={chip}
                x="-0.04"
                y="-0.12"
                width="1.08"
                height="1.24"
                colorInterpolationFilters="sRGB"
              >
                <feFlood className="finance-sankey-chip" />
                <feComposite in="SourceGraphic" operator="over" />
              </filter>
            </defs>
            {drawn.links.map((placed) => (
              <Band
                key={`${placed.link.source}-${placed.link.target}`}
                placed={placed}
                colour={bandColour(placed.link, byKey)}
                lit={touches(placed.link, point)}
                onPoint={setPoint}
              />
            ))}
            {drawn.nodes.map((placed) => (
              <rect
                key={placed.node.key}
                className="finance-sankey-node"
                x={placed.x}
                y={placed.y}
                width={NODE_WIDTH}
                height={placed.height}
                rx={2}
                style={{ fill: colourOf(placed.node, slots) }}
              />
            ))}
            {drawn.nodes.map((placed) => (
              <Label key={placed.node.key} placed={placed} chip={chip} />
            ))}
          </svg>
          {drawn.nodes.map((placed) => (
            <Hit
              key={placed.node.key}
              placed={placed}
              height={height}
              words={describe({ node: placed.node }, links, byKey, total)}
              onPoint={setPoint}
              onCategory={onCategory}
            />
          ))}
        </div>
      </div>
      <figcaption className="overview-caption">
        {summary(head, nodes)} What happened, not the estimate free to spend makes for income and
        fixed costs still to come. The move into the shared account shows twice, out of mine and
        into household. Point at or tap a name for its amount; on a phone the chart scrolls
        sideways.
      </figcaption>
      <Streams links={links} nodes={byKey} />
    </figure>
  );
}
