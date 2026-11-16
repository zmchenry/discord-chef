import { BookOpen, CalendarDays, ChefHat, Ellipsis, ShoppingBasket, type LucideIcon } from "lucide-react";
import { NavLink } from "react-router-dom";

import { cx } from "../lib/cx";

const TABS: ReadonlyArray<{ to: string; label: string; icon: LucideIcon }> = [
  { to: "/week", label: "Week", icon: CalendarDays },
  { to: "/recipes", label: "Recipes", icon: BookOpen },
  { to: "/shop", label: "Shop", icon: ShoppingBasket },
  { to: "/more", label: "More", icon: Ellipsis },
];

// Phone and tablet: fixed to the bottom, padded by the safe-area inset so it
// clears the gesture bar on Android and the home indicator on iOS. Each tab is
// a full quarter of the width and at least 56px tall.
// Desktop (lg): a sticky 64px top bar, the same four links as pills on the
// right. Sticky page bars offset themselves by lg:top-16.
export function TabBar() {
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-surface pb-safe lg:sticky lg:top-0 lg:bottom-auto lg:border-b lg:border-t-0 lg:pb-0"
    >
      <div className="mx-auto max-w-xl lg:flex lg:h-16 lg:max-w-[1200px] lg:items-center lg:justify-between lg:px-8">
        <span aria-hidden="true" className="hidden items-center gap-2 font-display text-2xl font-semibold lg:flex">
          <ChefHat size={24} className="text-primary" /> Chef
        </span>
        <ul className="m-0 grid list-none grid-cols-4 p-0 px-2 pt-1.5 pb-1.5 lg:flex lg:gap-1 lg:p-0">
          {TABS.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                className={({ isActive }) =>
                  cx(
                    "pressable grid min-h-14 justify-items-center gap-0.5 rounded-sm pt-1 text-xs font-bold no-underline",
                    "lg:flex lg:min-h-11 lg:items-center lg:gap-2 lg:rounded-full lg:px-4 lg:pt-0 lg:text-sm",
                    isActive ? "text-primary lg:bg-surface-2" : "text-muted lg:hover:text-text",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      aria-hidden="true"
                      className={cx(
                        "grid h-7 w-14 place-items-center rounded-full lg:h-auto lg:w-auto lg:bg-transparent",
                        isActive && "bg-surface-2",
                      )}
                    >
                      <Icon size={22} strokeWidth={1.9} className="lg:size-5" />
                    </span>
                    {label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
