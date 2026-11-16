import { describe, expect, it } from 'vitest'
import {
  autoFill,
  eventsToConstraints,
  parseIcs,
  scoreCandidates,
  weekRecommendations,
  weekSummary,
  type Candidate,
  type DayContext,
  type PlannedSlot,
} from '../../shared/planning'

// Week of Mon 2026-11-16 .. Sun 2026-11-22. Soccer started in October (EDT),
// so its November instances also check the DST change; Thu 19th is cancelled.
const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:soccer',
  'SUMMARY:Soccer',
  'DTSTART;TZID=America/New_York:20261013T173000',
  'DTEND;TZID=America/New_York:20261013T190000',
  'RRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20261231T235959Z',
  'EXDATE;TZID=America/New_York:20261119T173000',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:trip',
  'SUMMARY:Liz trip to Chicago',
  'DTSTART;VALUE=DATE:20261120',
  'DTEND;VALUE=DATE:20261123',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:parkers',
  'SUMMARY:Dinner at the Parkers',
  'DTSTART:20261118T233000Z',
  'DTEND:20261119T013000Z',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:dentist',
  'SUMMARY:Den',
  ' tist', // folded line
  'DTSTART;TZID=America/New_York:20261116T071500',
  'DTEND;TZID=America/New_York:20261116T080000',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')

const DAYS = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']

describe('calendar', () => {
  const events = parseIcs(ICS, DAYS[0]!, DAYS[6]!)

  it('expands RRULE with EXDATE, all-day trips and UTC times into New York time', () => {
    expect(events).toEqual([
      { title: 'Dentist', start: '2026-11-16T07:15:00-05:00', end: '2026-11-16T08:00:00-05:00', allDay: false },
      { title: 'Soccer', start: '2026-11-17T17:30:00-05:00', end: '2026-11-17T19:00:00-05:00', allDay: false },
      { title: 'Dinner at the Parkers', start: '2026-11-18T18:30:00-05:00', end: '2026-11-18T20:30:00-05:00', allDay: false },
      { title: 'Liz trip to Chicago', start: '2026-11-20', end: '2026-11-23', allDay: true },
    ])
  })

  it('turns events into per-day constraints with friendly reasons', () => {
    const c = eventsToConstraints(events, DAYS, { people: ['Zach', 'Liz'] })
    expect(c['2026-11-16']).toEqual([
      { kind: 'grab_and_go', meals: ['breakfast'], reason: 'Dentist 7:15 → grab-and-go breakfast' },
    ])
    expect(c['2026-11-17']).toEqual([
      { kind: 'max_minutes', minutes: 25, meals: ['dinner'], reason: 'Soccer 5:30–7 → 25 min or less' },
    ])
    expect(c['2026-11-18']).toEqual([
      { kind: 'eat_out', meals: ['dinner'], reason: 'Dinner at the Parkers → eating out' },
    ])
    expect(c['2026-11-19']).toEqual([])
    for (const d of DAYS.slice(4)) {
      expect(c[d]).toEqual([
        { kind: 'servings', count: 1, meals: ['breakfast', 'lunch', 'dinner'], reason: 'Liz away → cook for 1' },
      ])
    }
  })
})

// ---------------------------------------------------------------------------
// Engine

function cand(id: string, over: Partial<Candidate> = {}): Candidate {
  return {
    recipeId: id,
    title: id,
    tags: ['dinner'],
    ingredientIds: [],
    perishableIngredientIds: [],
    totalMinutes: 30,
    lastPlanned: '2026-10-01',
    estCostCents: null,
    ...over,
  }
}
const day = (date: string, over: Partial<DayContext> = {}): DayContext => ({ date, theme: null, constraints: [], ...over })
const slot = (date: string, meal: PlannedSlot['meal'], recipeId: string | null, over: Partial<PlannedSlot> = {}): PlannedSlot => ({
  date,
  meal,
  kind: recipeId ? 'recipe' : 'eat_out',
  recipeId,
  locked: false,
  source: 'manual',
  ...over,
})
const TUE = '2026-11-17'
const taco: DayContext['theme'] = { weekday: 2, label: 'Taco Tuesday', tags: ['mexican'], meals: ['dinner'] }

describe('scoreCandidates', () => {
  const rank = (candidates: Candidate[], d: DayContext = day(TUE), week: PlannedSlot[] = [], meal: PlannedSlot['meal'] = 'dinner') =>
    scoreCandidates({ date: d.date, meal, day: d, week, candidates, seed: 's' })

  it.each([
    {
      name: 'theme boosts to the top but does not filter',
      candidates: [cand('pasta'), cand('tacos', { tags: ['dinner', 'mexican'] })],
      d: day(TUE, { theme: taco }),
      order: ['tacos', 'pasta'],
      reason: ['tacos', 'Taco Tuesday'],
    },
    {
      name: 'meal tag is required unless a recipe has no meal tags',
      candidates: [cand('oats', { tags: ['breakfast'] }), cand('untagged', { tags: [] }), cand('stew')],
      order: ['stew', 'untagged'],
    },
    {
      name: 'max_minutes sinks slow recipes',
      candidates: [cand('roast', { totalMinutes: 90 }), cand('stirfry', { totalMinutes: 20 })],
      d: day(TUE, { constraints: [{ kind: 'max_minutes', minutes: 25, meals: ['dinner'], reason: 'Soccer 5:30–7 → 25 min or less' }] }),
      order: ['stirfry', 'roast'],
      reason: ['stirfry', '20 min, fits Soccer'],
    },
    {
      name: 'already in this week is a big penalty',
      candidates: [cand('chili'), cand('curry', { lastPlanned: '2026-11-10' })],
      week: [slot('2026-11-16', 'dinner', 'chili')],
      order: ['curry', 'chili'],
    },
    {
      name: 'perishable overlap with the week shows a reason',
      candidates: [
        cand('bowls', { ingredientIds: ['cilantro', 'rice'], perishableIngredientIds: ['cilantro'], ingredientNames: { cilantro: 'cilantro' } }),
        cand('soup', { ingredientIds: ['beans'] }),
        cand('tacos', { ingredientIds: ['cilantro', 'tortillas'], perishableIngredientIds: ['cilantro'] }),
      ],
      week: [slot('2026-11-16', 'dinner', 'tacos')],
      order: ['bowls', 'soup'],
      reason: ['bowls', 'Uses cilantro from Mon'],
    },
  ])('$name', ({ candidates, d, week, order, reason }) => {
    const r = rank(candidates, d, week)
    expect(r.map((x) => x.recipeId).filter((id) => order.includes(id))).toEqual(order)
    if (!order.includes('oats')) expect(r.some((x) => x.recipeId === 'oats')).toBe(false)
    if (reason) expect(r.find((x) => x.recipeId === reason[0])!.reasons).toContain(reason[1])
    for (const x of r) expect(x.reasons.length).toBeLessThanOrEqual(3)
  })

  it('returns nothing for an eat_out day and breaks ties by seed only', () => {
    const out = day(TUE, { constraints: [{ kind: 'eat_out', meals: ['dinner'], reason: 'x' }] })
    expect(rank([cand('a')], out)).toEqual([])
    const tied = [cand('a'), cand('b'), cand('c'), cand('d')]
    const once = rank(tied).map((x) => x.recipeId)
    expect(rank([...tied].reverse()).map((x) => x.recipeId)).toEqual(once)
  })
})

describe('autoFill', () => {
  it('fills only empty unlocked slots, marks eat_out, and is stable per seed', () => {
    const days = [day('2026-11-16'), day(TUE, { constraints: [{ kind: 'eat_out', meals: ['dinner'], reason: 'Party' }] })]
    const week: PlannedSlot[] = [
      slot('2026-11-16', 'dinner', 'locked-one', { locked: true }),
      slot('2026-11-16', 'lunch', 'manual-one'),
      slot('2026-11-16', 'breakfast', null, { kind: 'recipe', locked: true }), // locked empty: leave it
    ]
    const candidates = [cand('a', { tags: [] }), cand('b', { tags: [] }), cand('c', { tags: [] }), cand('d', { tags: [] })]
    const filled = autoFill({ days, week, candidates, seed: 'w1' })

    expect(filled.map((s) => `${s.date} ${s.meal} ${s.kind}`)).toEqual([
      '2026-11-17 breakfast recipe',
      '2026-11-17 lunch recipe',
      '2026-11-17 dinner eat_out',
    ])
    expect(filled.every((s) => s.source === 'auto' && !s.locked)).toBe(true)
    expect(new Set(filled.map((s) => s.recipeId).filter(Boolean)).size).toBe(2) // no repeats
    expect(week).toHaveLength(3) // input not mutated
    expect(autoFill({ days, week, candidates, seed: 'w1' })).toEqual(filled)
  })
})

describe('weekRecommendations', () => {
  it('suggests swapping an auto slot for a recipe that reuses more perishables', () => {
    const candidates = [
      cand('tacos', { ingredientIds: ['cilantro', 'lime', 'tortillas'], perishableIngredientIds: ['cilantro', 'lime'] }),
      cand('pasta', { ingredientIds: ['spaghetti'], estCostCents: 900 }),
      cand('bowls', {
        ingredientIds: ['cilantro', 'lime', 'rice'],
        perishableIngredientIds: ['cilantro', 'lime'],
        ingredientNames: { cilantro: 'cilantro', lime: 'limes' },
        estCostCents: 700,
      }),
    ]
    const week = [slot('2026-11-16', 'dinner', 'tacos'), slot(TUE, 'dinner', 'pasta', { source: 'auto' })]
    const recs = weekRecommendations({ days: [day('2026-11-16'), day(TUE)], week, candidates, seed: 's' })
    expect(recs).toEqual([
      { date: TUE, meal: 'dinner', recipeId: 'bowls', replaces: 'pasta', reason: 'Reuses cilantro and limes from Mon', savesCents: 200 },
    ])
  })
})

describe('weekSummary', () => {
  it('sums known costs and counts ingredients shared by 2+ recipes', () => {
    const candidates = [
      cand('tacos', { ingredientIds: ['cilantro', 'tortillas', 'beef'], estCostCents: 1200 }),
      cand('bowls', { ingredientIds: ['cilantro', 'rice', 'beef'], estCostCents: null }),
      cand('quesadilla', { ingredientIds: ['tortillas', 'cilantro'], estCostCents: 600 }),
    ]
    const week = [
      slot('2026-11-16', 'dinner', 'tacos'),
      slot('2026-11-17', 'dinner', 'bowls'),
      slot('2026-11-18', 'lunch', 'quesadilla'),
      slot('2026-11-18', 'dinner', null), // eat out
    ]
    expect(weekSummary({ week, candidates })).toEqual({
      estCostCents: 1800,
      shared: [
        { ingredientId: 'cilantro', uses: 3 },
        { ingredientId: 'beef', uses: 2 },
        { ingredientId: 'tortillas', uses: 2 },
      ],
      filled: 4,
      total: 21,
    })
    expect(weekSummary({ week: [], candidates }).estCostCents).toBeNull()
  })
})
