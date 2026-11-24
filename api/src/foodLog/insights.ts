import { tuneItems, type TuneResponse } from '../../../shared/foodLog/insights'
import { addDays } from '../../../shared/planningApi'
import { historyNow, loadHistory } from '../mealHistory/db'
import { getHousehold, getSetting, listThemes } from '../planning/db'
import { loadFoodLog } from './db'

// The "Tune" list (shared/foodLog/insights.ts tuneItems) over the last 8 weeks.

const WINDOW_DAYS = 56

const ids = (s: string | null): string[] => {
  try {
    const v = s ? (JSON.parse(s) as unknown) : []
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export async function tuneView(env: Env): Promise<TuneResponse> {
  const db = env.DB
  const now = historyNow()
  const from = addDays(now.date, -WINDOW_DAYS)
  const [items, history, household, themes, rotation, recipes] = await Promise.all([
    loadFoodLog(db, from, now.date),
    loadHistory(db, from, now.date, now),
    getHousehold(db),
    listThemes(db),
    getSetting(db, 'breakfast_rotation'),
    db.prepare('SELECT id, title FROM recipes WHERE archived_at IS NULL').all<{ id: string; title: string }>(),
  ])
  return {
    items: tuneItems({
      today: now.date,
      people: household.people,
      items,
      history,
      rotation: ids(rotation),
      titles: new Map(recipes.results.map((r) => [r.id, r.title])),
      themes,
    }),
  }
}
