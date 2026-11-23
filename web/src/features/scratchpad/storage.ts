import { SLOTS, VARIATION_NAMES, type DayScratch, type ScratchItem } from "./model";

// The scratch pad lives in this browser only: one entry per date, plus the
// recipes picked lately. Storage can be missing or full; every access is
// wrapped and a failure just means starting fresh.

const dayKey = (date: string) => `chef.scratch.v1.${date}`;
const RECENT_KEY = "chef.scratch.v1.recent";
const RECENT_MAX = 12;

export interface RecentRecipe {
  id: string;
  title: string;
  icon: string | null;
}

function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or full: the pad still works, it just won't be remembered.
  }
}

const validItem = (i: unknown): i is ScratchItem =>
  !!i && typeof i === "object" && typeof (i as ScratchItem).key === "string" && typeof (i as ScratchItem).servings === "number";

// A stored day, or null when there is none (or it doesn't look right).
export function loadDay(date: string): DayScratch | null {
  const d = read<DayScratch>(dayKey(date));
  if (!d || !Array.isArray(d.variations) || d.variations.length === 0) return null;
  const variations = d.variations.slice(0, VARIATION_NAMES.length).map((v, i) => ({
    name: VARIATION_NAMES[i]!,
    slots: Object.fromEntries(SLOTS.map((s) => [s, (v.slots?.[s] ?? []).filter(validItem)])) as DayScratch["variations"][number]["slots"],
  }));
  return { active: Math.min(Math.max(0, d.active | 0), variations.length - 1), variations };
}

export const saveDay = (date: string, day: DayScratch) => write(dayKey(date), day);

export const loadRecent = (): RecentRecipe[] => (read<RecentRecipe[]>(RECENT_KEY) ?? []).filter((r) => r && typeof r.id === "string");

export function pushRecent(r: RecentRecipe): RecentRecipe[] {
  const next = [r, ...loadRecent().filter((x) => x.id !== r.id)].slice(0, RECENT_MAX);
  write(RECENT_KEY, next);
  return next;
}
