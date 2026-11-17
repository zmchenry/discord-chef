// Pure text helpers for cooking mode: timers found in step text, and
// ingredient amounts scaled to a different number of servings.

// ---------------------------------------------------------------------------
// Durations

export interface StepDuration {
  /** What the step says, e.g. "1-2 minutes". */
  text: string;
  /** The timer length. A range uses its upper bound. */
  seconds: number;
}

const WORD_NUMBERS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  "twenty-five": 25,
  thirty: 30,
  forty: 40,
  "forty-five": 45,
  fifty: 50,
  sixty: 60,
  ninety: 90,
  couple: 2,
  "a couple": 2,
  "a couple of": 2,
  "half an": 0.5,
  "half a": 0.5,
};
const UNICODE: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3 };

// One amount: "10", "1.5", "1 1/2", "1½", "½", "1/2", or a word ("an", "five").
const WORDS = Object.keys(WORD_NUMBERS)
  .sort((a, b) => b.length - a.length)
  .join("|");
const NUM = String.raw`(?:\d+(?:\.\d+)?\s*[½¼¾⅓⅔]|\d+\s+\d+/\d+|\d+/\d+|\d+(?:\.\d+)?|[½¼¾⅓⅔]|${WORDS})`;
const UNIT = String.raw`(hours?|hrs?|minutes?|mins?|seconds?|secs?)`;
const DURATION_RE = new RegExp(
  String.raw`\b(${NUM})(?:\s*(?:-|–|—|to|or)\s*(${NUM}))?[\s-]*${UNIT}\b(\s+and\s+a\s+half)?` +
    // "1 hour 30 minutes", "1 hour and 15 minutes"
    String.raw`(?:,?\s*(?:and\s+)?(\d+)\s*(?:minutes?|mins?)\b)?`,
  "gi",
);

function amount(s: string): number {
  const t = s.trim().toLowerCase();
  if (t in WORD_NUMBERS) return WORD_NUMBERS[t];
  const withUni = t.match(/^(\d+(?:\.\d+)?)\s*([½¼¾⅓⅔])$/);
  if (withUni) return Number(withUni[1]) + UNICODE[withUni[2]];
  if (t in UNICODE) return UNICODE[t];
  const mixed = t.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = t.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  return Number(t);
}

const unitSeconds = (unit: string) => (/^h/i.test(unit) ? 3600 : /^m/i.test(unit) ? 60 : 1);

// "Simmer 10 minutes" -> 600 s, "1-2 minutes" -> 120 s, "an hour" -> 3600 s,
// "1 hour 30 minutes" -> 5400 s. Anything over a day is ignored.
export function detectDurations(step: string): StepDuration[] {
  const out: StepDuration[] = [];
  for (const m of step.matchAll(DURATION_RE)) {
    const [text, lo, hi, unit, half, extraMin] = m;
    // "a" and "an" need to be their own word before the unit ("an hour"),
    // not the end of another word; \b already guarantees that.
    let n = amount(hi ?? lo);
    if (half) n += 0.5;
    let seconds = Math.round(n * unitSeconds(unit));
    if (extraMin) seconds += Number(extraMin) * 60;
    if (seconds > 0 && seconds <= 24 * 3600) out.push({ text: text.trim(), seconds });
  }
  return out;
}

// 600 -> "10 min", 5400 -> "1 hr 30 min", 45 -> "45 sec", 90 -> "1 min 30 sec".
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h} hr`);
  if (m) parts.push(`${m} min`);
  if (s && !h) parts.push(`${s} sec`);
  return parts.join(" ") || "0 sec";
}

// A countdown: 605 -> "10:05", 3725 -> "1:02:05".
export function formatClock(seconds: number): string {
  const t = Math.max(0, Math.ceil(seconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

// ---------------------------------------------------------------------------
// Quantities

const NICE: [number, string][] = [
  [0, ""],
  [1 / 8, "⅛"],
  [1 / 4, "¼"],
  [1 / 3, "⅓"],
  [3 / 8, "⅜"],
  [1 / 2, "½"],
  [5 / 8, "⅝"],
  [2 / 3, "⅔"],
  [3 / 4, "¾"],
  [7 / 8, "⅞"],
  [1, ""],
];

// 1.5 -> "1½", 0.333 -> "⅓", 2 -> "2", 0.1 -> "0.1", 13.4 -> "13".
export function formatQuantity(n: number): string {
  if (!(n > 0)) return "0";
  let whole = Math.floor(n);
  const frac = n - whole;
  // Big amounts only get halves ("12½", not "13⅜").
  const choices = whole >= 10 ? NICE.filter(([v]) => v === 0 || v === 0.5 || v === 1) : NICE;
  let best = choices[0];
  for (const c of choices) if (Math.abs(frac - c[0]) < Math.abs(frac - best[0])) best = c;
  if (Math.abs(frac - best[0]) <= 0.02) {
    if (best[0] === 1) whole += 1;
    if (whole === 0 && !best[1]) return formatDecimal(n);
    return `${whole || ""}${best[1]}` || "0";
  }
  return whole >= 10 ? String(Math.round(n)) : formatDecimal(n);
}

// Count-like units take a plural; abbreviations don't.
const PLURAL: Record<string, string> = {
  cup: "cups",
  clove: "cloves",
  can: "cans",
  jar: "jars",
  package: "packages",
  bunch: "bunches",
  head: "heads",
  slice: "slices",
  piece: "pieces",
  pinch: "pinches",
  stick: "sticks",
};

// (1.5, "cup") -> "1½ cups", (0.5, "tsp") -> "½ tsp", (2, null) -> "2".
export function formatAmountText(quantity: number, unit: string | null): string {
  const n = formatQuantity(quantity);
  if (!unit) return n;
  return `${n} ${quantity > 1 && PLURAL[unit] ? PLURAL[unit] : unit}`;
}

const formatDecimal = (n: number) => String(Math.round(n * 100) / 100);

const UNI_IN: Record<string, string> = {
  "½": "1/2",
  "⅓": "1/3",
  "⅔": "2/3",
  "¼": "1/4",
  "¾": "3/4",
  "⅛": "1/8",
  "⅜": "3/8",
  "⅝": "5/8",
  "⅞": "7/8",
};
const QTY = String.raw`(?:\d+\s+\d+/\d+|\d+/\d+|\d*\.\d+|\d+)`;
const LEADING = new RegExp(String.raw`^(${QTY})(?:(\s*(?:-|–|to)\s*)(${QTY}))?(?![\d/.])`);

function parseQty(s: string): number {
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  return Number(s);
}

// The ingredient line with its leading amount multiplied:
// ("1 1/2 cups flour", 2) -> "3 cups flour", ("2-3 cloves garlic", 0.5) ->
// "1-1½ cloves garlic", ("salt", 2) -> "salt". A factor of 1 changes nothing.
export function scaleIngredientText(raw: string, factor: number): string {
  if (factor === 1) return raw;
  const s = raw
    .replace(/(\d)\s*([½⅓⅔¼¾⅛⅜⅝⅞])/g, (_m, d: string, f: string) => `${d} ${UNI_IN[f]}`)
    .replace(/^([½⅓⅔¼¾⅛⅜⅝⅞])/, (f) => UNI_IN[f]);
  const m = s.match(LEADING);
  if (!m) return raw;
  const lo = formatQuantity(parseQty(m[1]) * factor);
  const scaled = m[3] ? `${lo}${m[2]}${formatQuantity(parseQty(m[3]) * factor)}` : lo;
  return scaled + s.slice(m[0].length);
}

// Servings choices for the stepper. With a known yield it counts servings;
// without one it offers batch multipliers.
export const BATCH_FACTORS = [0.5, 1, 1.5, 2, 3, 4];

// The multiplier for amounts: servings over the yield, or the batch multiplier.
export const scaleFactor = (base: number | null, scale: number | null) => (scale === null ? 1 : base ? scale / base : scale);
