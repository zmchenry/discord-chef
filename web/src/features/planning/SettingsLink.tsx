import { ChevronLeft, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";

// One row on the More page.
export function SettingsLink({ to, title, hint }: { to: string; title: string; hint: string }) {
  return (
    <Link
      to={to}
      className="pressable flex min-h-14 items-center gap-3 rounded-card bg-surface p-4 text-text no-underline shadow-card"
    >
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="block text-sm text-muted">{hint}</span>
      </span>
      <ChevronRight size={20} className="text-muted" aria-hidden="true" />
    </Link>
  );
}

export function BackToMore() {
  return (
    <Link
      to="/more"
      className="pressable ml-2 mt-3 inline-flex min-h-11 items-center gap-1 rounded-full pr-3 font-semibold text-text no-underline"
    >
      <ChevronLeft size={22} aria-hidden="true" /> More
    </Link>
  );
}
