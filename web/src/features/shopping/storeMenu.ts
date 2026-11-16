import { ShoppingCart, Store as StoreIcon } from "lucide-react";

import type { Store } from "../../../../shared/schema";
import type { MenuItem } from "../../components/OverflowMenu";

/** "Buy at any store" plus one checkable "Always buy at X" per store. */
export function storeMenuItems(stores: Store[], current: number | null, onPick: (storeId: number | null) => void): MenuItem[] {
  return [
    {
      label: "Buy at any store",
      hint: "Goes with the trip's store",
      icon: ShoppingCart,
      checked: current === null,
      onSelect: () => current !== null && onPick(null),
    },
    ...stores.map((s) => ({
      label: `Always buy at ${s.name}`,
      icon: StoreIcon,
      checked: current === s.id,
      onSelect: () => current !== s.id && onPick(s.id),
    })),
  ];
}
