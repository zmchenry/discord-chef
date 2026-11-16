import { Outlet } from "react-router-dom";

import { TabBar } from "./TabBar";

// Content scrolls under a fixed bottom tab bar. The bottom padding is the
// bar's height plus the safe-area inset, so the last item is never hidden.
export function AppShell() {
  return (
    <div className="pt-safe min-h-dvh">
      <main className="mx-auto w-full max-w-xl pb-[calc(5rem+env(safe-area-inset-bottom,0px))]">
        <Outlet />
      </main>
      <TabBar />
    </div>
  );
}
