import { fetchPage } from '../linkImport/fetchPage'
import { ogImage } from '../linkImport/routes'
import { countBacklog, estimateFlavors, nextRecipesToOrganize, organizeById } from './organize'

// Hourly from the cron: organizes a few more recipes (step titles, groups,
// refs) and estimates flavors for unflavored ingredients until nothing is left.
// Same work as POST /recipes/organize-all, without anyone having to call it.
export async function runOrganizeBackfill(env: Env, scheduledTime: number): Promise<void> {
  if (new Date(scheduledTime).getUTCMinutes() >= 15) return
  await fillImagesFromSources(env.DB)
  const key = env.ANTHROPIC_API_KEY
  if (!key) return
  const backlog = await countBacklog(env.DB)
  if (backlog.recipes) {
    const ids = await nextRecipesToOrganize(env.DB)
    await Promise.all(ids.map((id) => organizeById(env.DB, key, id)))
  }
  if (backlog.ingredients) await estimateFlavors(env.DB, key).catch(() => 0)
}

// Recipes with a source page but no picture take the page's own photo
// (og:image). A page without one gets an empty string, so it is tried once.
// YouTube links use the video thumbnail.
export async function fillImagesFromSources(db: D1Database, limit = 5): Promise<void> {
  const { results } = await db
    .prepare(`SELECT id, source_url AS src FROM recipes WHERE archived_at IS NULL AND image_url IS NULL AND source_url IS NOT NULL LIMIT ?1`)
    .bind(limit)
    .all<{ id: string; src: string }>()
  for (const r of results) {
    let image = ''
    const yt = r.src.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/)
    if (yt) image = `https://i.ytimg.com/vi/${yt[1]}/hqdefault.jpg`
    else {
      try {
        const found = ogImage((await fetchPage(r.src)).html)
        if (found?.startsWith('https://')) image = found
      } catch {
        // Unreachable page: leave the picture blank.
      }
    }
    await db.prepare('UPDATE recipes SET image_url = ?2 WHERE id = ?1 AND image_url IS NULL').bind(r.id, image).run()
  }
}
