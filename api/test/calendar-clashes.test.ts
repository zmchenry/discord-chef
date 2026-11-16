import { expect, it } from 'vitest'

import {
  detectClashes,
  type Candidate,
  type ClashSlot,
  type Constraint,
  type DayContext,
} from '../../shared/planning'

const THU = '2026-11-19'
const SOCCER: Constraint = { kind: 'max_minutes', minutes: 25, meals: ['dinner'], reason: 'Soccer 5:30–7 → 25 min or less' }
const PARKERS: Constraint = { kind: 'eat_out', meals: ['dinner'], reason: 'Dinner at the Parkers → eating out' }
const EARLY: Constraint = { kind: 'grab_and_go', meals: ['breakfast'], reason: 'Flight 6:30 → grab-and-go breakfast' }
const AWAY: Constraint = { kind: 'servings', count: 1, meals: ['dinner'], reason: 'Liz away → cook for 1' }

const cand = (recipeId: string, title: string, totalMinutes: number | null, tags: string[]): Candidate => ({
  recipeId, title, totalMinutes, tags, ingredientIds: [], perishableIngredientIds: [], lastPlanned: null, estCostCents: null,
})
const CANDIDATES = [
  cand('lasagna', 'Lasagna', 90, ['dinner']),
  cand('tacos', 'Tacos', 20, ['dinner']),
  cand('stew', 'Stew', 30, ['dinner']),
  cand('pancakes', 'Pancakes', 30, ['breakfast']),
  cand('yogurt', 'Yogurt Bowl', 5, ['breakfast']),
]

const slot = (meal: ClashSlot['meal'], recipeId: string | null, totalMinutes: number | null, kind: ClashSlot['kind'] = 'recipe', locked = false): ClashSlot => ({
  date: THU, meal, kind, recipeId, locked, source: 'manual', totalMinutes,
  title: CANDIDATES.find((c) => c.recipeId === recipeId)?.title ?? null,
})

const run = (constraints: Constraint[], slots: ClashSlot[]) => {
  const days: DayContext[] = [{ date: THU, theme: null, constraints }]
  return detectClashes({ days, slots, candidates: CANDIDATES, seed: 'w' })
}

it.each([
  // [name, constraints, slots, expected (kind, recipe title, fix) or null]
  ['long dinner on a busy night swaps to the fastest fit', [SOCCER], [slot('dinner', 'lasagna', 90)], ['max_minutes', 'Lasagna', { kind: 'swap', recipeId: 'tacos', title: 'Tacos' }]],
  ['a dinner within the limit is fine', [SOCCER], [slot('dinner', 'tacos', 20)], null],
  ['unknown minutes never clash', [SOCCER], [slot('dinner', 'lasagna', null)], null],
  ['a recipe planned on an eat-out night', [PARKERS], [slot('dinner', 'stew', 30, 'recipe', true)], ['eat_out', 'Stew', { kind: 'eat_out' }]],
  ['already eating out is fine', [PARKERS], [slot('dinner', null, null, 'eat_out')], null],
  ['a slow grab-and-go breakfast', [EARLY], [slot('breakfast', 'pancakes', 30)], ['grab_and_go', 'Pancakes', { kind: 'swap', recipeId: 'yogurt', title: 'Yogurt Bowl' }]],
  ['servings and other meals do not clash', [AWAY, SOCCER], [slot('lunch', 'lasagna', 90), slot('dinner', 'tacos', 20)], null],
] as const)('%s', (_name, constraints, slots, expected) => {
  const clashes = run([...constraints], [...slots])
  if (!expected) return expect(clashes).toEqual([])
  expect(clashes).toHaveLength(1)
  const [kind, title, fix] = expected
  const c = clashes[0]!
  expect({ kind: c.kind, title: c.recipeTitle, fix: c.fix }).toEqual({ kind, title, fix })
  expect(c.reason).toBe(constraints.find((k) => k.kind === kind)!.reason)
  expect(c.fingerprint).toBe([THU, c.meal, kind, c.recipeId, c.reason].join('|'))
})

it('has no fix when nothing fits the limit', () => {
  const slow = { ...SOCCER, minutes: 10 }
  expect(run([slow], [slot('dinner', 'lasagna', 90)])[0]?.fix).toBeNull()
})
