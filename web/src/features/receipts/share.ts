import type { ShoppingListView } from "../../../../shared/shopping";

type Total = ShoppingListView["totals"][number];

// Share of a store total's priced items that have a receipt price under 90
// days old.
export const receiptShare = (t: Total | undefined) => (t && t.priced > 0 ? (t.fromReceipt ?? 0) / t.priced : 0);

// The word after a store's total: "est." unless most of it is from receipts.
export const totalTag = (t: Total | undefined) => (receiptShare(t) >= 0.5 ? "" : " est.");
