import { ArrowRight, Check, Plus, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import type { TuneItem } from "../../../../shared/foodLog/insights";
import { cx } from "../../lib/cx";
import { useAddToRotation, useTune } from "./api";

const linkClass = "pressable -my-1 inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold text-primary";

// "Tune": adjustments the food log backs up, under What we're eating. One
// tap where a setting exists (the breakfast rotation), else a link to the
// setting. Hidden when there is nothing to say.
export function TuneSection() {
  const tune = useTune();
  if (!tune.data?.length) return null;
  return (
    <div className="grid gap-3 border-t border-border pt-3">
      <h3 className="m-0 flex items-center gap-1.5 font-body text-xs font-bold uppercase tracking-wider text-accent">
        <SlidersHorizontal size={14} aria-hidden="true" /> Tune
      </h3>
      <ul className="m-0 grid list-none gap-3 p-0">
        {tune.data.map((item, i) => (
          <TuneRow key={i} item={item} />
        ))}
      </ul>
    </div>
  );
}

function TuneRow({ item }: { item: TuneItem }) {
  const add = useAddToRotation();
  const [done, setDone] = useState(false);
  const a = item.action;
  return (
    <li className="grid gap-0.5">
      <p className="m-0 leading-snug">{item.text}</p>
      {a?.type === "rotation_add" &&
        (done ? (
          <span className={cx(linkClass, "text-text")} role="status">
            <Check size={16} aria-hidden="true" /> Added to the breakfast rotation
          </span>
        ) : (
          <button
            type="button"
            className={cx(linkClass, "bg-transparent p-0")}
            disabled={add.isPending}
            onClick={() => add.mutate(a.recipeId, { onSuccess: () => setDone(true) })}
          >
            <Plus size={16} aria-hidden="true" /> {add.isPending ? "Adding…" : `Add ${a.title} to the rotation`}
          </button>
        ))}
      {a?.type === "link" && (
        <Link to={a.to} className={linkClass}>
          {a.label} <ArrowRight size={16} aria-hidden="true" />
        </Link>
      )}
      {add.isError && <p className="m-0 text-sm font-semibold text-danger">{add.error.message}</p>}
    </li>
  );
}
