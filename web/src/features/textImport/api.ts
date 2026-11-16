import { importTextResponseSchema, type ImportTextResponse } from "../../../../shared/textImport";
import { errorResponseSchema } from "../../../../shared/schema";
import { ApiError } from "../../lib/api";

// POST /api/import/text. Same error handling as the link import's client.
export async function importFromText(text: string, recipeId?: string): Promise<ImportTextResponse> {
  const res = await fetch("/api/import/text", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(recipeId ? { text, recipeId } : { text }),
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
  return importTextResponseSchema.parse(await res.json());
}
