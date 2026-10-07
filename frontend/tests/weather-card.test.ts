import { Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import type { Forecast } from "@/lib/api";
import { cardLine, drawTown, sky } from "@/lib/weather-card";

const doc = (text: string) => Text.of(text.split("\n"));

describe("cardLine", () => {
  it("puts the card under the row of links after the title", () => {
    const note = "---\nid: x\n---\n# 2026-10-07 Wednesday\n\n[[a]] | [[b]] | [[c]]\n\n## TODOs";
    expect(cardLine(doc(note))).toBe(6);
  });

  it("puts the card under the title when no links follow it", () => {
    expect(cardLine(doc("# 2026-10-07\n\nsome text"))).toBe(1);
  });

  it("skips a heading inside the frontmatter's reach", () => {
    expect(cardLine(doc("---\ntitle: x\n---\n# Day\n[[a]]"))).toBe(5);
  });

  it("draws nothing in a note with no title", () => {
    expect(cardLine(doc("just text\n## Sub"))).toBeNull();
  });
});

describe("sky", () => {
  it("tells day from night on a clear sky", () => {
    expect(sky(0, true).icon).toBe("sun");
    expect(sky(0, false).icon).toBe("moon");
  });

  it("reads rain, showers, snow and storm", () => {
    expect(sky(61, true)).toEqual({ icon: "rain", word: "light rain" });
    expect(sky(63, true)).toEqual({ icon: "rain", word: "rain" });
    expect(sky(81, true).icon).toBe("rain");
    expect(sky(73, true).icon).toBe("snow");
    expect(sky(95, true).icon).toBe("storm");
  });
});

describe("drawTown", () => {
  const forecast: Forecast = {
    place: "Gelnhausen",
    sunrise: "07:32",
    sunset: "18:48",
    hours: Array.from({ length: 24 }, (_, hour) => ({
      time: `${String(hour).padStart(2, "0")}:00`,
      temperature: 10 + hour / 2,
      rain_chance: hour === 22 ? 50 : 0,
      rain: hour === 22 ? 1 : 0,
      code: 0,
    })),
  };

  it("heads the strip with the range, the rain and the sun", () => {
    const town = drawTown(forecast, null);
    const head = town.querySelector(".cm-weather-head")?.textContent ?? "";
    expect(head).toContain("Gelnhausen");
    expect(head).toContain("10° to 21.5°C");
    expect(head).toContain("rain 1.0 mm, 50% max");
    expect(head).toContain("sunrise 07:32, sunset 18:48, 11h 16m light");
  });

  it("draws one rain bar per hour that may rain", () => {
    expect(drawTown(forecast, null).querySelectorAll(".wx-rain")).toHaveLength(1);
  });

  it("marks now only when asked", () => {
    expect(drawTown(forecast, null).querySelector(".wx-now")).toBeNull();
    expect(drawTown(forecast, 15).querySelector(".wx-now")).not.toBeNull();
  });
});
