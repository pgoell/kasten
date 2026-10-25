/**
 * The calls the Plans & goals tab and the overview's goals card make: plans, the month's
 * dates, the forecast, the proposals, and goals. The answers are the ones
 * `routes/finance_plans.py` and `routes/finance_goals.py` give.
 */

import { client, reason } from "@/lib/api-client";
import type { components } from "@/lib/api-types";

export type PlanIn = components["schemas"]["PlanIn"];
export type Plan = components["schemas"]["PlanOut"];
export type Due = components["schemas"]["DueOut"];
export type Forecast = components["schemas"]["ForecastOut"];
export type Proposal = components["schemas"]["ProposalOut"];
export type GoalIn = components["schemas"]["GoalIn"];
export type Goal = components["schemas"]["GoalOut"];
export type Goals = components["schemas"]["GoalsOut"];

function failed(what: string, error: { detail?: unknown } | undefined, status: number): Error {
  return new Error(reason(error) ?? `${what} failed with ${status}`);
}

export async function fetchPlans(): Promise<Plan[]> {
  const { data, error, response } = await client.GET("/api/finance/plans");
  if (!data) throw failed("GET /api/finance/plans", error, response.status);
  return data;
}

export async function fetchUpcoming(month: string): Promise<Due[]> {
  const { data, error, response } = await client.GET("/api/finance/plans/upcoming", {
    params: { query: { month } },
  });
  if (!data) throw failed("GET /api/finance/plans/upcoming", error, response.status);
  return data;
}

export async function fetchForecast(today: string): Promise<Forecast> {
  const { data, error, response } = await client.GET("/api/finance/plans/forecast", {
    params: { query: { today } },
  });
  if (!data) throw failed("GET /api/finance/plans/forecast", error, response.status);
  return data;
}

export async function fetchProposals(today: string): Promise<Proposal[]> {
  const { data, error, response } = await client.GET("/api/finance/plans/proposals", {
    params: { query: { today } },
  });
  if (!data) throw failed("GET /api/finance/plans/proposals", error, response.status);
  return data;
}

/** Make a plan, counted from `today`'s month on, or change the one `id` names. */
export async function writePlan(body: PlanIn, today: string, id?: number): Promise<void> {
  const { error, response } =
    id === undefined
      ? await client.POST("/api/finance/plans", { body, params: { query: { today } } })
      : await client.PUT("/api/finance/plans/{plan_id}", {
          params: { path: { plan_id: id } },
          body,
        });
  if (!response.ok) throw failed("Saving the plan", error, response.status);
}

export async function deletePlan(id: number): Promise<void> {
  const { error, response } = await client.DELETE("/api/finance/plans/{plan_id}", {
    params: { path: { plan_id: id } },
  });
  if (!response.ok) throw failed("Deleting the plan", error, response.status);
}

/** A proposal as the plan it proposes: the fields `POST /plans` takes, the rest left behind. */
export function planOf(proposal: Proposal): PlanIn {
  const { key: _key, source: _source, seen: _seen, last: _last, ...plan } = proposal;
  return plan;
}

export async function fetchGoals(today: string): Promise<Goals> {
  const { data, error, response } = await client.GET("/api/finance/goals", {
    params: { query: { today } },
  });
  if (!data) throw failed("GET /api/finance/goals", error, response.status);
  return data;
}

/** Make a goal, or change the one `id` names. */
export async function writeGoal(body: GoalIn, id?: number): Promise<void> {
  const { error, response } =
    id === undefined
      ? await client.POST("/api/finance/goals", { body })
      : await client.PUT("/api/finance/goals/{goal_id}", {
          params: { path: { goal_id: id } },
          body,
        });
  if (!response.ok) throw failed("Saving the goal", error, response.status);
}

export async function deleteGoal(id: number): Promise<void> {
  const { error, response } = await client.DELETE("/api/finance/goals/{goal_id}", {
    params: { path: { goal_id: id } },
  });
  if (!response.ok) throw failed("Deleting the goal", error, response.status);
}

/** What assigning adds to a goal: its monthly contribution, or what is left to the target. */
export function adding(goal: Goal): number {
  return Math.max(
    0,
    Math.min(Number(goal.monthly ?? 0), Number(goal.target) - Number(goal.reserved)),
  );
}

/** Assign this month's contribution; a second assign in the month changes nothing. */
export async function assignGoal(id: number, today: string): Promise<void> {
  const { error, response } = await client.POST("/api/finance/goals/{goal_id}/assign", {
    params: { path: { goal_id: id }, query: { today } },
  });
  if (!response.ok) throw failed("Assigning the contribution", error, response.status);
}

/** Take back the contribution assigned this month. */
export async function undoAssign(id: number, today: string): Promise<void> {
  const { error, response } = await client.DELETE("/api/finance/goals/{goal_id}/assign", {
    params: { path: { goal_id: id }, query: { today } },
  });
  if (!response.ok) throw failed("Taking back the contribution", error, response.status);
}

/** Move part of what the limits left over into a goal, dated `today`'s month. */
export async function moveLeftover(id: number, amount: string, today: string): Promise<void> {
  const { error, response } = await client.POST("/api/finance/goals/{goal_id}/leftover", {
    params: { path: { goal_id: id }, query: { today } },
    body: { amount },
  });
  if (!response.ok) throw failed("Moving the leftover", error, response.status);
}
