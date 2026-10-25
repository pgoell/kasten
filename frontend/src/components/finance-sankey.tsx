import { type CSSProperties, useState } from "react";
import type { Flow, FlowNode as FlowNodeOut } from "@/lib/finance-budget-api";
import { categoryColour, euros, monthName, monthOf, percent } from "@/lib/finance-words";
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

/** A node's colour: its category's tag slot, danger for money taken from before, muted for the rest. */
function colourOf(node: Node): string {
  if (node.role === "from_savings") return "var(--k-danger)";
  if (node.role !== "category") return "var(--k-muted)";
  return node.category_id == null ? "var(--tg-none)" : categoryColour(node.name);
}

/** A band takes the colour of the category it ends in, or of money taken from before. */
function bandColour(link: Link, nodes: Map<string, Node>): string {
  const source = nodes.get(link.source);
  const target = nodes.get(link.target);
  if (source?.role === "from_savings") return colourOf(source);
  return target?.role === "category" ? colourOf(target) : "var(--k-muted)";
}

function shortName(name: string): string {
  return name.length > 24 ? `${name.slice(0, 23)}…` : name;
}

/** The words the readout and a screen reader give a node or a band. */
function describe(point: Point, nodes: Map<string, Node>, total: number): string {
  if ("node" in point) {
    const share = total > 0 ? `, ${percent(point.node.amount / total)} of the money in` : "";
    return `${point.node.name}, ${euros(point.node.amount)}${share}`;
  }
  const from = nodes.get(point.link.source)?.name ?? "";
  const to = nodes.get(point.link.target)?.name ?? "";
  return `${from} to ${to}, ${euros(point.link.amount)}`;
}

/** What the chart says in words: in, out, what was left or taken, and where the most went. */
function summary(flow: Flow, nodes: Node[], month: string, today: string): string {
  const sum = (role: Node["role"]) =>
    nodes.filter((node) => node.role === role).reduce((total, node) => total + node.amount, 0);
  const left = sum("left_over");
  const taken = sum("from_savings");
  const total = Number(flow.total);
  const when = month === monthOf(today) ? `${monthName(month)} so far` : `In ${monthName(month)}`;
  const top = nodes
    .filter((node) => node.role === "category" && node.category_id != null)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 3)
    .map((node) => `${node.name} ${euros(node.amount)}`);
  return [
    `${when}: ${euros(total)} came in and ${euros(total - left)} went out`,
    left > 0 ? `, ${euros(left)} left over` : "",
    taken > 0 ? `, ${euros(taken)} of it from savings or earlier months` : "",
    top.length > 0 ? `. The most went to ${top.join(", ")}.` : ".",
  ].join("");
}

function Label({ placed }: { placed: PlacedNode<Node> }) {
  const { node, x, y, height } = placed;
  const before = node.column === 0;
  return (
    <text
      className="finance-sankey-label"
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
      aria-label={category == null ? words : `${words}; show its bookings`}
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
 * bookings for the month; every node's names it and its amount on hover, focus or a tap.
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
  const total = Number(flow.total);
  if (links.length === 0) {
    return <p className="overview-words">nothing booked in {monthName(month)} yet</p>;
  }
  const drawn = layout(nodes, links, COLUMNS, WIDTH);
  const height = drawn.height + 2;
  const text = summary(flow, nodes, month, today);
  return (
    <figure className="finance-sankey">
      <p className="finance-trend-readout" aria-live="polite">
        {point === undefined ? (
          <span className="finance-muted">
            <span className="finance-wide">point at a stream or a name for its amount</span>
            <span className="finance-narrow">tap a name for its amount; swipe for the rest</span>
          </span>
        ) : (
          describe(point, byKey, total)
        )}
      </p>
      <div className="finance-sankey-scroll">
        <div className="finance-sankey-plot">
          <svg
            className="chart-svg"
            viewBox={`0 0 ${WIDTH} ${height}`}
            width="100%"
            role="img"
            aria-label={text}
          >
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
                style={{ fill: colourOf(placed.node) }}
              />
            ))}
            {drawn.nodes.map((placed) => (
              <Label key={placed.node.key} placed={placed} />
            ))}
          </svg>
          {drawn.nodes.map((placed) => (
            <Hit
              key={placed.node.key}
              placed={placed}
              height={height}
              words={describe({ node: placed.node }, byKey, total)}
              onPoint={setPoint}
              onCategory={onCategory}
            />
          ))}
        </div>
      </div>
      <figcaption className="overview-caption">
        {text} What happened, not the estimate free to spend makes for income and fixed costs still
        to come. The move into the shared account shows twice, out of mine and into household.
      </figcaption>
      <Streams links={links} nodes={byKey} />
    </figure>
  );
}
