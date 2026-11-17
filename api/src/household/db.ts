import { householdMembersSchema, type Member } from '../../../shared/household'
import { householdMembers, planServings, type MealServings } from '../../../shared/household/servings'
import { awayPeople } from '../../../shared/nutrition/week'
import { weekDates } from '../../../shared/planningApi'
import { getGoals, weekSlots } from '../nutrition/db'
import { weekConstraints } from '../planning/calendar'
import { getHousehold, getSetting, setSetting } from '../planning/db'

// Household members live in household_settings under one key: the adults'
// meals at home and portions, and the kids. The adults themselves are the
// household's people (GET /api/settings/household).

const KEY = 'household_members'

async function stored(db: D1Database): Promise<Member[] | null> {
  const raw = await getSetting(db, KEY)
  if (!raw) return null
  try {
    const parsed = householdMembersSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data.members : null
  } catch {
    return null
  }
}

export async function getMembers(db: D1Database, people?: readonly string[]): Promise<Member[]> {
  const [household, saved] = await Promise.all([people ? null : getHousehold(db), stored(db)])
  return householdMembers(people ?? household!.people, saved)
}

export async function saveMembers(db: D1Database, members: readonly Member[]): Promise<Member[]> {
  const { people } = await getHousehold(db)
  const clean = householdMembers(people, members)
  await setSetting(db, KEY, JSON.stringify({ members: clean }))
  return clean
}

// A week's servings by slot id: who each meal feeds and how far each recipe
// scales. Shopping reads the factors from here.
export async function weekServings(db: D1Database, weekId: string): Promise<Map<number, MealServings>> {
  const dates = weekDates(weekId)
  const [household, saved, goals, slots] = await Promise.all([
    getHousehold(db),
    stored(db),
    getGoals(db),
    weekSlots(db, weekId),
  ])
  const recipeIds = [...new Set(slots.flatMap((s) => (s.recipeId ? [s.recipeId] : [])))]
  const [calendar, recipes] = await Promise.all([
    weekConstraints(db, dates, household),
    db
      .prepare('SELECT id, servings FROM recipes WHERE id IN (SELECT value FROM json_each(?1))')
      .bind(JSON.stringify(recipeIds))
      .all<{ id: string; servings: number | null }>(),
  ])
  const result = planServings({
    dates,
    members: householdMembers(household.people, saved),
    goals,
    slots,
    away: Object.fromEntries(dates.map((d) => [d, awayPeople(calendar.byDay[d] ?? [], household.people)])),
    recipeServings: Object.fromEntries(recipes.results.map((r) => [r.id, r.servings])),
  })
  const byKey = new Map(result.map((r) => [`${r.date}:${r.meal}`, r]))
  return new Map(slots.flatMap((s) => {
    const ms = byKey.get(`${s.date}:${s.meal}`)
    return ms ? [[s.id, ms] as const] : []
  }))
}
