import { Check } from "lucide-react";
import { useEffect, useState } from "react";

import { Card, PageHeader } from "../../components/ui";
import { cx } from "../../lib/cx";
import { readAppearance, saveAppearance, syncThemeColor, type Appearance, type Mode, type Palette } from "../../lib/appearance";
import { BackToMore } from "../planning/SettingsLink";

const PALETTES: { id: Palette; name: string; hint: string; swatch: [string, string] }[] = [
  { id: "diner", name: "Tomato Diner", hint: "Tomato red and navy on plain white", swatch: ["var(--swatch-diner-1)", "var(--swatch-diner-2)"] },
  { id: "sage", name: "Sage", hint: "Calm sage and slate on plain grey", swatch: ["var(--swatch-sage-1)", "var(--swatch-sage-2)"] },
];
const MODES: { id: Mode; name: string }[] = [
  { id: "system", name: "Match phone" },
  { id: "light", name: "Light" },
  { id: "dark", name: "Dark" },
];

export function AppearancePage() {
  const [appearance, setAppearance] = useState<Appearance>(readAppearance);
  const update = (next: Partial<Appearance>) => {
    const merged = { ...appearance, ...next };
    setAppearance(merged);
    saveAppearance(merged);
  };

  // Following the phone: keep the status bar colour right when it flips.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", syncThemeColor);
    return () => mq.removeEventListener("change", syncThemeColor);
  }, []);

  return (
    <>
      <BackToMore />
      <PageHeader title="Appearance" />
      <div className="mx-auto grid w-full max-w-[720px] gap-5 px-4 pb-8">
        <section aria-labelledby="palette-h" className="grid gap-2">
          <h2 id="palette-h" className="m-0 text-lg">Colors</h2>
          <div role="radiogroup" aria-labelledby="palette-h" className="grid gap-2">
            {PALETTES.map((p) => {
              const on = appearance.palette === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => update({ palette: p.id })}
                  className={cx(
                    "pressable flex min-h-16 items-center gap-3 rounded-card border-2 bg-surface p-4 text-left shadow-card",
                    on ? "border-primary" : "border-transparent",
                  )}
                >
                  <span className="flex shrink-0 -space-x-1.5" aria-hidden="true">
                    {p.swatch.map((c) => (
                      <span key={c} className="h-7 w-7 rounded-full border-2 border-surface" style={{ background: c }} />
                    ))}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-text">{p.name}</span>
                    <span className="block text-sm text-muted">{p.hint}</span>
                  </span>
                  {on && <Check size={20} className="shrink-0 text-primary" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </section>

        <section aria-labelledby="mode-h" className="grid gap-2">
          <h2 id="mode-h" className="m-0 text-lg">Light or dark</h2>
          <Card className="p-1">
            <div role="radiogroup" aria-labelledby="mode-h" className="grid grid-cols-3 gap-1">
              {MODES.map((m) => {
                const on = appearance.mode === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => update({ mode: m.id })}
                    className={cx(
                      "pressable min-h-11 whitespace-nowrap rounded-sm px-1 text-sm font-bold",
                      on ? "bg-primary text-on-primary" : "bg-transparent text-text",
                    )}
                  >
                    {m.name}
                  </button>
                );
              })}
            </div>
          </Card>
          <p className="m-0 text-sm text-muted">Saved on this phone only, so you and Liz can each pick.</p>
        </section>
      </div>
    </>
  );
}
