import { ArrowRight } from "lucide-react";
import { Fragment } from "react";

import { cx } from "../lib/cx";

// Planner reasons read "Kids Music 3:30–6:30 → 25 min or less". DM Sans draws
// "→" below the text's centre, so the arrow is an icon, centred with flex.
// Screen readers hear "to" in its place.
export function ReasonText({ text, className }: { text: string; className?: string }) {
  const parts = text.split("→").map((p) => p.trim());
  if (parts.length < 2) return <span className={className}>{text}</span>;
  return (
    <span className={cx("inline-flex min-w-0 flex-wrap items-center gap-x-1", className)}>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <>
              <ArrowRight aria-hidden="true" className="size-[1em] shrink-0" strokeWidth={2.25} />
              <span className="sr-only"> to </span>
            </>
          )}
          <span>{part}</span>
        </Fragment>
      ))}
    </span>
  );
}
