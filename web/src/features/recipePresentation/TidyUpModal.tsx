import { useQuery } from "@tanstack/react-query";
import { LoaderCircle, Sparkles } from "lucide-react";

import { displayIngredientName } from "../../../../shared/normalize";
import type { StructuredRecipe } from "../../../../shared/recipePresentation";
import { stepLabel, stepParagraphs } from "../../../../shared/recipeStructure";
import { Modal } from "../../components/Modal";
import { organizeApi } from "./api";
import { useOrganize } from "./queries";

// "Tidy up with AI": shows what Claude proposes (groups, step titles and
// paragraphs) and saves it only on confirm.
export function TidyUpModal({ recipe, open, onClose }: { recipe: StructuredRecipe; open: boolean; onClose: () => void }) {
  const preview = useQuery({
    queryKey: ["organize-preview", recipe.id, recipe.updatedAt],
    queryFn: () => organizeApi.preview(recipe.id),
    enabled: open,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
  });
  const organize = useOrganize();
  const proposal = preview.data;

  const groups = new Map<string, string[]>();
  proposal?.groups?.forEach((g, n) => {
    const i = recipe.ingredients[n];
    if (!g || !i) return;
    groups.set(g, [...(groups.get(g) ?? []), i.ingredientName ? displayIngredientName(i.ingredientName) : i.rawText]);
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Tidy up with AI"
      description="Step titles, shorter paragraphs and ingredient groups. Amounts and steps stay as written."
      primary={{
        label: "Save",
        icon: Sparkles,
        disabled: !proposal,
        onClick: async () => {
          if (!proposal) return;
          await organize.mutateAsync({ id: recipe.id, proposal });
          onClose();
        },
      }}
      secondary={{ label: "Cancel", onClick: onClose }}
    >
      {preview.isPending ? (
        <p className="m-0 flex items-center gap-2 text-muted" role="status">
          <LoaderCircle size={18} className="animate-spin" aria-hidden="true" /> Reading the recipe…
        </p>
      ) : preview.isError ? (
        <p className="m-0 font-semibold text-danger" role="alert">
          {preview.error.message}
        </p>
      ) : (
        <div className="grid gap-4">
          {groups.size > 0 && (
            <div className="grid gap-2">
              <h3 className="m-0 font-body text-base font-bold">Ingredient groups</h3>
              <ul className="m-0 grid list-none gap-1.5 p-0">
                {[...groups].map(([g, names]) => (
                  <li key={g} className="text-sm">
                    <span className="font-bold first-letter:uppercase">{g}</span>
                    <span className="text-muted">: {names.join(", ")}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {proposal && proposal.steps.length > 0 && (
            <div className="grid gap-2">
              <h3 className="m-0 font-body text-base font-bold">Method</h3>
              <ol className="m-0 grid list-none gap-3 p-0">
                {proposal.steps.map((s, n) => (
                  <li key={n} className="grid gap-1 text-sm">
                    <span className="font-bold">{stepLabel(s, n)}</span>
                    {stepParagraphs(s).map((p, k) => (
                      <span key={k} className="leading-relaxed text-muted">
                        {p}
                      </span>
                    ))}
                  </li>
                ))}
              </ol>
            </div>
          )}
          {organize.isError && (
            <p className="m-0 text-sm font-semibold text-danger" role="alert">
              Couldn’t save: {organize.error.message}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
