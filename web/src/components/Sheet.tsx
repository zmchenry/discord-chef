import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cx } from "../lib/cx";

// Open sheets, innermost last: Escape closes only the top one.
const open: object[] = [];

// A modal panel: a bottom sheet on phones and tablets, a centred dialog on
// desktop (lg). Focus moves into it, Tab stays inside it, and focus goes back
// to where it came from on close; Escape and a tap on the scrim close it; the
// page behind does not scroll.
export function Sheet({
  labelledBy,
  describedBy,
  label,
  onClose,
  children,
  className,
}: {
  labelledBy?: string;
  describedBy?: string;
  label?: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  // Whatever had focus when the sheet opened gets it back on close.
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));

  useEffect(() => {
    const token = {};
    open.push(token);
    // A child (a menu) may already have focused something inside.
    if (!panel.current?.contains(document.activeElement)) panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (open[open.length - 1] !== token) return;
      if (e.key === "Escape") close.current();
      if (e.key === "Tab" && panel.current) trapTab(e, panel.current);
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      open.splice(open.indexOf(token), 1);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      opener?.focus();
    };
  }, [opener]);

  return createPortal(
    <div className="fixed inset-0 z-30 lg:grid lg:place-items-center lg:p-6">
      <div className="absolute inset-0 bg-text/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-label={label}
        tabIndex={-1}
        className={cx(
          "absolute inset-x-0 bottom-0 mx-auto flex max-h-[88dvh] max-w-xl flex-col rounded-t-card bg-bg shadow-card outline-none",
          "lg:relative lg:inset-auto lg:max-h-[85dvh] lg:w-full lg:max-w-[560px] lg:rounded-card",
          className,
        )}
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border lg:hidden" aria-hidden="true" />
        {children}
      </div>
    </div>,
    document.body,
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Keeps Tab and Shift+Tab cycling through the panel's controls.
function trapTab(e: KeyboardEvent, panel: HTMLElement) {
  const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
  const active = document.activeElement;
  if (items.length === 0) {
    e.preventDefault();
    panel.focus();
    return;
  }
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const outside = !panel.contains(active) || active === panel;
  if (e.shiftKey && (active === first || outside)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || outside)) {
    e.preventDefault();
    first.focus();
  }
}
