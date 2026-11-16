import { Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "./components/AppShell";
import { ImportPage } from "./features/linkImport/ImportPage";
import { NotificationsPage } from "./features/notifications/NotificationsPage";
import { MorePage } from "./pages/MorePage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ShopPage, WeekPage } from "./pages/Placeholder";
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
        <Route path="recipes/:id" element={<RecipeDetailPage />} />
        <Route path="recipes/:id/edit" element={<RecipeEditPage />} />
        <Route path="shop" element={<ShopPage />} />
        <Route path="more" element={<MorePage />} />
        <Route path="more/notifications" element={<NotificationsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
