// STUB: a throwaway Modal/MultiStepModal to the shared contract, so
// guided-dinners can run before the real one lands. Dropped at merge.
import type { LucideIcon } from "lucide-react";
import { useId, useState, type JSX, type ReactNode } from "react";

import { cx } from "../lib/cx";
import { Sheet } from "./Sheet";
import { Button } from "./ui";

export interface ModalAction {
  label: string;
  onClick: () => void | Promise<void>;
  disabled?: boolean;
  busy?: boolean;
  icon?: LucideIcon;
  destructive?: boolean;
}

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  primary?: ModalAction;
  secondary?: ModalAction;
  additional?: ModalAction[];
  dismissible?: boolean;
  size?: "sm" | "md" | "lg";
}

function ActionButton({ a, variant }: { a: ModalAction; variant: "primary" | "secondary" | "ghost" }) {
  const [busy, setBusy] = useState(false);
  const Icon = a.icon;
  return (
    <Button
      variant={a.destructive ? "danger" : variant}
      disabled={a.disabled || a.busy || busy}
      onClick={async () => {
        const r = a.onClick();
        if (r instanceof Promise) {
          setBusy(true);
          try {
            await r;
          } finally {
            setBusy(false);
          }
        }
      }}
    >
      {Icon && <Icon size={18} aria-hidden="true" />}
      {a.label}
    </Button>
  );
}

export function Modal(props: ModalProps & { header?: ReactNode }): JSX.Element | null {
  const id = useId();
  if (!props.open) return null;
  const { additional, secondary, primary } = props;
  return (
    <Sheet labelledBy={id} onClose={props.dismissible === false ? () => {} : props.onClose}>
      {props.header}
      <div className="px-4 pt-3">
        <h2 id={id} tabIndex={-1} className="m-0 text-2xl outline-none">
          {props.title}
        </h2>
        {props.description && <div className="mt-1 text-sm text-muted">{props.description}</div>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">{props.children}</div>
      <div
        className={cx(
          "gap-2 border-t border-border px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-3",
          additional?.length ? "flex items-center" : "grid grid-cols-2",
        )}
      >
        {additional?.map((a) => <ActionButton key={a.label} a={a} variant="ghost" />)}
        {additional?.length ? <span className="flex-1" /> : null}
        {secondary && <ActionButton a={secondary} variant="secondary" />}
        {primary && <ActionButton a={primary} variant="primary" />}
      </div>
    </Sheet>
  );
}

export interface ModalStep {
  id: string;
  label: string;
  title: ReactNode;
  description?: ReactNode;
  render: (ctx: StepContext) => ReactNode;
  primary?: Partial<ModalAction>;
  canAdvance?: boolean;
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
  initialStep?: number;
  onFinish: () => void | Promise<void>;
  finishLabel?: string;
  dismissible?: boolean;
  size?: ModalProps["size"];
}

export function MultiStepModal(props: MultiStepModalProps): JSX.Element | null {
  const [index, setIndex] = useState(props.initialStep ?? 0);
  const [visited, setVisited] = useState(() => new Set([props.initialStep ?? 0]));
  if (!props.open) return null;
  const count = props.steps.length;
  const step = props.steps[index]!;
  const goTo = (i: number) => {
    setIndex(i);
    setVisited((v) => new Set(v).add(i));
  };
  const isLast = index === count - 1;
  const ctx: StepContext = {
    index,
    count,
    next: () => goTo(Math.min(index + 1, count - 1)),
    back: () => goTo(Math.max(index - 1, 0)),
    goTo,
    isFirst: index === 0,
    isLast,
  };
  const primary: ModalAction = {
    label: isLast ? (props.finishLabel ?? "Done") : "Next",
    disabled: step.canAdvance === false,
    ...step.primary,
    onClick: async () => {
      await step.onNext?.();
      if (isLast) await props.onFinish();
      else ctx.next();
    },
  };
  const header = (
    <div className="px-4 pt-2">
      <p className="sr-only" aria-live="polite">
        Step {index + 1} of {count}
      </p>
      <ol className="m-0 flex list-none gap-1 p-0">
        {props.steps.map((s, i) => (
          <li key={s.id} className="min-w-0 flex-1">
            <button
              type="button"
              disabled={!visited.has(i)}
              onClick={() => goTo(i)}
              aria-current={i === index ? "step" : undefined}
              className={cx(
                "min-h-11 w-full truncate rounded-full px-1 text-xs font-bold",
                i === index ? "bg-primary text-on-primary" : visited.has(i) ? "bg-surface-2 text-text" : "bg-transparent text-muted",
              )}
            >
              {s.label}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
  return (
    <Modal
      open
      onClose={props.onClose}
      header={header}
      title={step.title}
      description={step.description}
      primary={primary}
      secondary={ctx.isFirst ? { label: "Cancel", onClick: props.onClose } : { label: "Back", onClick: ctx.back }}
      additional={step.additional}
      dismissible={props.dismissible}
      size={props.size}
    >
      {step.render(ctx)}
    </Modal>
  );
}
