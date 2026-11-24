import {
  eatenRecipeId,
  historyFacts,
  mainProtein,
  ratingsByRecipe,
  type Insight,
  type InsightsResponse,
  type MealEntry,
  type RecipeMeta,
} from '../../../shared/mealHistory'
import { addDays, sundayOf } from '../../../shared/planningApi'
import { foodLogFacts, itemName } from '../../../shared/foodLog/insights'
import type { FoodLogItem } from '../../../shared/foodLog'
import { loadFoodLog } from '../foodLog/db'
import { askClaudeJson, ClaudeError } from '../linkImport/claude'
import { historyNow, loadHistory, recipeMeta } from './db'

// The weekly "What we're eating" card: 3-5 observations and suggestions from
// the last 8 weeks. Facts are computed first (shared/mealHistory.ts
// historyFacts) and Claude only rewords, picks and adds to them, from the
// log and the recipe box it is sent. Without a key, or if Claude fails, the
// facts are the card. Cached per week in meal_insights, remade at most once
// a household day.

const WINDOW_DAYS = 56

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['insights'],
  properties: {
    insights: {
      type: 'array',
      description: '3 to 5 items',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'action', 'recipe_id', 'idea_query'],
        properties: {
          text: { type: 'string', description: 'One short sentence, at most 110 characters' },
          action: { type: 'string', enum: ['none', 'recipe', 'idea'] },
          recipe_id: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'An id from the recipe box when action is recipe' },
          idea_query: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'A short web search for new recipes when action is idea' },
        },
      },
    },
  },
} as const

const SYSTEM = `You look at a two-person household's meal history and write 3 to 5 short observations and suggestions for a "What we're eating" card in their meal-planning app.
Ground every item in the data given: the facts, the meal log and the recipe box. Never invent numbers, meals or recipes.
Only suggest recipes from the recipe box, by their id (action "recipe"). For something new that is not in the box, use action "idea" with a short search like "salmon sheet pan dinner".
The food log shows what each person really ate on top of the plan (chains, brands, snacks). For an outside item that keeps coming up, an "idea" like "like: Crisp & Green Southwest Salad" finds a home version.
Be specific and friendly, like "Chicken 9 of the last 14 dinners. Try fish on Grill Night." No preamble, no emoji except 👍 and 👎.`

interface ClaudeInsight {
  text: string
  action: 'none' | 'recipe' | 'idea'
  recipe_id: string | null
  idea_query: string | null
}

const STATUS_WORD: Record<MealEntry['status'], string> = { eaten: 'ate', skipped: 'skipped', ate_out: 'ate out', swapped: 'ate instead' }

function prompt(entries: MealEntry[], meta: Map<string, RecipeMeta>, box: Map<string, RecipeMeta>, facts: string[], today: string, themes: string[], food: FoodLogItem[] = []): string {
  const ratings = ratingsByRecipe(entries)
  const last = new Map<string, string>()
  for (const e of entries) {
    const id = eatenRecipeId(e)
    if (id && !last.has(id)) last.set(id, e.date) // entries are newest first
  }
  const log = entries.map((e) => {
    const id = eatenRecipeId(e) ?? e.plannedRecipeId
    const what = e.status === 'swapped' && !e.recipeId ? (e.freeText ?? 'something else') : id ? (meta.get(id)?.title ?? 'a recipe') : e.plannedKind === 'leftovers' ? 'leftovers' : ''
    const rating = e.rating === 1 ? ' 👍' : e.rating === -1 ? ' 👎' : ''
    return `${e.date} ${e.meal}: ${STATUS_WORD[e.status]} ${what}${rating}${e.confirmed ? '' : ' (assumed from the plan)'}`.trim()
  })
  const recipes = [...box].map(([id, m]) => {
    const r = ratings.get(id)
    const bits = [
      m.tags.join(','),
      mainProtein(m) ?? '',
      r ? `👍${r.up} 👎${r.down}` : '',
      last.has(id) ? `last ${last.get(id)}` : 'not in the log',
    ].filter(Boolean)
    return `${id} | ${m.title} | ${bits.join(' | ')}`
  })
  return [
    `Today is ${today}.`,
    themes.length ? `Day themes: ${themes.join('; ')}` : '',
    `<facts>\n${facts.join('\n') || 'none'}\n</facts>`,
    `<meal_log newest_first="true">\n${log.join('\n') || 'empty'}\n</meal_log>`,
    `<recipe_box format="id | title | tags | main protein | ratings | last eaten">\n${recipes.join('\n')}\n</recipe_box>`,
    food.length
      ? `<food_log note="what each person logged eating, on top of the plan">\n${food
          .slice(-150)
          .map((f) => `${f.date} ${f.meal} ${f.person}: ${f.quantity ? `${f.quantity} ` : ''}${itemName(f)}${f.recipeId ? ' (our recipe)' : ''}`)
          .join('\n')}\n</food_log>`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** Claude's items, keeping only actions that point at a real recipe. */
function fromClaude(items: ClaudeInsight[], box: Map<string, RecipeMeta>): Insight[] {
  return items
    .filter((i) => i.text?.trim())
    .slice(0, 5)
    .map((i) => ({
      text: i.text.trim(),
      action:
        i.action === 'recipe' && i.recipe_id && box.has(i.recipe_id)
          ? { type: 'recipe' as const, recipeId: i.recipe_id, title: box.get(i.recipe_id)!.title }
          : i.action === 'idea' && i.idea_query?.trim()
            ? { type: 'idea' as const, query: i.idea_query.trim().slice(0, 80) }
            : null,
    }))
}

async function generate(env: Env, today: string): Promise<{ insights: Insight[]; source: 'claude' | 'facts' }> {
  const entries = await loadHistory(env.DB, addDays(today, -WINDOW_DAYS), today)
  const box = await recipeMeta(env.DB)
  const missing = [...new Set(entries.map(eatenRecipeId).filter((id): id is string => !!id && !box.has(id)))]
  const meta = new Map([...box, ...(missing.length ? await recipeMeta(env.DB, missing) : [])])
  const food = await loadFoodLog(env.DB, addDays(today, -WINDOW_DAYS), today)
  // Food log facts first (they are about what was really eaten), then the plan's.
  const mealFacts = historyFacts(entries, meta, today)
  const foodFacts = foodLogFacts(food, today)
  const facts = [...foodFacts.slice(0, 2), ...mealFacts, ...foodFacts.slice(2)]
  const factInsights: Insight[] = facts.slice(0, 5)
  if (!env.ANTHROPIC_API_KEY || (entries.length === 0 && food.length === 0)) return { insights: factInsights, source: 'facts' }

  const { results: themeRows } = await env.DB.prepare('SELECT weekday, label FROM day_themes ORDER BY weekday').all<{ weekday: number; label: string }>()
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  try {
    const out = await askClaudeJson<{ insights: ClaudeInsight[] }>({
      system: SYSTEM,
      content: prompt(entries, meta, box, facts.map((f) => f.text), today, themeRows.map((t) => `${days[t.weekday]} ${t.label}`), food),
      schema: SCHEMA,
      apiKey: env.ANTHROPIC_API_KEY,
      logEvent: 'meal_insights_claude_error',
      who: 'The insights writer',
      maxTokens: 2000,
    })
    const insights = out ? fromClaude(out.insights ?? [], box) : []
    if (insights.length) return { insights, source: 'claude' }
  } catch (err) {
    if (!(err instanceof ClaudeError)) throw err
  }
  return { insights: factInsights, source: 'facts' }
}

interface CacheRow {
  week_id: string
  body: string
  source: 'claude' | 'facts'
  local_date: string
  generated_at: number
}

function response(row: CacheRow, today: string): InsightsResponse {
  return {
    weekId: row.week_id,
    insights: JSON.parse(row.body) as Insight[],
    source: row.source,
    generatedAt: row.generated_at,
    canRefresh: row.local_date !== today,
  }
}

/** The cached card for this week, made now if there is none (or `refresh` and not yet today). */
export async function weekInsights(env: Env, refresh: boolean, at = new Date()): Promise<InsightsResponse> {
  const today = historyNow(at).date
  const weekId = sundayOf(today)
  const cached = await env.DB.prepare('SELECT * FROM meal_insights WHERE week_id = ?1').bind(weekId).first<CacheRow>()
  if (cached && (!refresh || cached.local_date === today)) return response(cached, today)

  const { insights, source } = await generate(env, today)
  const row: CacheRow = { week_id: weekId, body: JSON.stringify(insights), source, local_date: today, generated_at: Date.now() }
  await env.DB.prepare(
    `INSERT INTO meal_insights (week_id, body, source, local_date, generated_at) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT (week_id) DO UPDATE SET body = excluded.body, source = excluded.source,
       local_date = excluded.local_date, generated_at = excluded.generated_at`,
  )
    .bind(row.week_id, row.body, row.source, row.local_date, row.generated_at)
    .run()
  return response(row, today)
}

