import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cx } from "../lib/cx";

// A modal panel: a bottom sheet on phones and tablets, a centred dialog on
// desktop (lg). Focus moves into it and back to where it came from on close;
// Escape and a tap on the scrim close it; the page behind does not scroll.
export function Sheet({
  labelledBy,
  label,
  onClose,
  children,
  className,
}: {
  labelledBy?: string;
  label?: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close.current();
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      opener?.focus();
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-30 lg:grid lg:place-items-center lg:p-6">
      <div className="absolute inset-0 bg-text/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
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
