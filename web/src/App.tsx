import { AppearancePage } from "./features/appearance/AppearancePage";
import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { isStale, reloadForUpdate } from "./lib/freshness";

import { AppShell } from "./components/AppShell";
import { BreakfastLunchPage } from "./features/guidedDinners/BreakfastLunchPage";
import { IdeasPage } from "./features/discovery/IdeasPage";
import { CookPage } from "./features/recipeExperience/CookPage";
import { LinkImportRoute } from "./features/recipeExperience/LinkImportRoute";
import { SpeakPage } from "./features/textImport/SpeakPage";
import { GoalsPage } from "./features/nutrition/GoalsPage";
import { HistoryPage } from "./features/mealHistory/HistoryPage";
import { NutritionPage } from "./features/nutrition/NutritionPage";
import { ScratchPadPage } from "./features/scratchpad/ScratchPadPage";
import { NotificationsPage } from "./features/notifications/NotificationsPage";
import { PantryPage } from "./features/pantry/PantryPage";
import { CalendarPage } from "./features/planning/CalendarPage";
import { ThemesPage } from "./features/planning/ThemesPage";
import { WeekPage } from "./features/planning/WeekPage";
import { MorePage } from "./pages/MorePage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ShoppingPage } from "./features/shopping/ShoppingPage";
import { RecipeDetailPage } from "./pages/RecipeDetailPage";
import { RecipeEditPage } from "./pages/RecipeEditPage";
import { RecipesPage } from "./pages/RecipesPage";

// Dev-only page for looking at the modal layouts; not in production builds.
const ModalDemo = import.meta.env.DEV
  ? lazy(() => import("./features/modal/ModalDemo").then((m) => ({ default: m.ModalDemo })))
  : null;

// When a newer app is out (lib/freshness), moving to another page loads it.
function useReloadWhenStale() {
  const { pathname } = useLocation();
  useEffect(() => {
    if (isStale()) reloadForUpdate();
  }, [pathname]);
}

export default function App() {
  useReloadWhenStale();
  return (
    <Routes>
      <Route path="recipes/:id/cook" element={<CookPage />} />
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/week" replace />} />
        <Route path="week" element={<WeekPage />} />
        <Route path="week/nutrition" element={<NutritionPage />} />
        <Route path="plan/scratch" element={<ScratchPadPage />} />
        <Route path="recipes" element={<RecipesPage />} />
        <Route path="recipes/new" element={<RecipeEditPage />} />
        <Route path="recipes/import" element={<LinkImportRoute />} />
        <Route path="recipes/speak" element={<SpeakPage />} />
        <Route path="recipes/ideas" element={<IdeasPage />} />
        <Route path="recipes/:id" element={<RecipeDetailPage />} />
        <Route path="recipes/:id/edit" element={<RecipeEditPage />} />
        <Route path="shop" element={<ShoppingPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="more" element={<MorePage />} />
        <Route path="more/notifications" element={<NotificationsPage />} />
        <Route path="more/themes" element={<ThemesPage />} />
        <Route path="more/calendar" element={<CalendarPage />} />
        <Route path="more/breakfast-lunch" element={<BreakfastLunchPage />} />
        <Route path="more/goals" element={<GoalsPage />} />
        <Route path="more/appearance" element={<AppearancePage />} />
        <Route path="more/pantry" element={<PantryPage />} />
        {ModalDemo && (
          <Route
            path="dev/modal"
            element={
              <Suspense fallback={null}>
                <ModalDemo />
              </Suspense>
            }
          />
        )}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
