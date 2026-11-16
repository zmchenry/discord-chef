// Pure string normalisers shared by the Worker and the web app. The Worker is
// the authority (it normalises before every write); the web app uses the same
// functions only to preview or dedupe input before sending it.

// Canonical ingredient name: trimmed, lowercase, internal whitespace collapsed
// to single spaces. migrations/0001_init.sql enforces the trim/lowercase half
// of this with a CHECK, so a write that skips this function fails loudly.
export function normaliseIngredientName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ')
}

// Tags follow the same rule as ingredient names.
export const normaliseTag = normaliseIngredientName

// Normalise, drop empties and duplicates, keep first-seen order.
export function normaliseTags(raw: readonly string[]): string[] {
  const seen = new Set<string>()
  for (const t of raw) {
    const n = normaliseTag(t)
    if (n) seen.add(n)
  }
  return [...seen]
}
