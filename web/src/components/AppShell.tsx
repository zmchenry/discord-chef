import { Outlet, useLocation } from "react-router-dom";

import { cx } from "../lib/cx";
import { TabBar } from "./TabBar";

// Boards that use the full desktop width; every other page is a readable
// column (forms, settings, a recipe, the shopping list).
const WIDE = /^\/(week|recipes)\/?$/;

// Phone and tablet: content scrolls under a fixed bottom tab bar, padded by
// the bar's height plus the safe-area inset so the last item is never hidden.
// Desktop (lg): a sticky top bar and a centred column.
export function AppShell() {
  const { pathname } = useLocation();
  return (
    <div className="pt-safe min-h-dvh">
      <TabBar />
      <main
        className={cx(
          "mx-auto w-full max-w-xl pb-[calc(5rem+env(safe-area-inset-bottom,0px))] lg:px-4 lg:pb-12",
          WIDE.test(pathname) ? "lg:max-w-[1200px]" : "lg:max-w-[720px]",
        )}
      >
        <Outlet />
      </main>
    </div>
  );
}
