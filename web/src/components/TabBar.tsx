import { BookOpen, CalendarDays, Ellipsis, ShoppingBasket, type LucideIcon } from "lucide-react";
import { NavLink } from "react-router-dom";

import { cx } from "../lib/cx";

const TABS: ReadonlyArray<{ to: string; label: string; icon: LucideIcon }> = [
  { to: "/week", label: "Week", icon: CalendarDays },
  { to: "/recipes", label: "Recipes", icon: BookOpen },
  { to: "/shop", label: "Shop", icon: ShoppingBasket },
  { to: "/more", label: "More", icon: Ellipsis },
];

// Fixed to the bottom, padded by the safe-area inset so it clears the
// gesture bar on Android and the home indicator on iOS. Each tab is a full
// quarter of the width and at least 56px tall.
export function TabBar() {
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-surface pb-safe">
      <ul className="m-0 mx-auto grid max-w-xl list-none grid-cols-4 p-0 px-2 pt-1.5 pb-1.5">
        {TABS.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <NavLink
              to={to}
              className={({ isActive }) =>
                cx(
                  "pressable grid min-h-14 justify-items-center gap-0.5 rounded-sm pt-1 text-xs font-bold no-underline",
                  isActive ? "text-primary" : "text-muted",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    aria-hidden="true"
                    className={cx("grid h-7 w-14 place-items-center rounded-full", isActive && "bg-surface-2")}
                  >
                    <Icon size={22} strokeWidth={1.9} />
                  </span>
                  {label}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
