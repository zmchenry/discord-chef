import { useCallback, useEffect, useRef, useState } from "react";

import { formatDuration } from "./cookText";
import { primeAudio, ringTimer } from "./device";

// Cooking mode's state for one recipe: the current step, checked-off
// ingredients, the servings, and the timers. It lives in sessionStorage
// (this tab only), so a reload or a trip to the recipe and back keeps it.
// Timers store their end time, so they keep counting while you're away;
// they only ring while cooking mode is open.

export interface CookTimer {
  /** `${step}:${n}`: the nth duration found in that step. */
  id: string;
  step: number;
  seconds: number;
  /** Epoch ms when it ends while running; null while paused. */
  endsAt: number | null;
  /** Ms left while paused. */
  remainingMs: number;
  /** Set once it has rung. */
  doneAt: number | null;
}

export interface CookState {
  step: number;
  checked: number[];
  /** Servings to cook, in halves; null = where the stepper starts (2, or the plan). */
  scale: number | null;
  /** Servings planned for this meal (leftovers included), when opened from the plan. */
  planned: number | null;
  timers: CookTimer[];
}

const EMPTY: CookState = { step: 0, checked: [], scale: null, planned: null, timers: [] };
const key = (recipeId: string) => `chef.cook.${recipeId}`;

function load(recipeId: string): CookState {
  try {
    const raw = sessionStorage.getItem(key(recipeId));
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<CookState>) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

export function clearCookSession(recipeId: string) {
  try {
    sessionStorage.removeItem(key(recipeId));
  } catch {
    // Storage blocked: nothing was saved either.
  }
}

export const msLeft = (t: CookTimer, now: number) => (t.endsAt === null ? t.remainingMs : Math.max(0, t.endsAt - now));
export const isRunning = (t: CookTimer) => t.endsAt !== null && t.doneAt === null;

export function useCookSession(recipeId: string, recipeTitle: string) {
  const [state, setState] = useState<CookState>(() => load(recipeId));
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    try {
      sessionStorage.setItem(key(recipeId), JSON.stringify(state));
    } catch {
      // Private mode: state lasts as long as the page.
    }
  }, [recipeId, state]);

  // Tick while anything is running, and ring timers as they end.
  const title = useRef(recipeTitle);
  title.current = recipeTitle;
  const latest = useRef(state);
  latest.current = state;
  const anyRunning = state.timers.some(isRunning);
  useEffect(() => {
    if (!anyRunning) return;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      const ending = latest.current.timers.filter((x) => isRunning(x) && x.endsAt! <= t).map((x) => x.id);
      if (!ending.length) return;
      for (const x of latest.current.timers.filter((x) => ending.includes(x.id)))
        ringTimer(`Step ${x.step + 1} timer is done`, `${formatDuration(x.seconds)} · ${title.current}`, `chef-timer-${x.id}`);
      setState((s) => ({
        ...s,
        timers: s.timers.map((x) => (ending.includes(x.id) ? { ...x, doneAt: t, remainingMs: 0 } : x)),
      }));
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [anyRunning]);

  const update = useCallback((f: (s: CookState) => CookState) => setState(f), []);

  const setStep = useCallback((step: number) => update((s) => ({ ...s, step })), [update]);
  const toggleChecked = useCallback(
    (id: number) =>
      update((s) => ({ ...s, checked: s.checked.includes(id) ? s.checked.filter((x) => x !== id) : [...s.checked, id] })),
    [update],
  );
  const setScale = useCallback((scale: number | null) => update((s) => ({ ...s, scale })), [update]);
  // Opened from a planned meal: start at what was planned.
  const startPlanned = useCallback((planned: number) => update((s) => ({ ...s, scale: planned, planned })), [update]);

  // Tap a timer chip: start it, or pause and resume it while it runs.
  const toggleTimer = useCallback(
    (id: string, step: number, seconds: number) => {
      primeAudio();
      const t = Date.now();
      setNow(t);
      update((s) => {
        const existing = s.timers.find((x) => x.id === id);
        if (!existing || existing.doneAt !== null) {
          const fresh: CookTimer = { id, step, seconds, endsAt: t + seconds * 1000, remainingMs: seconds * 1000, doneAt: null };
          return { ...s, timers: [...s.timers.filter((x) => x.id !== id), fresh] };
        }
        const next =
          existing.endsAt === null
            ? { ...existing, endsAt: t + existing.remainingMs }
            : { ...existing, endsAt: null, remainingMs: Math.max(0, existing.endsAt - t) };
        return { ...s, timers: s.timers.map((x) => (x.id === id ? next : x)) };
      });
    },
    [update],
  );
  const removeTimer = useCallback(
    (id: string) => update((s) => ({ ...s, timers: s.timers.filter((x) => x.id !== id) })),
    [update],
  );

  return { state, now, setStep, toggleChecked, setScale, startPlanned, toggleTimer, removeTimer };
}
