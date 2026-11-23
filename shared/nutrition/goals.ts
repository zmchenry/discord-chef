// Goal math for the nutrition views: macro splits, progress against a goal,
// averages that skip unknown days, and reading stored goals of any age.
// Pure: no I/O.

import type { Nutrients } from './recipe'
import type { Goal, Goals, PersonDay } from './week'

// The macros the views show, in display order. Fiber is optional.
export const MACROS = ['kcal', 'protein', 'carbs', 'fat', 'fiber'] as const
export type Macro = (typeof MACROS)[number]

export const MACRO_LABEL: Record<Macro, string> = {
  kcal: 'Calories',
  protein: 'Protein',
  carbs: 'Carbs',
  fat: 'Fat',
  fiber: 'Fiber',
}
export const MACRO_SHORT: Record<Macro, string> = { kcal: 'kcal', protein: 'P', carbs: 'C', fat: 'F', fiber: 'Fib' }
export const MACRO_UNIT: Record<Macro, string> = { kcal: 'kcal', protein: 'g', carbs: 'g', fat: 'g', fiber: 'g' }

// Energy per gram (Atwater).
export const KCAL_PER_GRAM = { protein: 4, carbs: 4, fat: 9 } as const
export type SplitMacro = keyof typeof KCAL_PER_GRAM
export type Split = Record<SplitMacro, number>

// A common starting split: 30% protein, 40% carbs, 30% fat.
export const DEFAULT_SPLIT: Split = { protein: 30, carbs: 40, fat: 30 }

// Grams of each macro for a calorie goal split by percent of calories.
// Percentages needn't add to 100; each is taken as given.
export function gramsFromSplit(kcal: number, split: Split): Record<SplitMacro, number> {
  const g = (m: SplitMacro) => Math.round((kcal * (split[m] / 100)) / KCAL_PER_GRAM[m])
  return { protein: g('protein'), carbs: g('carbs'), fat: g('fat') }
}

// The percent split that set grams imply, or null without calories and all three.
export function splitFromGrams(goal: Pick<Goal, 'kcal' | 'protein' | 'carbs' | 'fat'>): Split | null {
  const { kcal, protein, carbs, fat } = goal
  if (!kcal || protein == null || carbs == null || fat == null) return null
  const pct = (grams: number, m: SplitMacro) => Math.round(((grams * KCAL_PER_GRAM[m]) / kcal) * 100)
  return { protein: pct(protein, 'protein'), carbs: pct(carbs, 'carbs'), fat: pct(fat, 'fat') }
}

// Calories the macro grams add up to, or null with any missing.
export function kcalFromGrams(goal: Pick<Goal, 'protein' | 'carbs' | 'fat'>): number | null {
  const { protein, carbs, fat } = goal
  if (protein == null || carbs == null || fat == null) return null
  return protein * KCAL_PER_GRAM.protein + carbs * KCAL_PER_GRAM.carbs + fat * KCAL_PER_GRAM.fat
}

export interface Progress {
  // value / goal, or null with no goal.
  ratio: number | null
  // Still to go (>= 0) and how far over (>= 0), or null with no goal.
  left: number | null
  over: number | null
}

export function versusGoal(value: number, goal: number | null | undefined): Progress {
  if (!goal || goal <= 0) return { ratio: null, left: null, over: null }
  return { ratio: value / goal, left: Math.max(0, goal - value), over: Math.max(0, value - goal) }
}

export interface DayAverage {
  // Per day over the days with at least one known meal; null with none.
  perDay: Nutrients | null
  // Days averaged, days among them with some meals unknown, and days at
  // home with nothing known (left out, never counted as zero).
  days: number
  partial: number
  unknown: number
}

// Average of a person's days. Away days are left out; so are home days with
// no known meal: an unknown day is a gap, not a zero.
export function averageDays(days: ReadonlyArray<Pick<PersonDay, 'home' | 'totals' | 'known' | 'gaps'>>): DayAverage {
  const home = days.filter((d) => d.home)
  const known = home.filter((d) => d.known > 0)
  if (!known.length) return { perDay: null, days: 0, partial: 0, unknown: home.length }
  const sum = (k: keyof Nutrients) => known.reduce((a, d) => a + d.totals[k], 0)
  const avg = (k: keyof Nutrients) => Math.round(sum(k) / known.length)
  return {
    perDay: { kcal: avg('kcal'), protein: avg('protein'), carbs: avg('carbs'), fat: avg('fat'), fiber: avg('fiber') },
    days: known.length,
    partial: known.filter((d) => d.gaps > 0).length,
    unknown: home.length - known.length,
  }
}

// --- Stored goals --------------------------------------------------------------

const GOAL_MAX: Record<Macro, number> = { kcal: 10_000, protein: 1_000, carbs: 2_000, fat: 1_000, fiber: 200 }

const goalNumber = (v: unknown, max: number): number | null => {
  const n = typeof v === 'string' && v.trim() ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.min(max, Math.round(n)) : null
}

export const emptyGoal = (): Required<Goal> => ({ kcal: null, protein: null, carbs: null, fat: null, fiber: null })

export function normalizeGoal(raw: unknown): Required<Goal> {
  const g = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out = emptyGoal()
  for (const m of MACROS) out[m] = goalNumber(g[m], GOAL_MAX[m])
  return out
}

// Goals as stored in household_settings. Today a record by person with
// every macro; the first version had no fiber (and might lack carbs and
// fat), and a list of {person, ...} rows is read too. Anything unreadable
// is no goal.
export function normalizeGoals(raw: unknown): Goals {
  const out: Goals = {}
  if (Array.isArray(raw)) {
    for (const row of raw) {
      const person = row && typeof row === 'object' ? (row as { person?: unknown }).person : null
      if (typeof person === 'string' && person) out[person] = normalizeGoal(row)
    }
  } else if (raw && typeof raw === 'object') {
    for (const [person, g] of Object.entries(raw)) out[person] = normalizeGoal(g)
  }
  return out
}

export const hasAnyGoal = (goals: ReadonlyArray<Partial<Goal>>) => goals.some((g) => MACROS.some((m) => g[m] != null))
