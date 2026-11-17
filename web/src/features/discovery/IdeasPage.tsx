import { ArrowLeft, Check, Clock, ExternalLink, Plus, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import type { Idea } from "../../../../shared/discovery";
import { ReasonChips } from "../../components/ReasonChips";
import { Button, Card, LinkButton, StateMessage } from "../../components/ui";
import { FindIdeasModal } from "./FindIdeasModal";
import { importPath, useIdeas, useSetIdeaStatus } from "./api";

// /recipes/ideas: recipes found on the web, grouped by the theme they were
// found for. "Add to recipes" runs the normal link import with the page; the
// idea shows as added once the recipe is saved.
export function IdeasPage() {
  const ideas = useIdeas();
  const [finding, setFinding] = useState(false);

  const groups = new Map<string, Idea[]>();
  for (const idea of ideas.data ?? []) {
    const key = idea.theme ?? "Ideas";
    groups.set(key, [...(groups.get(key) ?? []), idea]);
  }

  return (
    <div className="mx-auto grid max-w-[720px] gap-3 px-4 pb-6 pt-3">
      <header className="flex items-center gap-2">
        <LinkButton to="/recipes" variant="ghost" aria-label="Back to recipes" className="-ml-3 px-3">
          <ArrowLeft size={20} aria-hidden="true" />
        </LinkButton>
        <h1 className="m-0 min-w-0 flex-1 truncate text-3xl">Ideas</h1>
        <Button onClick={() => setFinding(true)} className="pl-3">
          <Sparkles size={18} aria-hidden="true" />
          Find ideas
        </Button>
      </header>

      {ideas.isPending ? (
        <StateMessage title="Loading ideas…" />
      ) : ideas.isError ? (
        <StateMessage title="Couldn't load ideas">{ideas.error.message}</StateMessage>
      ) : groups.size === 0 ? (
        <StateMessage title="No ideas yet">Find new dinners for a day theme, or more like a recipe you love.</StateMessage>
      ) : (
        [...groups].map(([theme, list]) => (
          <section key={theme} className="grid gap-2" aria-label={theme}>
            <h2 className="m-0 mt-2 font-body text-xs font-bold uppercase tracking-wider text-muted">{theme}</h2>
            <ul className="m-0 grid list-none gap-3 p-0">
              {[...list.filter((i) => i.status === "new"), ...list.filter((i) => i.status !== "new")].map((idea) => (
                <li key={idea.id}>
                  <IdeaCard idea={idea} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <FindIdeasModal open={finding} onClose={() => setFinding(false)} />
    </div>
  );
}

function IdeaCard({ idea }: { idea: Idea }) {
  const navigate = useNavigate();
  const setStatus = useSetIdeaStatus();
  const saved = idea.status === "saved";
  const meta = [idea.site, idea.minutes ? `${idea.minutes} min` : null].filter(Boolean);

  return (
    <Card className="grid gap-2 p-3">
      <div className="grid gap-0.5">
        <a
          href={idea.url}
          target="_blank"
          rel="noreferrer"
          className="flex min-h-11 items-start gap-1.5 py-1 font-display text-lg font-semibold leading-snug text-text no-underline"
        >
          <span className="line-clamp-2 min-w-0">{idea.title}</span>
          <ExternalLink size={16} aria-hidden="true" className="mt-1.5 shrink-0 text-muted" />
          <span className="sr-only">(opens the original page)</span>
        </a>
        {meta.length > 0 && (
          <p className="m-0 flex flex-wrap items-center gap-x-2 text-sm text-muted">
            {idea.site && <span>{idea.site}</span>}
            {idea.minutes ? (
              <span className="inline-flex items-center gap-1">
                <Clock size={14} aria-hidden="true" />
                {idea.minutes} min
              </span>
            ) : null}
          </p>
        )}
        {idea.ingredients.length > 0 && <p className="m-0 line-clamp-2 text-sm text-muted">{idea.ingredients.join(", ")}</p>}
      </div>
      <ReasonChips why={idea.why} />
      {saved ? (
        <p className="m-0 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-accent">
          <Check size={16} aria-hidden="true" /> In your recipes
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" className="pl-3" onClick={() => navigate(importPath(idea.url))}>
            <Plus size={18} aria-hidden="true" />
            Add to recipes
          </Button>
          <Button
            variant="ghost"
            className="px-3 text-muted"
            disabled={setStatus.isPending}
            onClick={() => setStatus.mutate({ id: idea.id, status: "dismissed" })}
          >
            <X size={18} aria-hidden="true" />
            Not for us
          </Button>
        </div>
      )}
    </Card>
  );
}
