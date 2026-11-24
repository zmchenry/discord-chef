import { Mic, Square } from "lucide-react";
import { useId, useState } from "react";

import { FOOD_MEAL_LABEL, FOOD_MEALS, type FoodMeal } from "../../../../shared/foodLog";
import { todayIn } from "../../../../shared/planningApi";
import { Modal } from "../../components/Modal";
import { cx } from "../../lib/cx";
import { dayTitle } from "../nutrition/format";
import { useDictation } from "../textImport/dictation";
import { useFoodMe, useParseFood, useSaveFood, useSetFoodMe } from "./api";
import { fmtKcal, mealNow, peopleFor, sumKcal, type Who } from "./format";
import { ItemEditor, type EditableItem } from "./ItemEditor";

const chip = "pressable min-h-11 rounded-full px-3 text-sm font-bold";

// "Log food": type, paste or say what you ate (one item per line), Claude
// splits and estimates it, you check the numbers, Save adds it all. For the
// signed-in person by default, or the other one, or both.
export function LogFoodSheet({ date = todayIn(), onClose }: { date?: string; onClose: () => void }) {
  const me = useFoodMe();
  const setMe = useSetFoodMe();
  const parse = useParseFood();
  const save = useSaveFood();
  const [text, setText] = useState("");
  const [meal, setMeal] = useState<FoodMeal>(() => (date === todayIn() ? mealNow() : "dinner"));
  const [who, setWho] = useState<Who | null>(null);
  const [items, setItems] = useState<EditableItem[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const mic = useDictation(text, setText);
  const textId = useId();
  const hintId = useId();

  const people = me.data?.people ?? [];
  const person = me.data?.person ?? null;
  const forWho: Who | null = who ?? person;
  const when = date === todayIn() ? "today" : dayTitle(date);

  const read = () => {
    if (mic.listening) mic.stop();
    return parse
      .mutateAsync({ text, meal })
      .then((r) => {
        setItems(r.items);
        setMessage(
          r.source === "none" ? (r.message ?? "No estimates right now. Add numbers if you know them, or save as is.") : null,
        );
      })
      .catch(() => undefined);
  };

  const confirm = () =>
    save
      .mutateAsync({ date, people: peopleFor(forWho!, people), items: items!.map(({ recipeTitle: _t, ...f }) => f) })
      .then(onClose)
      .catch(() => undefined);

  if (items) {
    const valid = items.length > 0 && items.every((i) => i.label.trim());
    const total = sumKcal(items);
    return (
      <Modal
        open
        onClose={onClose}
        title="Check and save"
        description={`${items.length} item${items.length === 1 ? "" : "s"} · ${fmtKcal(total)}${
          items.some((i) => i.kcal == null) ? " + unknown" : ""
        } · for ${forWho === "both" ? "both of you" : forWho}, ${when}`}
        primary={{ label: `Save ${items.length} item${items.length === 1 ? "" : "s"}`, onClick: confirm, disabled: !valid }}
        secondary={{ label: "Back", onClick: () => setItems(null) }}
      >
        <div className="grid gap-3">
          {message && (
            <p className="m-0 rounded-sm bg-surface-2 px-3 py-2 text-sm" role="status">
              {message}
            </p>
          )}
          {items.map((item, i) => (
            <ItemEditor
              key={i}
              item={item}
              onChange={(next) => setItems(items.map((x, j) => (j === i ? next : x)))}
              onRemove={() => setItems(items.filter((_, j) => j !== i))}
            />
          ))}
          <p className="m-0 text-sm text-muted">
            Breakfast, lunch or dinner logged here counts instead of the planned meal for {forWho === "both" ? "you both" : forWho}. Snacks add on top.
          </p>
          {save.isError && <p className="m-0 text-sm font-semibold text-danger">{save.error.message}</p>}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Log food"
      description={`What you actually ate ${when}.`}
      primary={{
        label: parse.isPending ? "Estimating…" : "Estimate",
        onClick: read,
        disabled: !text.trim() || !forWho,
        busy: parse.isPending,
      }}
      secondary={{ label: "Cancel", onClick: onClose }}
    >
      <div className="grid gap-4">
        {me.isSuccess && !person ? (
          <div className="grid gap-2">
            <p className="m-0 text-sm font-semibold">Which one are you? Chef remembers it.</p>
            <div role="group" aria-label="I am" className="flex flex-wrap gap-1.5">
              {people.map((p) => (
                <button key={p} type="button" onClick={() => setMe.mutate(p)} className={cx(chip, "bg-surface-2 text-text")}>
                  I'm {p}
                </button>
              ))}
            </div>
          </div>
        ) : (
          people.length > 1 &&
          person && (
            <div role="group" aria-label="For" className="grid grid-cols-3 gap-1 rounded-full bg-surface-2 p-1">
              {[person, ...people.filter((p) => p !== person), "both"].slice(0, 3).map((w) => (
                <button
                  key={w}
                  type="button"
                  aria-pressed={forWho === w}
                  onClick={() => setWho(w)}
                  className={cx(
                    "pressable min-h-11 rounded-full text-sm font-bold",
                    forWho === w ? "bg-surface text-text shadow-card" : "bg-transparent text-muted",
                  )}
                >
                  {w === "both" ? "Both" : w === person ? `Me (${w})` : w}
                </button>
              ))}
            </div>
          )
        )}

        <div role="group" aria-label="Meal" className="grid grid-cols-4 gap-1">
          {FOOD_MEALS.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={meal === m}
              onClick={() => setMeal(m)}
              className={cx(chip, "px-1", meal === m ? "bg-primary text-on-primary" : "bg-surface-2 text-text")}
            >
              {FOOD_MEAL_LABEL[m]}
            </button>
          ))}
        </div>

        <div className="grid gap-1">
          <label htmlFor={textId} className="text-sm font-semibold">
            What did you eat?
          </label>
          <div className="relative">
            <textarea
              id={textId}
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-describedby={hintId}
              rows={6}
              placeholder={"Dunkin iced latte\n1/2 turkey sandwich\nApple"}
              className={cx(
                "block min-h-40 w-full rounded-sm border bg-surface px-3 py-2 pr-14 text-base leading-relaxed text-text placeholder:text-muted",
                mic.listening ? "border-primary shadow-[0_0_0_2px_var(--color-primary)]" : "border-border",
              )}
            />
            {mic.supported && (
              <button
                type="button"
                onClick={mic.listening ? mic.stop : mic.start}
                aria-pressed={mic.listening}
                aria-label={mic.listening ? "Stop listening" : "Say it instead"}
                className={cx(
                  "pressable absolute bottom-2 right-2 grid size-11 place-items-center rounded-full",
                  mic.listening ? "bg-danger text-on-primary" : "bg-primary text-on-primary",
                )}
              >
                {mic.listening ? <Square size={18} fill="currentColor" aria-hidden="true" /> : <Mic size={20} aria-hidden="true" />}
              </button>
            )}
          </div>
          <p id={hintId} className="m-0 text-sm text-muted">
            One per line; paste a list. Brands and amounts help, like “1/2 Crisp & Green Southwest Salad”. You can move items to other meals next.
          </p>
          {mic.error && <p className="m-0 text-sm font-semibold text-danger">{mic.error}</p>}
          {parse.isError && <p className="m-0 text-sm font-semibold text-danger">{parse.error.message}</p>}
        </div>
      </div>
    </Modal>
  );
}
