// STUB (drop at merge): naive scoring so the app can run before the real
// engine lands. Same exports and shapes as the contract.
import type { Meal, SlotKind } from '../schema'
import type { Constraint, ISODate } from './calendar'

export interface Theme {
  weekday: number
  label: string
  tags: string[]
  meals: Meal[]
}

export interface Candidate {
  recipeId: string
  title: string
  tags: string[]
  ingredientIds: string[]
  perishableIngredientIds: string[]
  totalMinutes: number | null
  lastPlanned: ISODate | null
  estCostCents: number | null
}

export interface DayContext {
  date: ISODate
  theme: Theme | null
  constraints: Constraint[]
}

export interface PlannedSlot {
  date: ISODate
  meal: Meal
  kind: SlotKind
  recipeId: string | null
  locked: boolean
  source: 'manual' | 'auto' | 'suggested'
}

export interface ScoredCandidate {
  recipeId: string
  score: number
  reasons: string[]
}

const MEALS: Meal[] = ['breakfast', 'lunch', 'dinner']

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0) / 2 ** 32
}

export function scoreCandidates(args: {
  date: ISODate
  meal: Meal
  day: DayContext
  week: PlannedSlot[]
  candidates: Candidate[]
  seed: string
}): ScoredCandidate[] {
  const { date, meal, day, week, candidates, seed } = args
  if (day.constraints.some((c) => c.kind === 'eat_out' && c.meals.includes(meal))) return []
  const inWeek = new Set(week.filter((s) => s.recipeId && !(s.date === date && s.meal === meal)).map((s) => s.recipeId))
  const weekIngredients = new Set(
    candidates.filter((c) => inWeek.has(c.recipeId)).flatMap((c) => c.ingredientIds),
  )
  const maxMinutes = day.constraints.find((c) => c.kind === 'max_minutes' && c.meals.includes(meal))
  const out: ScoredCandidate[] = []
  for (const c of candidates) {
    const mealTags = c.tags.filter((t) => (MEALS as string[]).includes(t))
    if (mealTags.length > 0 && !mealTags.includes(meal)) continue
    let score = hash(seed + c.recipeId)
    const reasons: string[] = []
    if (day.theme && day.theme.meals.includes(meal) && day.theme.tags.some((t) => c.tags.includes(t))) {
      score += 10
      reasons.push(day.theme.label)
    }
    if (maxMinutes && maxMinutes.kind === 'max_minutes' && c.totalMinutes !== null) {
      if (c.totalMinutes <= maxMinutes.minutes) {
        score += 3
        reasons.push(`${c.totalMinutes} min, fits a busy night`)
      } else score -= 8
    }
    if (inWeek.has(c.recipeId)) score -= 20
    const overlap = c.ingredientIds.filter((i) => weekIngredients.has(i)).length
    if (overlap > 0) {
      score += overlap
      reasons.push(`Shares ${overlap} ingredient${overlap === 1 ? '' : 's'}`)
    }
    if (!c.lastPlanned) {
      score += 1
      if (reasons.length < 3) reasons.push('Not made recently')
    }
    out.push({ recipeId: c.recipeId, score, reasons: reasons.slice(0, 3) })
  }
  return out.sort((a, b) => b.score - a.score)
}

export function autoFill(args: {
  days: DayContext[]
  week: PlannedSlot[]
  candidates: Candidate[]
  seed: string
}): PlannedSlot[] {
  const week = [...args.week]
  const filled: PlannedSlot[] = []
  for (const day of args.days) {
    for (const meal of MEALS) {
      const existing = week.find((s) => s.date === day.date && s.meal === meal)
      if (existing && (existing.locked || existing.kind !== 'recipe' || existing.recipeId)) continue
      let slot: PlannedSlot
      if (day.constraints.some((c) => c.kind === 'eat_out' && c.meals.includes(meal))) {
        slot = { date: day.date, meal, kind: 'eat_out', recipeId: null, locked: false, source: 'auto' }
      } else {
        const best = scoreCandidates({ date: day.date, meal, day, week, candidates: args.candidates, seed: args.seed })[0]
        if (!best) continue
        slot = { date: day.date, meal, kind: 'recipe', recipeId: best.recipeId, locked: false, source: 'auto' }
      }
      const i = week.findIndex((s) => s.date === day.date && s.meal === meal)
      if (i >= 0) week[i] = slot
      else week.push(slot)
      filled.push(slot)
    }
  }
  return filled
}

export interface Recommendation {
  date: ISODate
  meal: Meal
  recipeId: string
  replaces: string | null
  reason: string
  savesCents: number | null
}

export function weekRecommendations(args: {
  days: DayContext[]
  week: PlannedSlot[]
  candidates: Candidate[]
  seed: string
}): Recommendation[] {
  const recs: Recommendation[] = []
  for (const day of args.days) {
    for (const meal of MEALS) {
      if (recs.length >= 3) return recs
      const existing = args.week.find((s) => s.date === day.date && s.meal === meal)
      if (existing && (existing.recipeId || existing.kind !== 'recipe')) continue
      const best = scoreCandidates({ date: day.date, meal, day, week: args.week, candidates: args.candidates, seed: args.seed })[0]
      if (!best) continue
      recs.push({
        date: day.date,
        meal,
        recipeId: best.recipeId,
        replaces: null,
        reason: best.reasons[0] ?? 'A good fit for this slot',
        savesCents: null,
      })
    }
  }
  return recs
}

export function weekSummary(args: { week: PlannedSlot[]; candidates: Candidate[] }): {
  estCostCents: number | null
  shared: Array<{ ingredientId: string; uses: number }>
  filled: number
  total: number
} {
  const byId = new Map(args.candidates.map((c) => [c.recipeId, c]))
  const counts = new Map<string, number>()
  let cost: number | null = null
  let filled = 0
  for (const s of args.week) {
    if (s.kind !== 'recipe' || s.recipeId) filled++
    const c = s.recipeId ? byId.get(s.recipeId) : undefined
    if (!c) continue
    if (c.estCostCents !== null) cost = (cost ?? 0) + c.estCostCents
    for (const i of new Set(c.ingredientIds)) counts.set(i, (counts.get(i) ?? 0) + 1)
  }
  const shared = [...counts].filter(([, n]) => n >= 2).map(([ingredientId, uses]) => ({ ingredientId, uses }))
  return { estCostCents: cost, shared, filled, total: 21 }
}
