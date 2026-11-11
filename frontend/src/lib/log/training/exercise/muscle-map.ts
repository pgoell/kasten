/** The muscle map: a body front and back, the primary muscles in the accent, the secondary faint. */

import { BACK, FRONT, type Part } from "@/lib/log/training/exercise/body-model";

const SVG = "http://www.w3.org/2000/svg";
const VIEW = "0 0 1000 2200";
/** The model splits the calf in two on the back; both are the `calves` an exercise names. */
const SAME: Record<string, string> = { "left-soleus": "calves", "right-soleus": "calves" };

function figure(parts: readonly Part[], primary: string[], secondary: string[], side: string) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", VIEW);
  svg.setAttribute("class", "cm-exercise-figure");
  svg.setAttribute("aria-hidden", "true");
  svg.dataset.side = side;
  for (const [name, polygons] of parts) {
    const muscle = SAME[name] ?? name;
    const role = primary.includes(muscle)
      ? "is-primary"
      : secondary.includes(muscle)
        ? "is-secondary"
        : "";
    for (const points of polygons) {
      const shape = document.createElementNS(SVG, "polygon");
      shape.setAttribute("points", points);
      shape.setAttribute("class", `cm-exercise-part ${role}`.trim());
      shape.dataset.muscle = muscle;
      svg.append(shape);
    }
  }
  return svg;
}

function words(names: string[]): string {
  return names.map((name) => name.replaceAll("-", " ")).join(", ");
}

/** The two figures side by side, with the muscles in words for a screen reader and the legend. */
export function muscleMap(primary: string[], secondary: string[]): HTMLElement {
  const map = document.createElement("figure");
  map.className = "cm-exercise-map";
  const said = [
    primary.length > 0 ? `primary: ${words(primary)}` : "",
    secondary.length > 0 ? `secondary: ${words(secondary)}` : "",
  ].filter((part) => part !== "");
  map.setAttribute("role", "img");
  map.setAttribute(
    "aria-label",
    said.length > 0 ? `Muscles, ${said.join("; ")}` : "No muscles named",
  );
  const bodies = document.createElement("div");
  bodies.className = "cm-exercise-bodies";
  bodies.append(
    figure(FRONT, primary, secondary, "front"),
    figure(BACK, primary, secondary, "back"),
  );
  const legend = document.createElement("figcaption");
  legend.className = "cm-exercise-legend";
  legend.textContent = said.length > 0 ? said.join(" · ") : "No muscles named";
  map.append(bodies, legend);
  return map;
}
