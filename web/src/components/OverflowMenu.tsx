import { Check, MoreHorizontal, type LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { cx } from "../lib/cx";
import { Sheet } from "./Sheet";

export interface MenuItem {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  /** One quiet line under the label. */
  hint?: string;
  destructive?: boolean;
  /** Makes it a checkable item (menuitemcheckbox). */
  checked?: boolean;
  disabled?: boolean;
}

const DESKTOP = "(min-width: 1024px)";

function useDesktop() {
  const [desktop, setDesktop] = useState(() => window.matchMedia?.(DESKTOP).matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.(DESKTOP);
    if (!mq) return;
    const on = () => setDesktop(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return desktop;
}

// A menu of secondary actions behind a button: a popover anchored to the
// button on desktop, a small bottom sheet on phones and tablets. Closes on an
// outside tap, Escape or a selection and gives focus back to the button;
// arrow keys, Home and End move between items.
export function ActionMenu({
  items,
  label,
  title,
  trigger,
  triggerClassName,
}: {
  items: MenuItem[];
  /** The button's accessible name, e.g. "More actions". */
  label: string;
  /** Heading of the phone sheet. Defaults to `label`. */
  title?: string;
  /** Button content; the ⋯ icon when omitted. */
  trigger?: ReactNode;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const desktop = useDesktop();
  const button = useRef<HTMLButtonElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const titleId = useId();

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  // Desktop popover: an outside tap closes it.
  useEffect(() => {
    if (!open || !desktop) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, desktop]);

  const list = (
    <MenuList
      id={menuId}
      items={items}
      labelledBy={desktop ? undefined : titleId}
      label={desktop ? label : undefined}
      sheet={!desktop}
      onDone={(item) => {
        // The phone sheet hands focus back itself when it unmounts.
        close(desktop);
        item?.onSelect();
      }}
    />
  );

  return (
    <div ref={wrap} className="relative inline-flex shrink-0">
      <button
        ref={button}
        type="button"
        aria-label={trigger ? undefined : label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        className={
          triggerClassName ??
          "pressable grid size-11 place-items-center rounded-full bg-transparent text-text hover:bg-surface-2"
        }
      >
        {trigger ?? <MoreHorizontal size={22} aria-hidden="true" />}
      </button>
      {open &&
        (desktop ? (
          <div className="absolute right-0 top-full z-30 mt-1 min-w-60 rounded-sm border border-border bg-surface p-1 shadow-card">
            {list}
          </div>
        ) : (
          <Sheet labelledBy={titleId} onClose={() => setOpen(false)}>
            <h2 id={titleId} className="m-0 px-4 pb-1 pt-3 text-lg">
              {title ?? label}
            </h2>
            <div className="overflow-y-auto px-2 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">{list}</div>
          </Sheet>
        ))}
    </div>
  );
}

/** The ⋯ "More actions" button. */
export function OverflowMenu({ items, title }: { items: MenuItem[]; title?: string }) {
  return <ActionMenu items={items} label="More actions" title={title} />;
}

function MenuList({
  id,
  items,
  label,
  labelledBy,
  sheet,
  onDone,
}: {
  id: string;
  items: MenuItem[];
  label?: string;
  labelledBy?: string;
  sheet: boolean;
  onDone: (item?: MenuItem) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const enabled = () => Array.from(ref.current?.querySelectorAll<HTMLElement>("[role^=menuitem]:not(:disabled)") ?? []);

  useEffect(() => {
    enabled()[0]?.focus();
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    const all = enabled();
    const at = all.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => {
      e.preventDefault();
      all[(i + all.length) % all.length]?.focus();
    };
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(all.length - 1);
    else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onDone();
    } else if (e.key === "Tab" && !sheet) onDone();
  };

  return (
    <div ref={ref} id={id} role="menu" aria-label={label} aria-labelledby={labelledBy} onKeyDown={onKeyDown} className="grid gap-0.5">
      {items.map((item) => {
        const Icon = item.icon;
        const checkable = item.checked !== undefined;
        return (
          <button
            key={item.label}
            type="button"
            role={checkable ? "menuitemcheckbox" : "menuitem"}
            aria-checked={checkable ? item.checked : undefined}
            disabled={item.disabled}
            tabIndex={-1}
            onClick={() => onDone(item)}
            className={cx(
              "pressable flex w-full items-center gap-3 rounded-sm bg-transparent px-3 text-left hover:bg-surface-2 focus-visible:bg-surface-2 disabled:opacity-50",
              sheet ? "min-h-14 py-2" : "min-h-11 py-1.5",
              item.destructive ? "text-danger" : "text-text",
            )}
          >
            <Icon size={20} aria-hidden="true" className={cx("shrink-0", !item.destructive && "text-muted")} />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{item.label}</span>
              {item.hint && <span className="block text-sm text-muted">{item.hint}</span>}
            </span>
            {checkable && (
              <span
                aria-hidden="true"
                className={cx(
                  "grid size-6 shrink-0 place-items-center rounded-full",
                  item.checked ? "bg-primary text-on-primary" : "shadow-[inset_0_0_0_1.5px_var(--color-muted)]",
                )}
              >
                {item.checked && <Check size={14} strokeWidth={3} />}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
