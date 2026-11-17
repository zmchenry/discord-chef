import {
  PHOTO_UPLOAD_HEADER,
  photoReminderResponseSchema,
  photoUploadResponseSchema,
} from "../../../../shared/dishPhotos";
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

export const dishPhotoApi = {
  upload: async (recipeId: string, image: Blob) => {
    const form = new FormData();
    form.set("image", image, "dish.jpg");
    const res = await fetch(`/api/recipes/${encodeURIComponent(recipeId)}/photo`, {
      method: "POST",
      headers: { [PHOTO_UPLOAD_HEADER]: "1" },
      body: form,
    });
    return photoUploadResponseSchema.parse(await check(res));
  },
  remind: async (recipeId: string) => {
    const res = await fetch(`/api/recipes/${encodeURIComponent(recipeId)}/photo-reminder`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    return photoReminderResponseSchema.parse(await check(res));
  },
};
