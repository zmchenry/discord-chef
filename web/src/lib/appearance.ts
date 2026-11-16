// Per-device appearance: which palette and whether to force light or dark.
// Stored in localStorage and applied as data-palette / data-mode on <html>
// (tokens.css keys off them). index.html runs the same logic inline before
// first paint so there's no flash; keep the storage key and attributes in step.

export type Palette = "diner" | "sage";
export type Mode = "system" | "light" | "dark";
export interface Appearance {
  palette: Palette;
  mode: Mode;
}

const KEY = "chef-appearance";
export const DEFAULT_APPEARANCE: Appearance = { palette: "diner", mode: "system" };

export function readAppearance(): Appearance {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<Appearance> | null;
    return {
      palette: raw?.palette === "sage" ? "sage" : "diner",
      mode: raw?.mode === "light" || raw?.mode === "dark" ? raw.mode : "system",
    };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function applyAppearance(a: Appearance): void {
  const root = document.documentElement;
  if (a.palette === "diner") delete root.dataset.palette;
  else root.dataset.palette = a.palette;
  if (a.mode === "system") delete root.dataset.mode;
  else root.dataset.mode = a.mode;
  syncThemeColor();
}

export function saveAppearance(a: Appearance): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    // Private mode or storage blocked: the choice still applies for this visit.
  }
  applyAppearance(a);
}

// The Android status bar follows <meta name="theme-color">: point every one
// of them at the current page background.
export function syncThemeColor(): void {
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--color-bg").trim();
  if (!bg) return;
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    m.content = bg;
  });
}
