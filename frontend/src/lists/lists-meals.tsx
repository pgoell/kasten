/**
 * The Essen tab: the week plans' meals from today on, read-only, as `GET /share/meals` gives
 * them. Planning happens in kasten; `docs/reference/food/meal-plan.md` holds the format.
 */

import { useEffect, useState } from "react";
import { localDay, personOf } from "./lists-view";

export type SharedMeal = {
  slot: "lunch" | "dinner";
  kind: "cook" | "from" | "other";
  dish: string;
  servings: number | null;
  cook: string | null;
};
export type SharedDay = { date: string; meals: SharedMeal[] };

const DAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

/** `Heute · Mo 9. Nov` for today, `Di 10.` for any other day. */
export function dayLabel(date: string, today: string): string {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  const weekday = DAYS[new Date(year, month - 1, day).getDay()];
  if (date === today) return `Heute · ${weekday} ${day}. ${MONTHS[month - 1]}`;
  return `${weekday} ${day}.`;
}

/** What a meal's row says: the dish, `×4` for a batch cooked, and whether it is a Rest. */
export function mealWords(meal: SharedMeal): { dish: string; rest: boolean } {
  const many = meal.kind === "cook" && meal.servings !== null ? ` ×${meal.servings}` : "";
  return { dish: `${meal.dish}${many}`, rest: meal.kind === "from" };
}

/** The cook's chip: `Ich` for the viewer, the name for anyone else. */
export function cookChip(meal: SharedMeal, me: string | null): string | null {
  const name = personOf(meal.cook);
  if (name === null || meal.kind === "from") return null;
  return name === me ? "Ich" : name;
}

async function readMeals(today: string): Promise<SharedDay[]> {
  const res = await fetch(`/share/meals?today=${today}`, { cache: "no-store", redirect: "manual" });
  if (!res.ok) throw new Error(`Essen konnte nicht geladen werden (${res.status || "Anmelden"})`);
  return (await res.json()) as SharedDay[];
}

/** The meals, read again on every change in the share folder and when the page comes back. */
function useMeals(): { days: SharedDay[] | null; failed: string | null; today: string } {
  const [days, setDays] = useState<SharedDay[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const today = localDay(new Date());

  useEffect(() => {
    let live = true;
    const load = () => {
      readMeals(localDay(new Date())).then(
        (read) => {
          if (!live) return;
          setDays(read);
          setFailed(null);
        },
        (error: unknown) => {
          if (!live) return;
          if (!(error instanceof Error)) throw error;
          setFailed(error.message);
        },
      );
    };
    const onShow = () => {
      if (document.visibilityState === "visible") load();
    };
    load();
    document.addEventListener("visibilitychange", onShow);
    // jsdom has no EventSource; the read on showing the page covers it.
    const source =
      typeof EventSource === "undefined" ? undefined : new EventSource("/share/events");
    if (source) source.onmessage = load;
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", onShow);
      source?.close();
    };
  }, []);

  return { days, failed, today };
}

/** The tab, read only while it is the one `shown`, so the lists open no second stream. */
export function MealsTab({ shown, me }: { shown: boolean; me: string | null }) {
  return shown ? <Meals me={me} /> : null;
}

function Meals({ me }: { me: string | null }) {
  const { days, failed, today } = useMeals();
  return (
    <main className="lists meals">
      {failed !== null && <p className="empty">{failed}</p>}
      {days !== null && days.length === 0 && <p className="empty">Noch nichts geplant</p>}
      {days?.map((day) => (
        <section key={day.date} aria-label={dayLabel(day.date, today)}>
          <div className="group-head">
            <h2>{dayLabel(day.date, today)}</h2>
          </div>
          <div className="group meal-group">
            {day.meals.map((meal) => {
              const { dish, rest } = mealWords(meal);
              const chip = cookChip(meal, me);
              return (
                <div key={`${meal.slot}:${meal.dish}`} className="meal">
                  <span className="meal-slot">{meal.slot === "lunch" ? "Mittag" : "Abend"}</span>
                  <span className="meal-dish">
                    {dish}
                    {rest && <span className="meal-rest"> · Rest</span>}
                  </span>
                  {chip !== null && (
                    <span className={chip === "Ich" ? "meal-cook mine" : "meal-cook"}>{chip}</span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
      <p className="meals-foot">Nur zum Lesen. Geplant wird in kasten.</p>
    </main>
  );
}
