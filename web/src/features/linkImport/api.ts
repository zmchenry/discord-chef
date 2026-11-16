import { importUrlResponseSchema, type ImportUrlResponse } from "../../../../shared/linkImport";
import { errorResponseSchema } from "../../../../shared/schema";
import { ApiError } from "../../lib/api";

// POST /api/import/url. Mirrors lib/api.ts's request() error handling.
export async function importFromUrl(url: string, signal?: AbortSignal): Promise<ImportUrlResponse> {
  const res = await fetch("/api/import/url", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
    signal,
  });
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
  return importUrlResponseSchema.parse(await res.json());
}
