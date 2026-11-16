import { forwardRef, useId, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { Link, type LinkProps } from "react-router-dom";

import { cx } from "../lib/cx";

// Small presentational primitives. Every colour, font, radius and shadow here
// is a token utility (see styles/tokens.css); nothing takes a raw value.


type Variant = "primary" | "secondary" | "ghost" | "danger";

const variantClass: Record<Variant, string> = {
  primary: "bg-primary text-on-primary",
  secondary: "bg-transparent text-primary shadow-[inset_0_0_0_1.5px_currentColor]",
  ghost: "bg-transparent text-text",
  danger: "bg-transparent text-danger shadow-[inset_0_0_0_1.5px_currentColor]",
};

// Pill buttons, never under the 44px touch minimum.
const buttonBase =
  "pressable inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full px-4 font-semibold disabled:opacity-60";

export const Button = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<"button"> & { variant?: Variant }>(
  function Button({ variant = "primary", className, type = "button", ...props }, ref) {
    return <button ref={ref} type={type} className={cx(buttonBase, variantClass[variant], className)} {...props} />;
  },
);

export function LinkButton({ variant = "primary", className, ...props }: LinkProps & { variant?: Variant }) {
  return <Link className={cx(buttonBase, variantClass[variant], className)} {...props} />;
}

export function Card({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div className={cx("rounded-card bg-surface shadow-card", className)} {...props} />;
}

export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-sm font-semibold", className)}>
      {children}
    </span>
  );
}

export function PageHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <header className="flex items-center justify-between gap-3 px-4 pb-2 pt-4">
      <h1 className="m-0 min-w-0 truncate text-3xl">{title}</h1>
      {action}
    </header>
  );
}

const fieldClass =
  "block w-full min-h-11 rounded-sm border border-border bg-surface px-3 py-2 text-base text-text placeholder:text-muted";

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
}

// A labelled input. The <label> is always associated (htmlFor/id), and hint
// and error text are wired up with aria-describedby.
export function TextField({
  label,
  hint,
  error,
  className,
  ...props
}: FieldProps & ComponentPropsWithoutRef<"input">) {
  const id = useId();
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cx("grid gap-1", className)}>
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <input id={id} className={fieldClass} aria-invalid={!!error || undefined} aria-describedby={describedBy} {...props} />
      {hint && (
        <p id={`${id}-hint`} className="m-0 text-sm text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="m-0 text-sm font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextAreaField({
  label,
  hint,
  error,
  className,
  ...props
}: FieldProps & ComponentPropsWithoutRef<"textarea">) {
  const id = useId();
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cx("grid gap-1", className)}>
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <textarea
        id={id}
        className={cx(fieldClass, "min-h-32 leading-relaxed")}
        aria-invalid={!!error || undefined}
        aria-describedby={describedBy}
        {...props}
      />
      {hint && (
        <p id={`${id}-hint`} className="m-0 text-sm text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="m-0 text-sm font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

// Loading, empty and error states share one quiet layout.
export function StateMessage({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="grid justify-items-center gap-2 px-6 py-12 text-center" role="status">
      <p className="m-0 font-display text-xl font-semibold">{title}</p>
      {children && <div className="text-muted">{children}</div>}
    </div>
  );
}
