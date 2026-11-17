import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Search, Sparkles } from "lucide-react";
import { useDeferredValue, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import type { GenerateIdeasResponse } from "../../../../shared/discovery";
import { WEEKDAY_LONG } from "../../../../shared/planningApi";
import { Modal } from "../../components/Modal";
import { ReasonChips } from "../../components/ReasonChips";
import { cx } from "../../lib/cx";
import { useRecipes } from "../../lib/queries";
import { planningApi } from "../planning/api";
import { planningKeys } from "../planning/queries";
import { useGenerateIdeas } from "./api";

type Mode = "theme" | "like";

// "Find ideas": pick a day theme or a recipe to be like, then search the web.
// On the Ideas page it closes when done (the list refreshes). Elsewhere
// (`showResults`) it lists what it found, with a way to the Ideas page.
export function FindIdeasModal({
  open,
  onClose,
  theme: initialTheme,
  showResults = false,
}: {
  open: boolean;
  onClose: () => void;
  /** A day theme label to start with. */
  theme?: string;
  showResults?: boolean;
}) {
  if (!open) return null;
  return <FindIdeasBody onClose={onClose} initialTheme={initialTheme} showResults={showResults} />;
}

function FindIdeasBody({
  onClose,
  initialTheme,
  showResults,
}: {
  onClose: () => void;
  initialTheme?: string;
  showResults: boolean;
}) {
  const themes = useQuery({ queryKey: planningKeys.themes, queryFn: ({ signal }) => planningApi.themes(signal) });
  const [mode, setMode] = useState<Mode>("theme");
  const [theme, setTheme] = useState(initialTheme ?? "");
  const [likeId, setLikeId] = useState<string>();
  const [q, setQ] = useState("");
  const query = useDeferredValue(q.trim());
  const recipes = useRecipes({ q: query || undefined, tag: "dinner" });
  const generate = useGenerateIdeas();
  const [found, setFound] = useState<GenerateIdeasResponse>();
  const navigate = useNavigate();

  const themeList = (themes.data ?? []).filter((t) => t.meals.includes("dinner"));
  // No dinner themes set up: start on "Like a recipe".
  useEffect(() => {
    if (themes.isSuccess && themeList.length === 0 && !initialTheme) setMode("like");
  }, [themes.isSuccess, themeList.length, initialTheme]);

  const ready = mode === "theme" ? !!theme : !!likeId;
  const run = async () => {
    const input = mode === "theme" ? { theme } : { likeRecipeId: likeId };
    const res = await generate.mutateAsync(input);
    if (showResults) setFound(res);
    else onClose();
  };

  if (found) {
    return (
      <Modal
        open
        onClose={onClose}
        title={found.ideas.length ? `${found.ideas.length} ideas` : "Nothing new"}
        description={
          found.ideas.length
            ? found.cached
              ? "Found earlier today. They're waiting in Ideas."
              : "Saved to Ideas, under Recipes."
            : "Every page it found is already in Ideas or the recipe box."
        }
        secondary={{ label: "Done", onClick: onClose }}
        primary={{ label: "See ideas", onClick: () => navigate("/recipes/ideas") }}
      >
        <ul className="m-0 grid list-none gap-2 p-0">
          {found.ideas.map((idea) => (
            <li key={idea.id} className="grid gap-1.5 rounded-sm bg-surface p-3 shadow-card">
              <a
                href={idea.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-start gap-1.5 font-semibold leading-snug text-text no-underline"
              >
                <span className="line-clamp-2">{idea.title}</span>
                <ExternalLink size={14} aria-hidden="true" className="mt-1 shrink-0 text-muted" />
                <span className="sr-only">(opens {idea.site ?? "the recipe page"})</span>
              </a>
              <p className="m-0 text-sm text-muted">
                {[idea.site, idea.minutes ? `${idea.minutes} min` : null].filter(Boolean).join(" · ")}
              </p>
              <ReasonChips why={idea.why} />
            </li>
          ))}
        </ul>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!generate.isPending}
      title="Find ideas"
      description="New dinners from around the web, for a day theme or like a recipe you love."
      secondary={{ label: "Cancel", onClick: onClose, disabled: generate.isPending }}
      primary={{ label: "Find ideas", icon: Sparkles, disabled: !ready, onClick: run }}
    >
      <div className="grid gap-4" aria-busy={generate.isPending}>
        <div role="group" aria-label="Find ideas for" className="grid grid-cols-2 gap-1 rounded-full bg-surface-2 p-1">
          {(
            [
              ["theme", "A day theme"],
              ["like", "Like a recipe"],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              disabled={generate.isPending}
              onClick={() => setMode(m)}
              className={cx(
                "pressable min-h-11 rounded-full px-3 text-sm font-bold",
                mode === m ? "bg-bg text-text shadow-card" : "bg-transparent text-muted",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "theme" ? (
          themes.isPending ? (
            <p className="m-0 text-muted">Loading themes…</p>
          ) : themeList.length === 0 ? (
            <p className="m-0 text-muted">No dinner themes yet. Add them in More → Day themes, or pick a recipe instead.</p>
          ) : (
            <Choices
              label="Day theme"
              value={theme}
              onChange={setTheme}
              disabled={generate.isPending}
              options={themeList.map((t) => ({ value: t.label, label: t.label, hint: WEEKDAY_LONG[t.weekday] }))}
            />
          )
        ) : (
          <div className="grid gap-2">
            <label className="flex min-h-11 items-center gap-2 rounded-sm border border-border bg-surface px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary">
              <Search size={18} className="shrink-0 text-muted" aria-hidden="true" />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search your dinners"
                aria-label="Search your dinners"
                disabled={generate.isPending}
                className="min-h-11 w-full border-0 bg-transparent text-base text-text outline-none placeholder:text-muted"
              />
            </label>
            {recipes.isPending ? (
              <p className="m-0 text-muted">Loading recipes…</p>
            ) : (recipes.data ?? []).length === 0 ? (
              <p className="m-0 text-muted">No dinners match.</p>
            ) : (
              <Choices
                label="Recipe to be like"
                value={likeId ?? ""}
                onChange={setLikeId}
                disabled={generate.isPending}
                options={(recipes.data ?? []).slice(0, 6).map((r) => ({
                  value: r.id,
                  label: `${r.icon ? `${r.icon} ` : ""}${r.title}`,
                }))}
              />
            )}
          </div>
        )}

        <p role="status" className="m-0 min-h-6 text-sm text-muted">
          {generate.isPending ? "Searching recipe sites. This takes up to a minute." : ""}
        </p>
        {generate.isError && (
          <p role="alert" className="m-0 font-semibold text-danger">
            {generate.error.message}
          </p>
        )}
      </div>
    </Modal>
  );
}

// A list of radio rows, each a full-width 44px+ tap target.
function Choices({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; hint?: string }[];
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-1.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cx(
              "pressable flex min-h-12 w-full items-center gap-3 rounded-sm bg-surface px-3 py-2 text-left shadow-card",
              on && "shadow-[inset_0_0_0_2px_var(--color-primary)]",
            )}
          >
            <span
              aria-hidden="true"
              className={cx(
                "grid size-5 shrink-0 place-items-center rounded-full",
                on ? "bg-primary" : "shadow-[inset_0_0_0_1.5px_var(--color-muted)]",
              )}
            >
              {on && <span className="size-2 rounded-full bg-on-primary" />}
            </span>
            <span className="min-w-0 flex-1 truncate font-semibold text-text">{o.label}</span>
            {o.hint && <span className="shrink-0 text-sm text-muted">{o.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}
