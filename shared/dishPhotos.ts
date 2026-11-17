import { z } from 'zod'

// Dish photos (feature dish-photos): a photo of what was cooked becomes the
// recipe's picture. Stored in the private R2 bucket PHOTOS.
//
// POST /api/recipes/:id/photo: multipart/form-data with `image` (JPEG, PNG or
// WebP, at most PHOTO_MAX_BYTES) and the header PHOTO_UPLOAD_HEADER: '1' (the
// same CSRF guard as receipts). Stores recipes/<id>/<timestamp>.<ext> and sets
// the recipe's imageUrl to PHOTO_URL_PREFIX + that key. -> PhotoUploadResponse.
//
// GET /api/photos/<key>: the stored image, cached for a year (keys never change).
//
// POST /api/recipes/:id/photo-reminder with an empty JSON object: the cook
// reached the last step of a recipe with no picture. Queues one push for
// PHOTO_REMINDER_DELAY_MS later ("How did <title> turn out?"), opening
// /recipes/<id>?photo=1. Skipped if the recipe has a picture by then.
// -> PhotoReminderResponse (dueAt null when the recipe already has one).

export { RECEIPT_UPLOAD_HEADER as PHOTO_UPLOAD_HEADER } from './receipts'
export const PHOTO_MAX_BYTES = 5_000_000
export const PHOTO_URL_PREFIX = '/api/photos/'
export const PHOTO_REMINDER_DELAY_MS = 15 * 60_000

export const photoUploadResponseSchema = z.object({ imageUrl: z.string() })
export type PhotoUploadResponse = z.infer<typeof photoUploadResponseSchema>

export const photoReminderInputSchema = z.object({}).strict()
export const photoReminderResponseSchema = z.object({ dueAt: z.number().int().nullable() })
export type PhotoReminderResponse = z.infer<typeof photoReminderResponseSchema>
