import { Pencil, Plus, Trash2, UtensilsCrossed } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import type { FoodLogItem } from "../../../../shared/foodLog";
import { todayIn } from "../../../../shared/planningApi";
import { Modal } from "../../components/Modal";
import { ActionMenu } from "../../components/OverflowMenu";
import { Button } from "../../components/ui";
import { cx } from "../../lib/cx";
import { useDeleteFood, useUpdateFood } from "./api";
import { itemName, kcalText, macroText } from "./format";
import { ItemEditor, type EditableItem } from "./ItemEditor";
import { LogFoodSheet } from "./LogFoodSheet";

// One logged item: what, how much, whose, the numbers; ⋯ to edit or delete.
export function FoodRow({ item, showPerson = true }: { item: FoodLogItem; showPerson?: boolean }) {
  const [editing, setEditing] = useState(false);
  const remove = useDeleteFood();
  const name = item.recipeId && item.recipeTitle ? item.recipeTitle : itemName(item);
  return (
    <li className="flex min-h-11 items-center gap-2 py-1">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">
          {item.quantity ? <span className="text-muted">{item.quantity} </span> : null}
          {item.recipeId ? <Link to={`/recipes/${encodeURIComponent(item.recipeId)}`}>{name}</Link> : name}
        </span>
        <span className="block text-xs tabular-nums text-muted">
          {showPerson && `${item.person} · `}
          <span className={cx(item.kcal != null && "font-semibold text-text")}>{kcalText(item)}</span>
          {item.kcal != null && ` · ${macroText(item)}`}
        </span>
      </span>
      <ActionMenu
        label={`Actions for ${name}`}
        title={name}
        triggerClassName="size-11"
        items={[
          { label: "Edit", icon: Pencil, onSelect: () => setEditing(true) },
          { label: remove.isPending ? "Deleting…" : "Delete", icon: Trash2, destructive: true, onSelect: () => remove.mutate(item.id) },
        ]}
      />
      {editing && <EditFoodModal item={item} onClose={() => setEditing(false)} />}
    </li>
  );
}

function EditFoodModal({ item, onClose }: { item: FoodLogItem; onClose: () => void }) {
  const update = useUpdateFood();
  const remove = useDeleteFood();
  const { id: _id, person, date: _d, createdBy: _c, createdAt: _a, ...fields } = item;
  const [draft, setDraft] = useState<EditableItem>(fields);
  return (
    <Modal
      open
      onClose={onClose}
      title="Edit item"
      description={`${person}'s log`}
      primary={{
        label: "Save",
        disabled: !draft.label.trim(),
        onClick: () =>
          update
            .mutateAsync({ id: item.id, fields: (({ recipeTitle: _t, ...f }) => f)(draft) })
            .then(onClose)
            .catch(() => undefined),
      }}
      secondary={{ label: "Cancel", onClick: onClose }}
      additional={[{ label: "Delete", icon: Trash2, destructive: true, onClick: () => remove.mutateAsync(item.id).then(onClose).catch(() => undefined) }]}
    >
      <ItemEditor item={draft} onChange={setDraft} compact />
      {(update.isError || remove.isError) && (
        <p className="m-0 mt-2 text-sm font-semibold text-danger">{(update.error ?? remove.error)!.message}</p>
      )}
    </Modal>
  );
}

// The "Log food" button and its sheet.
export function LogFoodButton({
  date,
  variant = "primary",
  className,
  label = "Log food",
}: {
  date?: string;
  variant?: "primary" | "secondary";
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  if (date && date > todayIn()) return null;
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)} className={className}>
        <Plus size={18} aria-hidden="true" /> {label}
      </Button>
      {open && <LogFoodSheet date={date} onClose={() => setOpen(false)} />}
    </>
  );
}

// The Week page's floating entry point for today: above the sticky action
// bar on phones, bottom right on desktop.
export function LogFoodFab() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Log food for today"
        className={cx(
          "pressable fixed right-4 z-20 inline-flex min-h-12 items-center gap-2 rounded-full bg-surface px-4 font-semibold text-primary shadow-card",
          "bottom-[calc(9.5rem+env(safe-area-inset-bottom,0px))] lg:bottom-6 lg:right-6",
        )}
      >
        <UtensilsCrossed size={18} aria-hidden="true" /> Log food
      </button>
      {open && <LogFoodSheet onClose={() => setOpen(false)} />}
    </>
  );
}
