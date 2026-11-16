import { AppearancePage } from "./features/appearance/AppearancePage";
import { Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "./components/AppShell";
import { BreakfastLunchPage } from "./features/guidedDinners/BreakfastLunchPage";
import { ImportPage } from "./features/linkImport/ImportPage";
import { SpeakPage } from "./features/textImport/SpeakPage";
import { NotificationsPage } from "./features/notifications/NotificationsPage";
import { CalendarPage } from "./features/planning/CalendarPage";
import { ThemesPage } from "./features/planning/ThemesPage";
import { WeekPage } from "./features/planning/WeekPage";
import { MorePage } from "./pages/MorePage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ShoppingPage } from "./features/shopping/ShoppingPage";
import { RecipeDetailPage } from "./pages/RecipeDetailPage";
import { RecipeEditPage } from "./pages/RecipeEditPage";
import { RecipesPage } from "./pages/RecipesPage";

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/week" replace />} />
        <Route path="week" element={<WeekPage />} />
        <Route path="recipes" element={<RecipesPage />} />
        <Route path="recipes/new" element={<RecipeEditPage />} />
        <Route path="recipes/import" element={<ImportPage />} />
        <Route path="recipes/speak" element={<SpeakPage />} />
        <Route path="recipes/:id" element={<RecipeDetailPage />} />
        <Route path="recipes/:id/edit" element={<RecipeEditPage />} />
        <Route path="shop" element={<ShoppingPage />} />
        <Route path="more" element={<MorePage />} />
        <Route path="more/notifications" element={<NotificationsPage />} />
        <Route path="more/themes" element={<ThemesPage />} />
        <Route path="more/calendar" element={<CalendarPage />} />
        <Route path="more/breakfast-lunch" element={<BreakfastLunchPage />} />
        <Route path="more/appearance" element={<AppearancePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
