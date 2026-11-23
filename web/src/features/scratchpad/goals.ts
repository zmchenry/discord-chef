import type { Goals } from "../../../../shared/nutrition/week";
import { useGoals } from "../nutrition/api";

// The one place the scratch pad reads goals. Every macro is optional: today
// most households set calories and protein; carbs and fat light up here as
// soon as they're set (or the goals API starts sending them).
type GoalRow = { person: string; kcal?: number | null; protein?: number | null; carbs?: number | null; fat?: number | null };

export function goalsFromRows(rows: readonly GoalRow[]): { people: string[]; goals: Goals } {
  return {
    people: rows.map((r) => r.person),
    goals: Object.fromEntries(
      rows.map((r) => [r.person, { kcal: r.kcal ?? null, protein: r.protein ?? null, carbs: r.carbs ?? null, fat: r.fat ?? null }]),
    ),
  };
}

// The household's people (one goals row each) and their daily goals.
export function useScratchGoals() {
  const q = useGoals();
  return { ...q, value: q.data ? goalsFromRows(q.data) : null };
}
