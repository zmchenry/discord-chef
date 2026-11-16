import { useQuery } from "@tanstack/react-query";
import { Store as StoreIcon } from "lucide-react";

import { displayIngredientName } from "../../../../shared/normalize";
import { ActionMenu } from "../../components/OverflowMenu";
import { api } from "../../lib/api";
import { cx } from "../../lib/cx";
import { usePinIngredient, useStorePins } from "./queries";
import { storeMenuItems } from "./storeMenu";

// Store pins: "always buy turkey at Publix". The pin lives on the
// ingredient, so it shows wherever that ingredient does.

/** A small pill with the pinned store's name. */
export function StoreBadge({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-accent-soft px-2 py-0.5 text-xs font-bold leading-tight text-accent",
        className,
      )}
    >
      <StoreIcon size={12} aria-hidden="true" />
      {name}
    </span>
  );
}

// The pin on a recipe's ingredient line: the badge when pinned, and a ⋯
// menu to set it.
export function IngredientStorePin({ ingredientId, name, editable }: { ingredientId: number; name: string; editable: boolean }) {
  const stores = useQuery({ queryKey: ["stores"], queryFn: ({ signal }) => api.listStores(signal), staleTime: 5 * 60_000 });
  const pins = useStorePins();
  const pinIt = usePinIngredient();
  const current = pins.data?.find((p) => p.ingredientId === ingredientId)?.storeId ?? null;
  const store = current !== null ? stores.data?.find((s) => s.id === current) : undefined;
  return (
    <>
      {store && <StoreBadge name={store.name} />}
      {editable && stores.data && pins.data && (
        <ActionMenu
          items={storeMenuItems(stores.data, current, (storeId) => pinIt.mutate({ ingredientId, storeId }))}
          label={`Where to buy ${displayIngredientName(name)}`}
          title={displayIngredientName(name)}
          triggerClassName="pressable -my-2 -mr-2 grid size-11 shrink-0 place-items-center rounded-full bg-transparent text-muted hover:bg-surface-2"
        />
      )}
    </>
  );
}
