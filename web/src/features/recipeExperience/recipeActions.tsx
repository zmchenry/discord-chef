import { ChefHat, Link2, RefreshCw } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { sundayOf, todayIn } from "../../../../shared/planningApi";
import type { Recipe } from "../../../../shared/schema";
import type { MenuItem } from "../../components/OverflowMenu";
import { LinkButton } from "../../components/ui";
import { useWeek } from "../planning/queries";
import { LinkMergeModal } from "./LinkMergeModal";

export const cookPath = (id: string) => `/recipes/${id}/cook`;

// True when today's plan has this recipe in any meal.
function usePlannedToday(recipeId: string | undefined): boolean {
  const today = todayIn();
  const week = useWeek(sundayOf(today));
  return !!recipeId && !!week.data?.slots.some((s) => s.date === today && s.recipeId === recipeId);
}

// What the recipe detail page gets from this feature: "Cook" (the primary
// action when the recipe has steps and is on today's plan, otherwise in the
// ⋯ menu), and re-import from the recipe's link, or from a link you paste.
export function useRecipeExperience(r: Recipe | undefined): {
  cookNow: boolean;
  primary: ReactNode;
  menu: MenuItem[];
  dialogs: ReactNode;
} {
  const navigate = useNavigate();
  const planned = usePlannedToday(r?.id);
  const [linkDialog, setLinkDialog] = useState<null | "reimport" | "ask">(null);
  if (!r || r.archivedAt) return { cookNow: false, primary: null, menu: [], dialogs: null };

  const cookNow = planned && r.instructions.length > 0;
  const menu: MenuItem[] = [];
  if (!cookNow)
    menu.push({ label: "Cook", icon: ChefHat, onSelect: () => navigate(cookPath(r.id), { state: { from: "recipe" } }) });
  menu.push(
    r.sourceUrl
      ? {
          label: "Re-import from link",
          icon: RefreshCw,
          hint: "Fill in steps, ingredients and times",
          onSelect: () => setLinkDialog("reimport"),
        }
      : { label: "Import from a link…", icon: Link2, onSelect: () => setLinkDialog("ask") },
  );

  return {
    cookNow,
    primary: cookNow ? (
      <LinkButton to={cookPath(r.id)} state={{ from: "recipe" }} className="mt-1 justify-self-start">
        <ChefHat size={20} aria-hidden="true" />
        Cook
      </LinkButton>
    ) : null,
    menu,
    dialogs: linkDialog && (
      <LinkMergeModal
        recipe={r}
        initialUrl={linkDialog === "reimport" ? (r.sourceUrl ?? "") : ""}
        autoStart={linkDialog === "reimport"}
        onClose={() => setLinkDialog(null)}
      />
    ),
  };
}
