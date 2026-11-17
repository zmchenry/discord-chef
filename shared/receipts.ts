import { z } from 'zod'

// Receipt scanning (feature prices-receipts).
//
// POST /api/receipts: multipart/form-data with `image` (a JPEG, PNG or WebP
// photo of a Walmart, Publix or Aldi receipt, at most RECEIPT_MAX_BYTES) and
// `storeId`, plus the header RECEIPT_UPLOAD_HEADER (see routes.ts on CSRF).
// Claude reads the lines, each line is matched to a catalog ingredient where
// possible, and the receipt is stored for review (the photo is not kept).
// -> ReceiptView. 503 with no ANTHROPIC_API_KEY, 502 when the read fails.
//
// POST /api/receipts/:id/save: the checked matches -> ReceiptSaveResponse.
// Writes ingredient_prices with source 'receipt' for the receipt's store,
// replacing estimates and older receipt prices, never manual ones.

export const RECEIPT_MAX_BYTES = 4_000_000
export const RECEIPT_UPLOAD_HEADER = 'x-chef-upload'

// How a line got its ingredient: a fuzzy name match, Claude, or a person.
export const receiptMatchSchema = z.enum(['name', 'claude', 'user'])

export const receiptLineViewSchema = z.object({
  id: z.number().int(),
  text: z.string(),
  priceCents: z.number().int(),
  quantity: z.number(),
  unitPriceCents: z.number().int().nullable(),
  weight: z.string().nullable(),
  size: z.string().nullable(),
  ingredientId: z.number().int().nullable(),
  ingredientName: z.string().nullable(),
  match: receiptMatchSchema.nullable(),
  // What would be saved as the ingredient's price: per package when the
  // size is printed, per lb (or kg) for weighed items, otherwise per item.
  price: z.object({ cents: z.number().int(), unit: z.string() }),
})
export type ReceiptLineView = z.infer<typeof receiptLineViewSchema>

export const receiptViewSchema = z.object({
  id: z.number().int(),
  storeId: z.number().int(),
  // The store name printed on the receipt, when Claude could read one.
  printedStore: z.string().nullable(),
  purchasedOn: z.string().nullable(),
  status: z.enum(['review', 'saved']),
  lines: z.array(receiptLineViewSchema),
})
export type ReceiptView = z.infer<typeof receiptViewSchema>

export const receiptSaveInputSchema = z.object({
  // Each line's final ingredient (null: not a recipe item). Lines left out
  // keep their current match.
  lines: z.array(z.object({ id: z.number().int(), ingredientId: z.number().int().nullable() })).max(300),
})
export type ReceiptSaveInput = z.infer<typeof receiptSaveInputSchema>

export const receiptSaveResponseSchema = z.object({
  // Prices written (new or replacing an estimate or an older receipt price).
  saved: z.number().int().nonnegative(),
  // Matched ingredients that already had a manual price at the store.
  keptManual: z.number().int().nonnegative(),
})
export type ReceiptSaveResponse = z.infer<typeof receiptSaveResponseSchema>
