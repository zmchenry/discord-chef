import { ArrowRight, RefreshCw, Search, Sparkles } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

import type { Insight } from "../../../../shared/mealHistory";
import { cx } from "../../lib/cx";
import { useGenerateIdeas } from "../discovery/api";
import { TuneSection } from "../foodLog/TuneSection";
import { useInsights, useRefreshInsights } from "./api";

const relTime = new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });

// "What we're eating": 3-5 observations and suggestions from the last weeks,
// made once a week and refreshable once a day. An item can open a recipe or
// search the web for new ideas (the Ideas flow).
export function InsightsCard() {
  const insights = useInsights();
  const refresh = useRefreshInsights();
  const data = insights.data;

  return (
    <section aria-labelledby="insights-title" className="grid gap-3 rounded-card bg-accent-soft p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 id="insights-title" className="m-0 flex items-center gap-1.5 font-body text-xs font-bold uppercase tracking-wider text-accent">
            <Sparkles size={14} aria-hidden="true" /> What we're eating
          </h2>
          {data?.generatedAt && (
            <p className="m-0 mt-0.5 text-xs text-muted">
              {data.source === "claude" ? "AI summary" : "From your meal log"} · {relTime.format(data.generatedAt)}
            </p>
          )}
        </div>
        {data && (
          <button
            type="button"
            onClick={() => refresh.mutate()}
            disabled={!data.canRefresh || refresh.isPending}
            aria-label={data.canRefresh ? "Refresh insights" : "Refreshed today"}
            title={data.canRefresh ? "Refresh" : "Refreshed today. Try again tomorrow."}
            className="pressable -mr-2 -mt-2 grid size-11 shrink-0 place-items-center rounded-full bg-transparent text-accent disabled:opacity-50"
          >
            <RefreshCw size={18} aria-hidden="true" className={cx(refresh.isPending && "motion-safe:animate-spin")} />
          </button>
        )}
      </div>

      {insights.isPending ? (
        <p className="m-0 text-muted" role="status">
          Looking over the last few weeks…
        </p>
      ) : insights.isError ? (
        <p className="m-0 text-muted">Couldn't load insights right now.</p>
      ) : data!.insights.length === 0 ? (
        <p className="m-0 text-muted">Nothing stands out yet. Check back after a few more weeks of meals.</p>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0">
          {data!.insights.map((item, i) => (
            <InsightItem key={i} item={item} />
          ))}
        </ul>
      )}
      {refresh.isError && <p className="m-0 text-sm font-semibold text-danger">{refresh.error.message}</p>}
      <TuneSection />
    </section>
  );
}

function InsightItem({ item }: { item: Insight }) {
  const ideas = useGenerateIdeas();
  const navigate = useNavigate();
  const action = item.action;
  const linkClass = "pressable -my-1 inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold text-primary";
  return (
    <li className="grid gap-0.5 border-t border-border pt-3 first:border-t-0 first:pt-0">
      <p className="m-0 leading-snug">{item.text}</p>
      {action?.type === "recipe" && (
        <Link to={`/recipes/${encodeURIComponent(action.recipeId)}`} className={linkClass}>
          Open {action.title} <ArrowRight size={16} aria-hidden="true" />
        </Link>
      )}
      {action?.type === "idea" && (
        <button
          type="button"
          className={cx(linkClass, "bg-transparent p-0")}
          disabled={ideas.isPending}
          onClick={() => ideas.mutate({ theme: action.query }, { onSuccess: () => navigate("/recipes/ideas") })}
        >
          <Search size={16} aria-hidden="true" />
          {ideas.isPending ? "Searching recipe sites…" : (action.label ?? `Idea: find “${action.query}” recipes`)}
        </button>
      )}
      {ideas.isError && <p className="m-0 text-sm font-semibold text-danger">{ideas.error.message}</p>}
    </li>
  );
}
