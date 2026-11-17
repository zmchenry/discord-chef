import {
  RECEIPT_UPLOAD_HEADER,
  receiptSaveResponseSchema,
  receiptViewSchema,
  type ReceiptSaveInput,
} from "../../../../shared/receipts";
import { errorResponseSchema } from "../../../../shared/schema";
import { ApiError } from "../../lib/api";

async function check(res: Response): Promise<unknown> {
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const parsed = errorResponseSchema.safeParse(await res.json());
      if (parsed.success) message = parsed.data.error;
    } catch {
      // Not JSON. Keep the status text.
    }
    throw new ApiError(res.status, message);
  }
  return res.json();
}

export const receiptApi = {
  // The photo goes up once; the server reads it and drops it.
  upload: async (image: Blob, storeId: number) => {
    const form = new FormData();
    form.set("image", image, "receipt.jpg");
    form.set("storeId", String(storeId));
    const res = await fetch("/api/receipts", { method: "POST", headers: { [RECEIPT_UPLOAD_HEADER]: "1" }, body: form });
    return receiptViewSchema.parse(await check(res));
  },
  save: async (id: number, input: ReceiptSaveInput) => {
    const res = await fetch(`/api/receipts/${id}/save`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    return receiptSaveResponseSchema.parse(await check(res));
  },
};
