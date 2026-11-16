import { Check, Loader2, type LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { cx } from "../lib/cx";
import { Sheet } from "./Sheet";
import { Button } from "./ui";

// One layout for every dialog: title, description, body, then the action row.
// It sits on Sheet, so it is a bottom sheet on phones and a centred dialog on
// desktop, with Sheet's focus handling, Escape and scrim close.

export interface ModalAction {
  label: string;
  /** A returned promise shows a busy state until it settles. */
  onClick: () => void | Promise<void>;
  disabled?: boolean;
  /** Force the busy state. */
  busy?: boolean;
  icon?: LucideIcon;
  /** Danger styling (primary or additional only). */
  destructive?: boolean;
}

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** The body; it scrolls when tall while the header and footer stay put. */
  children?: ReactNode;
  primary?: ModalAction;
  /** Usually Cancel or Back. */
  secondary?: ModalAction;
  /** Quiet buttons on the left of the footer. */
  additional?: ModalAction[];
  /** Default true. False ignores Escape and scrim taps. */
  dismissible?: boolean;
  /** Desktop max width: 400 / 560 / 720. */
  size?: "sm" | "md" | "lg";
}

export function Modal(props: ModalProps) {
  if (!props.open) return null;
  return <ModalFrame {...props} />;
}

// md is Sheet's own desktop width; the others override it.
const SIZE: Record<NonNullable<ModalProps["size"]>, string> = {
  sm: "lg:max-w-[400px]!",
  md: "",
  lg: "lg:max-w-[720px]!",
};

const noop = () => {};

function ModalFrame({
  onClose,
  title,
  description,
  children,
  primary,
  secondary,
  additional = [],
  dismissible = true,
  size = "md",
  header,
  stepKey,
}: ModalProps & { header?: ReactNode; stepKey?: string }) {
  const titleId = useId();
  const descId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [running, setRunning] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // A new step starts at the top of its body with focus on its title.
  const firstStep = useRef(stepKey);
  useEffect(() => {
    if (stepKey === firstStep.current) return;
    firstStep.current = undefined;
    body.current?.scrollTo?.({ top: 0 });
    titleRef.current?.focus();
  }, [stepKey]);

  const run = (key: string, action: ModalAction) => {
    let result: void | Promise<void>;
    try {
      result = action.onClick();
    } catch {
      return; // the caller shows its own error
    }
    if (!result || typeof result.then !== "function") return;
    setRunning(key);
    result
      .catch(noop)
      .finally(() => mounted.current && setRunning((k) => (k === key ? null : k)));
  };

  const anyBusy = running !== null || [primary, secondary, ...additional].some((a) => a?.busy);
  const button = (key: string, action: ModalAction, kind: "primary" | "secondary" | "additional", className?: string) => {
    const busy = action.busy || running === key;
    const Icon = busy ? Loader2 : action.icon;
    return (
      <Button
        key={key}
        variant={kind === "primary" ? "primary" : kind === "secondary" ? "secondary" : "ghost"}
        disabled={action.disabled || anyBusy}
        aria-busy={busy || undefined}
        onClick={() => run(key, action)}
        className={cx(
          kind === "primary" && action.destructive && "bg-danger! text-bg!",
          kind === "additional" && "px-3!",
          kind === "additional" && action.destructive && "text-danger!",
          className,
        )}
      >
        {Icon && <Icon size={18} aria-hidden="true" className={cx(busy && "animate-spin motion-reduce:animate-none")} />}
        <span className="min-w-0 truncate">{action.label}</span>
      </Button>
    );
  };

  const pair = [secondary && button("secondary", secondary, "secondary"), primary && button("primary", primary, "primary")];
  const hasFooter = !!(primary || secondary || additional.length);

  return (
    <Sheet
      labelledBy={titleId}
      describedBy={description ? descId : undefined}
      onClose={dismissible ? onClose : noop}
      className={SIZE[size]}
    >
      <div className="flex min-h-0 flex-1 flex-col pb-safe">
        <div className="shrink-0 px-5 pt-3 lg:pt-6">
          {header}
          <h2 id={titleId} ref={titleRef} tabIndex={-1} className="m-0 text-2xl outline-none">
            {title}
          </h2>
          {description && (
            <p id={descId} className="m-0 mt-1 text-muted">
              {description}
            </p>
          )}
        </div>

        <div ref={body} className={cx("min-h-0 flex-1 overflow-y-auto px-5", children ? "py-4" : "pb-2")}>
          {children}
        </div>

        {hasFooter && (
          <div
            data-testid="modal-footer"
            className={cx(
              "shrink-0 border-t border-border px-5 py-3",
              additional.length
                ? "flex flex-wrap items-center gap-2"
                : cx("grid gap-2", primary && secondary && "grid-cols-2"),
            )}
          >
            {additional.length > 0 ? (
              <>
                {additional.map((a, i) => button(`additional-${i}`, a, "additional"))}
                <div className="ml-auto flex gap-2">{pair}</div>
              </>
            ) : (
              pair
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}

export interface ModalStep {
  id: string;
  /** Short, for the step header (e.g. "Sun", "B & L", "Review"). */
  label: string;
  title: ReactNode;
  description?: ReactNode;
  render: (ctx: StepContext) => ReactNode;
  /** Overrides; the label defaults to "Next", or `finishLabel` on the last step. An onClick replaces the default advance. */
  primary?: Partial<ModalAction>;
  /** Default true; false disables primary. */
  canAdvance?: boolean;
  /** Runs before moving on; throw (or reject) to stay on the step. */
  onNext?: () => void | Promise<void>;
  additional?: ModalAction[];
}

export interface StepContext {
  index: number;
  count: number;
  next(): void;
  back(): void;
  goTo(index: number): void;
  isFirst: boolean;
  isLast: boolean;
}

export interface MultiStepModalProps {
  open: boolean;
  onClose: () => void;
  steps: ModalStep[];
  /** Default 0. */
  initialStep?: number;
  /** Primary on the last step, after its onNext. */
  onFinish: () => void | Promise<void>;
  /** Default "Done". */
  finishLabel?: string;
  dismissible?: boolean;
  /** Default "md". */
  size?: ModalProps["size"];
}

export function MultiStepModal({
  open,
  onClose,
  steps,
  initialStep = 0,
  onFinish,
  finishLabel = "Done",
  dismissible,
  size = "md",
}: MultiStepModalProps) {
  const [index, setIndex] = useState(initialStep);
  const [visited, setVisited] = useState(() => new Set([initialStep]));

  // Closing starts it over, so the next open begins at the first step.
  useEffect(() => {
    if (open) return;
    setIndex(initialStep);
    setVisited(new Set([initialStep]));
  }, [open, initialStep]);

  if (!open || steps.length === 0) return null;

  const count = steps.length;
  const at = Math.min(index, count - 1);
  const step = steps[at]!;
  const goTo = (i: number) => {
    if (i < 0 || i >= count) return;
    setIndex(i);
    setVisited((v) => (v.has(i) ? v : new Set(v).add(i)));
  };
  const ctx: StepContext = {
    index: at,
    count,
    next: () => goTo(at + 1),
    back: () => goTo(at - 1),
    goTo,
    isFirst: at === 0,
    isLast: at === count - 1,
  };

  const { onClick: override, ...primaryRest } = step.primary ?? {};
  const primary: ModalAction = {
    ...primaryRest,
    label: primaryRest.label ?? (ctx.isLast ? finishLabel : "Next"),
    disabled: step.canAdvance === false || primaryRest.disabled,
    onClick:
      override ??
      (async () => {
        await step.onNext?.();
        if (ctx.isLast) await onFinish();
        else ctx.next();
      }),
  };

  return (
    <ModalFrame
      open
      onClose={onClose}
      dismissible={dismissible}
      size={size}
      stepKey={step.id}
      header={<StepHeader steps={steps} index={at} visited={visited} onGo={goTo} />}
      title={step.title}
      description={step.description}
      primary={primary}
      secondary={ctx.isFirst ? { label: "Cancel", onClick: onClose } : { label: "Back", onClick: ctx.back }}
      additional={step.additional}
    >
      {step.render(ctx)}
    </ModalFrame>
  );
}

// Every step's label with the current one highlighted; visited steps can be
// tapped. With many steps, phones show dots plus the current label.
function StepHeader({
  steps,
  index,
  visited,
  onGo,
}: {
  steps: ModalStep[];
  index: number;
  visited: Set<number>;
  onGo: (i: number) => void;
}) {
  const count = steps.length;
  const compact = count > 5;
  return (
    <div className="mb-4">
      <p className="sr-only" aria-live="polite">
        Step {index + 1} of {count}: {steps[index]!.label}
      </p>
      <ol aria-label="Steps" className="m-0 mb-1 flex list-none gap-1 p-0">
        {steps.map((s, i) => {
          const current = i === index;
          const done = visited.has(i) && !current;
          const name = `Step ${i + 1}: ${s.label}`;
          const marker = (
            <span
              className={cx(
                "inline-flex min-w-0 max-w-full items-center justify-center gap-1 rounded-full text-xs font-bold",
                compact ? "px-1.5 py-1" : "px-2.5 py-1",
                current ? "bg-primary text-on-primary" : done ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted",
                compact && !current && "max-sm:size-2.5 max-sm:p-0",
                compact && !current && done && "max-sm:bg-accent",
                compact && !current && !done && "max-sm:bg-border",
              )}
            >
              {done && <Check size={12} aria-hidden="true" className={cx("shrink-0", compact && "hidden")} />}
              <span className={cx("truncate", compact && !current && "max-sm:sr-only")}>{s.label}</span>
            </span>
          );
          return (
            <li key={s.id} className={cx("flex min-w-0 justify-center", "flex-1", compact && current && "max-sm:flex-[2_1_0%]")}>
              {done ? (
                <button
                  type="button"
                  aria-label={name}
                  onClick={() => onGo(i)}
                  className="pressable flex min-h-11 w-full min-w-0 items-center justify-center rounded-full bg-transparent"
                >
                  {marker}
                </button>
              ) : (
                <span
                  aria-current={current ? "step" : undefined}
                  className="flex min-h-11 w-full min-w-0 items-center justify-center"
                  title={current ? undefined : `${s.label} (not reached yet)`}
                >
                  {marker}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <div className="h-1 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${((index + 1) / count) * 100}%` }}
        />
      </div>
    </div>
  );
}
