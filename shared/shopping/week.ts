// Week ids are the ISO date of the week's Sunday, in America/New_York.

export const HOUSEHOLD_TZ = 'America/New_York'

// The calendar date in the household timezone, as YYYY-MM-DD.
export function localDate(now: Date, timeZone = HOUSEHOLD_TZ): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

const toUtc = (iso: string) => new Date(`${iso}T00:00:00Z`)

export function addDays(iso: string, days: number): string {
  const d = toUtc(iso)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// 0 = Sunday.
export const weekday = (iso: string) => toUtc(iso).getUTCDay()

export function weekIdFor(now: Date): string {
  const today = localDate(now)
  return addDays(today, -weekday(today))
}

// The week a shopping list is most likely wanted for: this week, except on
// Saturday, when the weekend trip is for the week that starts tomorrow.
export function defaultShoppingWeek(now: Date): string {
  const today = localDate(now)
  const id = weekIdFor(now)
  return weekday(today) === 6 ? addDays(id, 7) : id
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// "2026-11-15" -> "Nov 15 – 21", across a month "Nov 29 – Dec 5".
export function formatWeekRange(weekId: string): string {
  const a = toUtc(weekId)
  const b = toUtc(addDays(weekId, 6))
  const start = `${MONTHS[a.getUTCMonth()]} ${a.getUTCDate()}`
  const end = a.getUTCMonth() === b.getUTCMonth() ? `${b.getUTCDate()}` : `${MONTHS[b.getUTCMonth()]} ${b.getUTCDate()}`
  return `${start} – ${end}`
}
