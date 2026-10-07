/**
 * The day's weather, drawn under a daily note's title and its row of links.
 *
 * One strip per town: sky icons every three hours, the temperature as a line,
 * the chance of rain as bars on a band of its own, night shaded from sunset to
 * sunrise. Two measures, two bands, because one chart with two scales reads as
 * whichever scale the eye lands on first.
 *
 * Nothing is written into the note. The forecast is fetched when the note opens
 * and the note's text is the same with or without it, so a daily note older
 * than Open-Meteo's reach simply has no card.
 */

import type { EditorState, Extension, Text } from "@codemirror/state";
import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { type Forecast, fetchWeather } from "@/lib/api";
import { readClock } from "@/lib/clock";
import { dailyDate } from "@/lib/periodic";
import { notePath } from "@/lib/todo-commands";

const SVG = "http://www.w3.org/2000/svg";

/** The chart's own units. The svg scales to the column, so these are ratios. */
const WIDTH = 720;
const HOUR = WIDTH / 24;
const NIGHT_BOTTOM = 118;
const TEMP_TOP = 30;
const TEMP_HEIGHT = 46;
const RAIN_BASE = 116;
const RAIN_HEIGHT = 30;

/**
 * One request per day for the life of the tab. Every daily note a pane opens,
 * and every rebuild of the widget, asks for the same answer; the backend keeps
 * its own half hour on top.
 */
const asked = new Map<string, Promise<Forecast[]>>();

function forecastFor(date: string): Promise<Forecast[]> {
  let found = asked.get(date);
  if (found === undefined) {
    found = fetchWeather(date);
    // A failed fetch is forgotten, so the next note to open asks again.
    found.catch(() => asked.delete(date));
    asked.set(date, found);
  }
  return found;
}

/**
 * The line the card goes under: the row of links after the title, or the title
 * when there is no such row. Nothing in a note with no `# ` title.
 */
export function cardLine(doc: Text): number | null {
  let at = 1;
  if (doc.line(1).text === "---") {
    while (at < doc.lines && doc.line(at + 1).text !== "---") at++;
    at += 2;
  }
  for (; at <= doc.lines; at++) {
    if (!doc.line(at).text.startsWith("# ")) continue;
    const next = at + 1 <= doc.lines && doc.line(at + 1).text === "" ? at + 2 : at + 1;
    return next <= doc.lines && doc.line(next).text.startsWith("[[") ? next : at;
  }
  return null;
}

/** `07:32` as hours past midnight. */
function hoursOf(clock: string): number {
  const [hours = 0, minutes = 0] = clock.split(":").map(Number);
  return hours + minutes / 60;
}

function degrees(value: number): string {
  return `${value.toFixed(1).replace(/\.0$/, "")}°`;
}

/** What the WMO code says about the sky, as an icon name and a word. */
export function sky(code: number, day: boolean): { icon: string; word: string } {
  if (code >= 95) return { icon: "storm", word: "thunderstorm" };
  if (code >= 71 && code <= 86 && !(code >= 80 && code <= 82))
    return { icon: "snow", word: "snow" };
  if (code >= 51) return { icon: "rain", word: code >= 63 && code !== 80 ? "rain" : "light rain" };
  if (code === 45 || code === 48) return { icon: "cloud", word: "fog" };
  if (code === 3) return { icon: "cloud", word: "overcast" };
  if (code === 2) return { icon: day ? "part" : "part-night", word: "partly cloudy" };
  return { icon: day ? "sun" : "moon", word: code === 1 ? "mostly clear" : "clear" };
}

/** Each icon as the paths it is drawn from, inside a 24 by 24 box. */
const ICONS: Record<string, string> = {
  sun: `<circle cx="12" cy="12" r="4.5" class="wx-sun"/><path class="wx-rays" d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>`,
  moon: `<path class="wx-moon" d="M15.5 4a8 8 0 1 0 4.5 13.6A7 7 0 0 1 15.5 4z"/>`,
  part: `<circle cx="9" cy="9" r="4" class="wx-sun"/><path class="wx-cloud-light" d="M8 20h10a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.4 1.8A3.1 3.1 0 0 0 8 20z"/>`,
  "part-night": `<path class="wx-moon" d="M10 3.5a5 5 0 1 0 3.5 8.6A4.4 4.4 0 0 1 10 3.5z"/><path class="wx-cloud-light" d="M8 20h10a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.4 1.8A3.1 3.1 0 0 0 8 20z"/>`,
  cloud: `<path class="wx-cloud" d="M6.5 19h11a4.5 4.5 0 0 0 .3-9 6 6 0 0 0-11.5 1.7A3.7 3.7 0 0 0 6.5 19z"/>`,
  rain: `<path class="wx-cloud" d="M6.5 14h11a4 4 0 0 0 .3-8 5.6 5.6 0 0 0-10.8 1.6A3.3 3.3 0 0 0 6.5 14z"/><path class="wx-drops" d="M8 17l-1 3M12.5 17l-1 3M17 17l-1 3"/>`,
  snow: `<path class="wx-cloud" d="M6.5 14h11a4 4 0 0 0 .3-8 5.6 5.6 0 0 0-10.8 1.6A3.3 3.3 0 0 0 6.5 14z"/><circle class="wx-flake" cx="8" cy="18.5" r="1.2"/><circle class="wx-flake" cx="12.5" cy="19.5" r="1.2"/><circle class="wx-flake" cx="17" cy="18.5" r="1.2"/>`,
  storm: `<path class="wx-cloud" d="M6.5 14h11a4 4 0 0 0 .3-8 5.6 5.6 0 0 0-10.8 1.6A3.3 3.3 0 0 0 6.5 14z"/><path class="wx-bolt" d="M12.5 14l-2.5 4h3l-2 4"/>`,
};

function node<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number>,
  parent: Element,
): SVGElementTagNameMap[K] {
  const made = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attributes)) made.setAttribute(name, String(value));
  parent.appendChild(made);
  return made;
}

function label(parent: Element, x: number, y: number, words: string, className = ""): void {
  const text = node("text", { x, y, class: className }, parent);
  text.textContent = words;
}

/** Whether the hour starting at `hour` is mostly in daylight. */
function daylit(forecast: Forecast, hour: number): boolean {
  return hour + 0.5 >= hoursOf(forecast.sunrise) && hour + 0.5 <= hoursOf(forecast.sunset);
}

/** How long the sun is up, as `11h 16m`. */
function daylight(forecast: Forecast): string {
  const minutes = Math.round((hoursOf(forecast.sunset) - hoursOf(forecast.sunrise)) * 60);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** One town's header line and strip, with the hover that reads an hour out. */
export function drawTown(forecast: Forecast, now: number | null): HTMLElement {
  const town = document.createElement("div");
  town.className = "cm-weather-town";
  const hours = forecast.hours;
  const temperatures = hours.map((hour) => hour.temperature);
  const low = Math.min(...temperatures);
  const high = Math.max(...temperatures);
  const rain = hours.reduce((sum, hour) => sum + hour.rain, 0);
  const chance = Math.max(...hours.map((hour) => hour.rain_chance));

  const head = document.createElement("div");
  head.className = "cm-weather-head";
  for (const [className, words] of [
    ["cm-weather-place", forecast.place],
    ["cm-weather-range", `${degrees(low)} to ${degrees(high)}C`],
    ["cm-weather-meta", `rain ${rain.toFixed(1)} mm, ${chance}% max`],
    [
      "cm-weather-meta",
      `sunrise ${forecast.sunrise}, sunset ${forecast.sunset}, ${daylight(forecast)} light`,
    ],
  ] as const) {
    const span = document.createElement("span");
    span.className = className;
    span.textContent = words;
    head.appendChild(span);
  }
  town.appendChild(head);

  const svg = node("svg", { viewBox: `0 0 ${WIDTH} 132`, role: "img" }, town);
  svg.setAttribute("aria-label", `${forecast.place}, hourly temperature and chance of rain`);

  const sunrise = hoursOf(forecast.sunrise);
  const sunset = hoursOf(forecast.sunset);
  node("rect", { x: 0, y: 0, width: sunrise * HOUR, height: NIGHT_BOTTOM, class: "wx-night" }, svg);
  node(
    "rect",
    {
      x: sunset * HOUR,
      y: 0,
      width: (24 - sunset) * HOUR,
      height: NIGHT_BOTTOM,
      class: "wx-night",
    },
    svg,
  );

  const x = (hour: number) => (hour + 0.5) * HOUR;
  const at = (hour: { time: string }) => hoursOf(hour.time);

  hours.forEach((hour) => {
    if (at(hour) % 3 !== 1) return;
    const icon = node(
      "svg",
      { x: x(at(hour)) - 8, y: 2, width: 16, height: 16, viewBox: "0 0 24 24" },
      svg,
    );
    icon.innerHTML = ICONS[sky(hour.code, daylit(forecast, at(hour))).icon] ?? "";
  });

  // A degree of headroom each side, so the extremes are not drawn on the edge.
  const floor = Math.floor(low) - 1;
  const span = Math.ceil(high) + 1 - floor;
  const y = (temperature: number) => TEMP_TOP + (1 - (temperature - floor) / span) * TEMP_HEIGHT;
  const points = hours.map((hour) => `${x(at(hour))},${y(hour.temperature)}`);
  const first = x(hoursOf(hours[0]?.time ?? "00:00"));
  const last = x(hoursOf(hours[hours.length - 1]?.time ?? "23:00"));
  const base = TEMP_TOP + TEMP_HEIGHT + 2;
  node(
    "path",
    { d: `M${points.join(" L")} L${last},${base} L${first},${base} Z`, class: "wx-temp-area" },
    svg,
  );
  node("path", { d: `M${points.join(" L")}`, class: "wx-temp" }, svg);
  const warmest = hours.find((hour) => hour.temperature === high);
  const coldest = hours.find((hour) => hour.temperature === low);
  if (warmest) label(svg, x(at(warmest)), y(high) - 5, degrees(high), "wx-value");
  if (coldest) label(svg, x(at(coldest)), y(low) + 13, degrees(low), "wx-value");

  node("line", { x1: 0, x2: WIDTH, y1: RAIN_BASE, y2: RAIN_BASE, class: "wx-rule" }, svg);
  hours.forEach((hour) => {
    if (hour.rain_chance === 0) return;
    const height = (hour.rain_chance / 100) * RAIN_HEIGHT;
    const bar = node(
      "rect",
      {
        x: at(hour) * HOUR + 1,
        y: RAIN_BASE - height,
        width: HOUR - 2,
        height,
        rx: 2,
        class: "wx-rain",
      },
      svg,
    );
    // The bar's height is the chance, its strength the amount: 2 mm in an hour
    // is a downpour, so anything past it is drawn at full.
    bar.style.fillOpacity = String(0.35 + 0.65 * Math.min(hour.rain / 2, 1));
  });
  label(svg, WIDTH, 96, "rain %", "wx-end");

  for (const hour of [0, 6, 12, 18, 24]) {
    const anchor = hour === 0 ? "wx-start" : hour === 24 ? "wx-end" : "wx-middle";
    label(svg, hour * HOUR, 130, String(hour).padStart(2, "0"), anchor);
  }

  if (now !== null) {
    node("line", { x1: now * HOUR, x2: now * HOUR, y1: 0, y2: NIGHT_BOTTOM, class: "wx-now" }, svg);
    label(svg, now * HOUR + 4, 9, "now", "wx-now-label");
  }

  const tip = document.createElement("div");
  tip.className = "cm-weather-tip";
  tip.hidden = true;
  town.appendChild(tip);
  const cross = node("line", { y1: 0, y2: NIGHT_BOTTOM, class: "wx-cross" }, svg);
  cross.style.visibility = "hidden";

  hours.forEach((hour) => {
    const hit = node(
      "rect",
      { x: at(hour) * HOUR, y: 0, width: HOUR, height: NIGHT_BOTTOM, class: "wx-hit" },
      svg,
    );
    hit.addEventListener("pointerenter", () => {
      cross.setAttribute("x1", String(x(at(hour))));
      cross.setAttribute("x2", String(x(at(hour))));
      cross.style.visibility = "visible";
      tip.replaceChildren();
      const lines = [
        `${forecast.place} ${hour.time}`,
        `${degrees(hour.temperature)}C, ${sky(hour.code, daylit(forecast, at(hour))).word}`,
        `rain ${hour.rain_chance}%, ${hour.rain.toFixed(1)} mm`,
      ];
      for (const line of lines) {
        const row = document.createElement("div");
        row.textContent = line;
        tip.appendChild(row);
      }
      tip.hidden = false;
      const box = svg.getBoundingClientRect();
      const townBox = town.getBoundingClientRect();
      const px = box.left - townBox.left + (x(at(hour)) / WIDTH) * box.width;
      // Right of the hour, or left of it where the right would run off the card.
      const left = px + 10 + tip.offsetWidth > townBox.width ? px - tip.offsetWidth - 10 : px + 10;
      tip.style.left = `${left}px`;
      tip.style.top = `${box.top - townBox.top + 8}px`;
    });
  });
  svg.addEventListener("pointerleave", () => {
    tip.hidden = true;
    cross.style.visibility = "hidden";
  });

  return town;
}

/** A day's forecast arriving, to be drawn into the note it was asked for. */
const arrived = StateEffect.define<{ date: string; forecasts: Forecast[] }>();

/**
 * The card for one day: empty while the forecast is on its way, drawn once it
 * is in state.
 *
 * The forecast travels through an effect rather than being drawn into the
 * element the fetch started from, because CodeMirror measures a block widget
 * when it mounts and not after. A card that grew later left the line numbers
 * beside it where the empty card had put them.
 */
class WeatherCard extends WidgetType {
  private readonly date: string;
  private readonly forecasts: Forecast[] | null;

  constructor(date: string, forecasts: Forecast[] | null) {
    super();
    this.date = date;
    this.forecasts = forecasts;
  }

  override eq(other: WeatherCard): boolean {
    return other.date === this.date && other.forecasts === this.forecasts;
  }

  toDOM(view: EditorView): HTMLElement {
    const card = document.createElement("div");
    card.className = "cm-weather";
    card.setAttribute("contenteditable", "false");
    if (this.forecasts !== null) {
      const today = readClock(new Date());
      const now = today.date === this.date ? hoursOf(today.time) : null;
      card.replaceChildren(...this.forecasts.map((forecast) => drawTown(forecast, now)));
      return card;
    }
    const date = this.date;
    forecastFor(date).then(
      (forecasts) => {
        // Gone from the page means the note was closed or the preview turned
        // off while the fetch was out, and there is nothing to draw into.
        if (card.isConnected) view.dispatch({ effects: arrived.of({ date, forecasts }) });
      },
      // A card that could not load is no card. The note is still the note.
      (error: unknown) => {
        if (!(error instanceof Error)) throw error;
        console.warn(error.message);
      },
    );
    return card;
  }
}

interface Card {
  forecasts: Forecast[] | null;
  decorations: DecorationSet;
}

function build(state: EditorState, forecasts: Forecast[] | null): Card {
  const path = state.facet(notePath);
  const date = path === undefined ? null : dailyDate(path);
  const line = date === null ? null : cardLine(state.doc);
  if (date === null || line === null) return { forecasts, decorations: Decoration.none };
  return {
    forecasts,
    decorations: Decoration.set([
      Decoration.widget({ widget: new WeatherCard(date, forecasts), block: true, side: 1 }).range(
        state.doc.line(line).to,
      ),
    ]),
  };
}

/**
 * The card as an editor extension. A field and not a view plugin, because a
 * block widget changes the height of the document and CodeMirror takes those
 * only from state. One instance, so a preview toggled back on finds the same
 * field rather than a second one beside it.
 */
export const weatherCard: Extension = StateField.define<Card>({
  create: (state) => build(state, null),
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(arrived)) return build(tr.state, effect.value.forecasts);
    }
    return tr.docChanged ? build(tr.state, value.forecasts) : value;
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});
