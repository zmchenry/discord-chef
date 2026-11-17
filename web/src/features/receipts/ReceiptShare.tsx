import type { ShoppingListView } from "../../../../shared/shopping";
import { MIN_PRICED_SHARE } from "../../../../shared/shopping/store";
import { receiptShare } from "./share";

// Under the store picker: "$43 at Publix · 60% from receipts", once the
// trip's store has any receipt prices.
export function ReceiptTotalsLine({ list, storeName }: { list: ShoppingListView; storeName: string | undefined }) {
  const t = list.totals.find((x) => x.storeId === list.storeId);
  if (!t || !t.fromReceipt || t.total === 0 || t.priced / t.total < MIN_PRICED_SHARE) return null;
  return (
    <p className="m-0 px-1 text-sm font-semibold tabular-nums text-muted">
      ${Math.round(t.cents / 100)}
      {storeName ? ` at ${storeName}` : ""} · {Math.round(receiptShare(t) * 100)}% from receipts
    </p>
  );
}
