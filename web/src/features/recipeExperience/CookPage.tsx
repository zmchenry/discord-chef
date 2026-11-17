import { ArrowLeft, ArrowRight, ChevronDown, ListChecks, Mic, Sun, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type TouchEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

import { parseSteps, stepLabel, type RecipeStep } from "../../../../shared/recipeStructure";
import type { Recipe } from "../../../../shared/schema";
import { Modal } from "../../components/Modal";
import { Sheet } from "../../components/Sheet";
import { Button, LinkButton, StateMessage } from "../../components/ui";
import { cx } from "../../lib/cx";
import { useRecipe } from "../../lib/queries";
import { prefersReducedMotion, useWakeLock } from "./device";
import { scaleFactor } from "./cookText";
import { IngredientRows, ServingsStepper } from "./ingredients";
import { clearCookSession, isRunning, useCookSession } from "./session";
import { StepText } from "./StepText";
import { TimerBar } from "./TimerBar";

// /recipes/:id/cook: full screen, one step at a time, big type, the screen
// kept on, timers found in the step text, and the ingredients a tap away.
export function CookPage() {
  const { id = "" } = useParams();
  const recipe = useRecipe(id);
  if (recipe.isPending) return <StateMessage title="Loading…" />;
  if (recipe.isError)
    return (
      <StateMessage title="Couldn't load this recipe">
        <p className="m-0">{recipe.error.message}</p>
        <Link to="/recipes" className="inline-flex min-h-11 items-center font-semibold text-primary">
          Back to recipes
        </Link>
      </StateMessage>
    );
  return <CookView recipe={recipe.data} />;
}

function CookView({ recipe: r }: { recipe: Recipe }) {
  const steps = parseSteps(r.instructions);
  const cook = useCookSession(r.id, r.title);
  const { state } = cook;
  const awake = useWakeLock();
  const navigate = useNavigate();
  const location = useLocation();
  const [drawer, setDrawer] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const step = Math.min(state.step, Math.max(0, steps.length - 1));
  const factor = scaleFactor(r.servings, state.scale);
  const running = state.timers.filter(isRunning).length;

  const exit = (finished = false) => {
    if (finished) clearCookSession(r.id);
    // Opened from the recipe: go back, so Back doesn't return here.
    if ((location.state as { from?: string } | null)?.from === "recipe") navigate(-1);
    else navigate(`/recipes/${r.id}`, { replace: true });
  };
  const askExit = (finished = false) => (running && !finished ? setLeaving(true) : exit(finished));

  // Direction of the last move, for the slide-in.
  const dir = useRef(0);
  const go = (to: number) => {
    if (to < 0 || to >= steps.length || to === step) return;
    dir.current = to > step ? 1 : -1;
    cook.setStep(to);
  };

  // Left and right arrow keys, for a tablet with a keyboard.
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (drawer || leaving || e.target instanceof HTMLInputElement) return;
      if (e.key === "ArrowRight") goRef.current(step + 1);
      if (e.key === "ArrowLeft") goRef.current(step - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, drawer, leaving]);

  // Swipe left and right between steps; vertical drags still scroll.
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: TouchEvent) => {
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(step + (dx < 0 ? 1 : -1));
  };

  // Each new step slides in from the side it came from, and starts at the top.
  const content = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    content.current?.scrollTo?.({ top: 0 });
    heading.current?.focus({ preventScroll: true });
    if (!prefersReducedMotion() && dir.current)
      content.current?.firstElementChild?.animate?.(
        [
          { opacity: 0, transform: `translateX(${dir.current * 32}px)` },
          { opacity: 1, transform: "none" },
        ],
        { duration: 220, easing: "ease-out" },
      );
  }, [step]);

  const current: RecipeStep | undefined = steps[step];
  const last = step === steps.length - 1;

  return (
    <div className="pt-safe fixed inset-0 flex flex-col bg-bg text-text">
      <header className="flex items-center gap-1 px-2 pt-2">
        <button
          type="button"
          onClick={() => (step > 0 ? go(step - 1) : askExit())}
          aria-label={step > 0 ? "Previous step" : "Back to the recipe"}
          className="pressable grid size-12 place-items-center rounded-full"
        >
          <ArrowLeft size={24} aria-hidden="true" />
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setDrawer(true)}
          className="pressable inline-flex min-h-12 items-center gap-2 rounded-full px-3 font-semibold"
        >
          <ListChecks size={22} aria-hidden="true" />
          Ingredients
        </button>
        <button
          type="button"
          onClick={() => askExit()}
          aria-label="Close cooking mode"
          className="pressable grid size-12 place-items-center rounded-full"
        >
          <X size={24} aria-hidden="true" />
        </button>
      </header>

      <main
        ref={content}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="mx-auto grid max-w-[720px] grid-cols-1 gap-5 px-4 pb-6 pt-3">
          <div className="flex items-center justify-between gap-3">
            <p className="m-0 min-w-0 truncate font-semibold text-muted">
              {r.icon && <span aria-hidden="true">{r.icon} </span>}
              {r.title}
            </p>
            {awake && (
              <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold text-muted">
                <Sun size={14} aria-hidden="true" /> Screen stays on
              </span>
            )}
          </div>
          {current ? (
            <>
              <h1 ref={heading} tabIndex={-1} className="m-0 font-body text-3xl font-bold leading-tight outline-none">
                {stepLabel(current, step)}
              </h1>
              <StepNeeds recipe={r} step={current} factor={factor} key={step} />
              <StepText step={step} text={current.text} timers={state.timers} now={cook.now} onTimer={cook.toggleTimer} />
            </>
          ) : (
            <NoSteps recipe={r} factor={factor} checked={state.checked} onToggle={cook.toggleChecked} />
          )}
        </div>
      </main>

      <footer className="pb-safe border-t border-border bg-bg">
        <TimerBar
          timers={state.timers}
          now={cook.now}
          onToggle={(t) => cook.toggleTimer(t.id, t.step, t.seconds)}
          onRemove={cook.removeTimer}
        />
        {steps.length > 0 && (
          <div className="mx-auto grid max-w-[720px] gap-3 px-4 pb-3 pt-3">
            <Dots count={steps.length} current={step} onGo={go} />
            <div className="grid grid-cols-2 gap-3">
              <Button variant="secondary" className="min-h-14 text-lg" disabled={step === 0} onClick={() => go(step - 1)}>
                <ArrowLeft size={22} aria-hidden="true" />
                Previous
              </Button>
              <Button className="min-h-14 text-lg" onClick={() => (last ? askExit(true) : go(step + 1))}>
                {last ? "Done" : "Next"}
                {!last && <ArrowRight size={22} aria-hidden="true" />}
              </Button>
            </div>
          </div>
        )}
      </footer>

      {drawer && (
        <IngredientsDrawer
          recipe={r}
          factor={factor}
          scale={state.scale}
          checked={state.checked}
          onScale={cook.setScale}
          onToggle={cook.toggleChecked}
          onClose={() => setDrawer(false)}
        />
      )}

      <Modal
        open={leaving}
        size="sm"
        onClose={() => setLeaving(false)}
        title="Leave cooking mode?"
        description={`${running === 1 ? "A timer is" : `${running} timers are`} still running. They keep counting, but only ring while cooking mode is open.`}
        secondary={{ label: "Keep cooking", onClick: () => setLeaving(false) }}
        primary={{ label: "Leave", onClick: () => exit() }}
      />
    </div>
  );
}

// "What You Need" for this step: the ingredients its refs point at, or, for a
// step with no refs, the whole list, collapsed.
function StepNeeds({ recipe: r, step, factor }: { recipe: Recipe; step: RecipeStep; factor: number }) {
  const items = step.ingredientRefs.length
    ? step.ingredientRefs.map((n) => r.ingredients[n]).filter((i) => i !== undefined)
    : r.ingredients;
  const [open, setOpen] = useState(step.ingredientRefs.length > 0);
  const bodyId = useId();
  if (!items.length) return null;
  return (
    <section className="rounded-card border border-border">
      <h2 className="m-0 font-body text-lg font-bold">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen(!open)}
          className="flex min-h-14 w-full items-center justify-between gap-2 px-4 text-left"
        >
          <span>
            What you need
            {!step.ingredientRefs.length && <span className="font-semibold text-muted"> · all {items.length}</span>}
          </span>
          <ChevronDown
            size={22}
            aria-hidden="true"
            className={cx("shrink-0 transition-transform motion-reduce:transition-none", open && "rotate-180")}
          />
        </button>
      </h2>
      {open && (
        <div id={bodyId} className="border-t border-border px-4 pb-2 pt-1">
          <IngredientRows items={items} factor={factor} />
        </div>
      )}
    </section>
  );
}

function NoSteps({
  recipe: r,
  factor,
  checked,
  onToggle,
}: {
  recipe: Recipe;
  factor: number;
  checked: number[];
  onToggle: (id: number) => void;
}) {
  return (
    <>
      <h1 className="m-0 font-body text-3xl font-bold leading-tight">Ingredients</h1>
      <div className="grid justify-items-start gap-3 rounded-card bg-surface-2 p-4">
        <p className="m-0 text-xl font-semibold">No steps yet: add them by voice.</p>
        <LinkButton to={`/recipes/speak?recipe=${r.id}`} className="min-h-12">
          <Mic size={20} aria-hidden="true" />
          Add steps by voice
        </LinkButton>
      </div>
      {r.ingredients.length ? (
        <IngredientRows items={r.ingredients} factor={factor} checked={checked} onToggle={onToggle} />
      ) : (
        <p className="m-0 text-muted">No ingredients yet either.</p>
      )}
    </>
  );
}

function Dots({ count, current, onGo }: { count: number; current: number; onGo: (n: number) => void }) {
  return (
    <nav aria-label="Steps" className="flex items-center justify-center gap-3">
      <div className="flex flex-wrap items-center justify-center">
        {Array.from({ length: count }, (_, n) => (
          <button
            key={n}
            type="button"
            onClick={() => onGo(n)}
            aria-label={`Step ${n + 1}`}
            aria-current={n === current ? "step" : undefined}
            // A 24px target around each small dot.
            className="grid h-6 w-5 place-items-center"
          >
            <span
              aria-hidden="true"
              className={cx(
                "block rounded-full transition-all motion-reduce:transition-none",
                n === current ? "h-2.5 w-5 bg-primary" : "size-2 bg-border",
              )}
            />
          </button>
        ))}
      </div>
      <p className="m-0 shrink-0 text-sm font-semibold text-muted" aria-live="polite">
        Step {current + 1} of {count}
      </p>
    </nav>
  );
}

function IngredientsDrawer({
  recipe: r,
  factor,
  scale,
  checked,
  onScale,
  onToggle,
  onClose,
}: {
  recipe: Recipe;
  factor: number;
  scale: number | null;
  checked: number[];
  onScale: (s: number) => void;
  onToggle: (id: number) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const left = r.ingredients.filter((i) => !checked.includes(i.id)).length;
  return (
    <Sheet labelledBy={titleId} onClose={onClose}>
      <div className="flex items-center justify-between gap-2 px-4 pt-2">
        <div>
          <h2 id={titleId} className="m-0 font-body text-2xl font-bold">
            Ingredients
          </h2>
          <p className="m-0 text-sm text-muted">
            {r.ingredients.length === 0
              ? "None listed"
              : left === 0
                ? "All set out"
                : `${left} of ${r.ingredients.length} to set out`}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="pressable grid size-12 place-items-center rounded-full"
        >
          <X size={22} aria-hidden="true" />
        </button>
      </div>
      <div className="grid gap-4 overflow-y-auto px-4 pb-4 pt-3">
        <ServingsStepper base={r.servings} scale={scale} onChange={onScale} />
        <IngredientRows items={r.ingredients} factor={factor} checked={checked} onToggle={onToggle} />
      </div>
      <div className="pb-safe border-t border-border px-4 pt-3">
        <Button className="mb-3 min-h-12 w-full" onClick={onClose}>
          Back to the step
        </Button>
      </div>
    </Sheet>
  );
}
