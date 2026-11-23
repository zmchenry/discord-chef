import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarCheck, ChevronLeft, ChevronRight, Copy, Eraser, Plus, RotateCcw, Target, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { addDays, sundayOf, todayIn, WEEKDAY_LONG, weekdayOf } from "../../../../shared/planningApi";
import { isoDateSchema } from "../../../../shared/schema";
import { OverflowMenu, type MenuItem } from "../../components/OverflowMenu";
import { Button, PageHeader, StateMessage } from "../../components/ui";
import { cx } from "../../lib/cx";
import { nutritionApi, nutritionKeys } from "../nutrition/api";
import { dayName, shortDate } from "../planning/format";
import { useSlotMutation, type SlotChange } from "../planning/queries";
import { ApplyModal } from "./ApplyModal";
import { ComparePanel } from "./ComparePanel";
import { usePlannedDay, useRecipeFacts, useSwapList } from "./data";
import { useScratchGoals } from "./goals";
import { MacroPanel, MacroStrip } from "./MacroPanel";
import {
  dayTotals,
  emptySlots,
  itemsFromPlan,
  planChanges,
  servingsToSave,
  SLOTS,
  VARIATION_NAMES,
  type DayScratch,
  type ScratchItem,
  type SlotKey,
  type Variation,
} from "./model";
import { RecipePicker } from "./RecipePicker";
import { SlotCard } from "./SlotCard";
import { loadDay, loadRecent, pushRecent, saveDay, type RecentRecipe } from "./storage";

let seq = 0;
const newKey = () => `${Date.now().toString(36)}-${(seq++).toString(36)}`;
const copyVariation = (v: Variation, name: Variation["name"]): Variation => ({
  name,
  slots: Object.fromEntries(SLOTS.map((s) => [s, v.slots[s].map((i) => ({ ...i, key: newKey() }))])) as Variation["slots"],
});

// /plan/scratch?date=: try breakfast, lunch, dinner and snack combinations
// for one day and watch each person's macros against their goals. Up to
// three variations (A, B, C) per day, kept in this browser. Nothing touches
// the plan until "Use for <day>".
export function ScratchPadPage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get("date");
  const date = requested && isoDateSchema.safeParse(requested).success ? requested : todayIn();
  const goals = useScratchGoals();
  const planned = usePlannedDay(date);
  const [recent, setRecent] = useState<RecentRecipe[]>(() => loadRecent());
  const [state, setState] = useState<{ date: string; day: DayScratch } | null>(null);
  const [picking, setPicking] = useState<{ slot: SlotKey; key: string | null } | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const slotMutation = useSlotMutation(planned.weekId);
  const qc = useQueryClient();
  const navigate = useNavigate();

  // Load the stored day, or start variation A from the plan once it's in.
  const fromPlan = (): DayScratch => ({ active: 0, variations: [{ name: "A", slots: itemsFromPlan(planned.plan, newKey) }] });
  const ready = state?.date === date;
  useEffect(() => {
    if (ready) return;
    const stored = loadDay(date);
    if (stored) setState({ date, day: stored });
    else if (!planned.isPending)
      setState({ date, day: planned.isError ? { active: 0, variations: [{ name: "A", slots: emptySlots() }] } : fromPlan() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, ready, planned.isPending]);
  useEffect(() => {
    if (state) saveDay(state.date, state.day);
  }, [state]);

  const day = ready ? state.day : null;
  const variations = day?.variations ?? [];
  const active = day?.active ?? 0;
  const ids = variations.flatMap((v) => SLOTS.flatMap((s) => v.slots[s].flatMap((i) => (i.recipeId ? [i.recipeId] : []))));
  const facts = useRecipeFacts(ids);
  const people = goals.value?.people ?? [];
  const totals = useMemo(
    () => (goals.value ? variations.map((v) => dayTotals({ people, goals: goals.value!.goals, variation: v, facts })) : []),
    // facts is rebuilt each render; its content is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [variations, goals.value, JSON.stringify(facts)],
  );

  const update = (f: (d: DayScratch) => DayScratch) => {
    setSaved(null);
    setState((s) => (s ? { date: s.date, day: f(s.day) } : s));
  };
  const editActive = (f: (slots: Variation["slots"]) => Variation["slots"]) =>
    update((d) => ({ ...d, variations: d.variations.map((v, i) => (i === d.active ? { ...v, slots: f(v.slots) } : v)) }));
  const setItems = (slot: SlotKey, f: (items: ScratchItem[]) => ScratchItem[]) => editActive((s) => ({ ...s, [slot]: f(s[slot]) }));

  const place = (slot: SlotKey, key: string | null, r: RecentRecipe) => {
    setRecent(pushRecent(r));
    setItems(slot, (items) => {
      const at = key ? items.findIndex((i) => i.key === key) : -1;
      if (at < 0) return [...items, { key: newKey(), recipeId: r.id, title: r.title, icon: r.icon, servings: 2 }];
      const old = items[at]!;
      return items.map((i, n) => (n === at ? { key: old.key, recipeId: r.id, title: r.title, icon: r.icon, servings: old.servings } : i));
    });
  };

  const weekId = sundayOf(date);
  const dayLabel = WEEKDAY_LONG[weekdayOf(date)]!;
  const current = variations[active];
  const changes = current ? planChanges(current, planned.plan) : [];

  const apply = async () => {
    setApplyError(null);
    try {
      const writes: SlotChange[] = changes
        .filter((c) => c.action === "replace")
        .map((c) => ({
          date,
          meal: c.meal,
          set: { kind: c.to!.marker ?? "recipe", recipeId: c.to!.marker ? null : c.to!.recipeId },
          recipe: c.to!.marker ? null : { id: c.to!.recipeId!, title: c.to!.title, icon: c.to!.icon, totalMinutes: null },
        }));
      if (writes.length) await slotMutation.mutateAsync(writes);
      for (const c of changes) {
        if (c.action !== "replace" && c.action !== "servings") continue;
        if (c.action === "replace" && c.to!.servings === 2) continue;
        await nutritionApi.setServings(weekId, date, c.meal, servingsToSave(c.to!.servings));
      }
      await qc.invalidateQueries({ queryKey: nutritionKeys.weekAll(weekId) });
      setApplying(false);
      setSaved(`${current!.name} is now ${dayLabel}'s plan.`);
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : "Couldn't save the plan.");
      throw e;
    }
  };

  const menu: MenuItem[] = [];
  if (day && current) {
    if (variations.length < VARIATION_NAMES.length)
      menu.push({
        label: `Copy ${current.name} to a new variation`,
        icon: Copy,
        onSelect: () =>
          update((d) => ({ active: d.variations.length, variations: [...d.variations, copyVariation(current, VARIATION_NAMES[d.variations.length]!)] })),
      });
    menu.push({
      label: `Reset ${current.name} to the plan`,
      icon: RotateCcw,
      onSelect: () => editActive(() => itemsFromPlan(planned.plan, newKey)),
    });
    menu.push({ label: `Clear ${current.name}`, icon: Eraser, onSelect: () => editActive(() => emptySlots()) });
    if (variations.length > 1)
      menu.push({
        label: `Delete ${current.name}`,
        icon: Trash2,
        destructive: true,
        onSelect: () =>
          update((d) => ({
            active: Math.max(0, d.active - 1),
            // Letters follow position, so the rest stay A, B.
            variations: d.variations.filter((_, i) => i !== d.active).map((v, i) => ({ ...v, name: VARIATION_NAMES[i]! })),
          })),
      });
    menu.push({ label: "Goals", icon: Target, onSelect: () => navigate("/more/goals") });
  }

  const goDate = (d: string) => setParams({ date: d }, { replace: true });
  const t = totals[active];
  const primary = current && (
    <Button className="w-full lg:w-auto lg:px-6" onClick={() => setApplying(true)} disabled={planned.isPending}>
      <CalendarCheck size={18} aria-hidden="true" /> Use {current.name} for {dayName(date)}
    </Button>
  );

  return (
    // A board with a side column: on desktop it widens past the shell's
    // reading column (720px) to at most 1120px, still centred.
    <div className="lg:mx-[calc(50%_-_min(560px,_50vw_-_2rem))]">
      <Link
        to={weekId === sundayOf(todayIn()) ? "/week" : `/week?week=${weekId}`}
        className="pressable ml-2 mt-3 inline-flex min-h-11 items-center gap-1 rounded-full pr-3 font-semibold text-text no-underline"
      >
        <ArrowLeft size={20} aria-hidden="true" /> Week
      </Link>
      <PageHeader
        title="Scratch pad"
        action={
          <div className="flex items-center gap-2">
            {primary && <div className="hidden lg:block">{primary}</div>}
            {menu.length > 0 && <OverflowMenu items={menu} title="Scratch pad" />}
          </div>
        }
      />
      <div className="flex items-center gap-1 px-2 pb-2">
        <button
          type="button"
          aria-label="Previous day"
          onClick={() => goDate(addDays(date, -1))}
          className="pressable grid size-11 place-items-center rounded-full bg-transparent text-text hover:bg-surface-2"
        >
          <ChevronLeft size={22} />
        </button>
        <p className="m-0 min-w-0 flex-1 text-center font-semibold lg:flex-none lg:px-2">
          {dayLabel}, {shortDate(date)}
          {date === todayIn() && <span className="font-normal text-muted"> · today</span>}
        </p>
        <button
          type="button"
          aria-label="Next day"
          onClick={() => goDate(addDays(date, 1))}
          className="pressable grid size-11 place-items-center rounded-full bg-transparent text-text hover:bg-surface-2"
        >
          <ChevronRight size={22} />
        </button>
      </div>

      {!day || goals.isPending ? (
        <StateMessage title="Setting up the day…" />
      ) : goals.isError ? (
        <StateMessage title="Couldn't load goals">{goals.error.message}</StateMessage>
      ) : (
        <>
          {t && <MacroStrip people={people} totals={t} />}
          <div className="grid gap-4 px-4 pt-3 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start lg:gap-6">
            <div className="grid min-w-0 gap-3">
              <VariationTabs
                variations={variations}
                active={active}
                onPick={(i) => update((d) => ({ ...d, active: i }))}
                onAdd={() =>
                  update((d) => ({
                    active: d.variations.length,
                    variations: [...d.variations, copyVariation(d.variations[d.active]!, VARIATION_NAMES[d.variations.length]!)],
                  }))
                }
              />
              {saved && (
                <p role="status" className="m-0 flex flex-wrap items-center gap-x-2 rounded-sm bg-accent-soft px-3 py-2 text-sm font-semibold text-accent">
                  {saved}
                  <Link to={`/week?week=${weekId}`} className="text-accent">
                    See the week
                  </Link>
                </p>
              )}
              {SLOTS.map((slot) => (
                <SlotWithSwaps
                  key={`${active}-${slot}`}
                  date={date}
                  slot={slot}
                  items={current!.slots[slot]}
                  totals={t?.items ?? {}}
                  people={people}
                  recent={recent}
                  onSwap={(key, r) => place(slot, key, r)}
                  onPick={(key) => setPicking({ slot, key })}
                  onServings={(key, n) => setItems(slot, (items) => items.map((i) => (i.key === key ? { ...i, servings: n } : i)))}
                  onRemove={(key) => setItems(slot, (items) => items.filter((i) => i.key !== key))}
                  onAdd={() => setPicking({ slot, key: null })}
                />
              ))}
            </div>
            <div className="grid gap-4 lg:sticky lg:top-20">
              {t && <MacroPanel people={people} totals={t} name={current!.name} />}
              <ComparePanel
                people={people}
                variations={variations}
                totals={totals}
                active={active}
                onPick={(i) => update((d) => ({ ...d, active: i }))}
              />
            </div>
          </div>
          <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-[5] mt-3 flex bg-bg px-4 py-3 lg:hidden">
            {primary}
          </div>
        </>
      )}

      {picking && current && (
        <RecipePicker
          date={date}
          slot={picking.slot}
          currentId={current.slots[picking.slot].find((i) => i.key === picking.key)?.recipeId ?? null}
          recent={recent}
          onPick={(r) => {
            place(picking.slot, picking.key, r);
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}
      {applying && current && (
        <ApplyModal
          dayLabel={dayLabel}
          variation={current}
          changes={changes}
          error={applyError}
          onApply={apply}
          onClose={() => {
            setApplying(false);
            setApplyError(null);
          }}
        />
      )}
    </div>
  );
}

// A slot card with its own swap list (the hook needs the slot).
function SlotWithSwaps(
  props: Omit<Parameters<typeof SlotCard>[0], "swapList"> & { date: string; recent: RecentRecipe[] },
) {
  const { date, recent, ...rest } = props;
  const swapList = useSwapList(date, props.slot, recent);
  return <SlotCard {...rest} swapList={swapList} />;
}

function VariationTabs({
  variations,
  active,
  onPick,
  onAdd,
}: {
  variations: Variation[];
  active: number;
  onPick: (i: number) => void;
  onAdd: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <div role="tablist" aria-label="Variations" className="flex gap-1 rounded-full bg-surface-2 p-1">
        {variations.map((v, i) => (
          <button
            key={v.name}
            type="button"
            role="tab"
            aria-selected={i === active}
            onClick={() => onPick(i)}
            className={cx(
              "pressable min-h-11 min-w-14 rounded-full px-4 text-sm font-bold",
              i === active ? "bg-surface text-text shadow-card" : "bg-transparent text-muted",
            )}
          >
            {v.name}
          </button>
        ))}
      </div>
      {variations.length < VARIATION_NAMES.length && (
        <Button variant="ghost" className="px-3 text-sm text-primary" onClick={onAdd}>
          <Plus size={16} aria-hidden="true" /> Try another
        </Button>
      )}
    </div>
  );
}
