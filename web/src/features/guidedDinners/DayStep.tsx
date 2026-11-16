import { Ban, Check, Lock, Plus, Repeat, Search, Utensils, type LucideIcon } from "lucide-react";
import { useDeferredValue, useRef, useState } from "react";

import type { SlotKind } from "../../../../shared/schema";
import type { Suggestion, WeekDay, WeekSlot } from "../../../../shared/planningApi";
import { ReasonChips } from "../../components/ReasonChips";
import { Button, Card, StateMessage } from "../../components/ui";
import { cx } from "../../lib/cx";
import { MARKER_LABEL } from "../planning/format";
import type { SlotChange } from "../planning/queries";
import { useDinnerIdeas } from "./api";

const QUICK: Array<{ kind: Exclude<SlotKind, "recipe">; icon: LucideIcon }> = [
  { kind: "leftovers", icon: Repeat },
  { kind: "eat_out", icon: Utensils },
  { kind: "skip", icon: Ban },
];

const OTHERS_SHOWN = 8;

// One day of the guided flow: the current pick, the three markers, then every
// dinner ranked, the theme's picks first. Each card says why it sits where it
// does. A tap picks it right away (saved through the slot PUT).
export function DayStep({
  weekId,
  day,
  slot,
  onPick,
}: {
  weekId: string;
  day: WeekDay;
  slot: WeekSlot | undefined;
  onPick: (set: NonNullable<SlotChange["set"]>, recipe?: SlotChange["recipe"]) => void;
}) {
  const [q, setQ] = useState("");
  const query = useDeferredValue(q);
  const ideas = useDinnerIdeas(weekId, day.date, query);
  const [showAll, setShowAll] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const theme = day.theme?.meals.includes("dinner") ? day.theme : null;

  const pickRecipe = (s: Suggestion) =>
    onPick(
      { kind: "recipe", recipeId: s.recipeId, locked: false },
      { id: s.recipeId, title: s.title, icon: s.icon, totalMinutes: s.totalMinutes },
    );

  const list = ideas.data ?? [];
  const themed = theme ? list.filter((s) => s.theme) : [];
  const others = theme ? list.filter((s) => !s.theme) : list;
  const shownOthers = showAll || query.trim() ? others : others.slice(0, OTHERS_SHOWN);

  return (
    <div className="grid gap-3">
      {slot && (
        <Card className="grid gap-1 p-3">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="m-0 text-xs font-bold uppercase tracking-wider text-muted">Picked</p>
              <p className="m-0 line-clamp-2 font-display text-lg font-semibold leading-snug">
                {slot.kind === "recipe" ? `${slot.recipe?.icon ? `${slot.recipe.icon} ` : ""}${slot.recipe?.title ?? "A recipe"}` : MARKER_LABEL[slot.kind]}
              </p>
              {slot.kind === "recipe" && slot.recipe?.totalMinutes != null && (
                <p className="m-0 text-sm text-muted">{slot.recipe.totalMinutes} min</p>
              )}
            </div>
            <Button
              variant="secondary"
              onClick={() => {
                search.current?.focus();
                search.current?.scrollIntoView({ block: "center", behavior: "smooth" });
              }}
            >
              Change
            </Button>
          </div>
          {slot.locked && (
            <p className="m-0 flex items-center gap-1.5 text-sm text-muted">
              <Lock size={14} aria-hidden="true" className="shrink-0" /> Locked. Picking something else unlocks it.
            </p>
          )}
        </Card>
      )}

      <div role="group" aria-label="Instead of a recipe" className="grid grid-cols-3 gap-1.5">
        {QUICK.map(({ kind, icon: Icon }) => {
          const on = slot?.kind === kind;
          return (
            <button
              key={kind}
              type="button"
              aria-pressed={on}
              onClick={() => onPick({ kind, recipeId: null, locked: false })}
              className={cx(
                "pressable flex min-h-11 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-2 text-sm font-semibold",
                on ? "bg-primary text-on-primary" : "bg-surface-2 text-text",
              )}
            >
              <Icon size={16} aria-hidden="true" className="shrink-0 max-[359px]:hidden" />
              {MARKER_LABEL[kind]}
            </button>
          );
        })}
      </div>

      <label className="flex min-h-11 items-center gap-2 rounded-sm border border-border bg-surface px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary">
        <Search size={18} className="shrink-0 text-muted" aria-hidden="true" />
        <input
          ref={search}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search dinners"
          aria-label="Search dinners"
          className="min-h-11 w-full border-0 bg-transparent text-base text-text outline-none placeholder:text-muted"
        />
      </label>

      {ideas.isPending ? (
        <StateMessage title="Finding ideas…" />
      ) : ideas.isError ? (
        <StateMessage title="Couldn't load ideas">{ideas.error.message}</StateMessage>
      ) : list.length === 0 ? (
        <StateMessage title={query.trim() ? "No dinners match" : "No ideas"}>
          {day.constraints.some((c) => c.kind === "eat_out" && c.meals.includes("dinner"))
            ? "The calendar says you're eating out."
            : "Try a search, or add more recipes."}
        </StateMessage>
      ) : (
        <>
          {theme && (
            <Group title={`${theme.label} picks`} empty={`No ${theme.label} recipes${query.trim() ? " match" : " yet"}.`}>
              {themed.map((s, i) => (
                <IdeaCard key={s.recipeId} s={s} rank={i + 1} current={slot?.recipeId === s.recipeId} onPick={pickRecipe} />
              ))}
            </Group>
          )}
          <Group title={theme ? "Other ideas" : query.trim() ? "Matches" : "Best fits"} empty="Nothing else.">
            {shownOthers.map((s, i) => (
              <IdeaCard key={s.recipeId} s={s} rank={i + 1} current={slot?.recipeId === s.recipeId} onPick={pickRecipe} />
            ))}
          </Group>
          {shownOthers.length < others.length && (
            <Button variant="ghost" className="justify-self-center" onClick={() => setShowAll(true)}>
              Show {others.length - shownOthers.length} more
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function Group({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <section className="grid gap-2">
      <h3 className="m-0 mt-1 font-body text-xs font-bold uppercase tracking-wider text-muted">{title}</h3>
      {children.length === 0 ? (
        <p className="m-0 text-sm text-muted">{empty}</p>
      ) : (
        <ol className="m-0 grid list-none gap-2 p-0">{children}</ol>
      )}
    </section>
  );
}

// The whole card is the tap target (a stretched button); the reason chips sit
// under its overlay.
function IdeaCard({
  s,
  rank,
  current,
  onPick,
}: {
  s: Suggestion;
  rank: number;
  current: boolean;
  onPick: (s: Suggestion) => void;
}) {
  return (
    <li
      className={cx(
        "relative grid gap-2 rounded-sm bg-surface p-3 shadow-card",
        current && "shadow-[inset_0_0_0_2px_var(--color-primary)]",
      )}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 w-5 shrink-0 text-center text-sm font-bold text-muted" aria-hidden="true">
          {rank}
        </span>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            aria-pressed={current}
            onClick={() => onPick(s)}
            className="m-0 block w-full bg-transparent p-0 text-left font-semibold leading-snug text-text after:absolute after:inset-0 after:rounded-sm after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-primary"
          >
            <span className="line-clamp-2">
              {s.icon ? `${s.icon} ` : ""}
              {s.title}
            </span>
          </button>
          {s.totalMinutes != null && <p className="m-0 text-sm text-muted">{s.totalMinutes} min</p>}
        </div>
        <span
          className={cx(
            "inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-sm font-semibold",
            current ? "bg-primary text-on-primary" : "bg-surface-2 text-text",
          )}
          aria-hidden="true"
        >
          {current ? <Check size={16} /> : <Plus size={16} />}
          {current ? "Picked" : "Pick"}
        </span>
      </div>
      <div className="pl-7">
        <ReasonChips why={s.why} reasons={s.reasons} />
      </div>
    </li>
  );
}
