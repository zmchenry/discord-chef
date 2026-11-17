import { countBacklog, estimateFlavors, nextRecipesToOrganize, organizeById } from './organize'

// Hourly from the cron: organizes a few more recipes (step titles, groups,
// refs) and estimates flavors for unflavored ingredients until nothing is left.
// Same work as POST /recipes/organize-all, without anyone having to call it.
export async function runOrganizeBackfill(env: Env, scheduledTime: number): Promise<void> {
  const key = env.ANTHROPIC_API_KEY
  if (!key || new Date(scheduledTime).getUTCMinutes() >= 15) return
  const backlog = await countBacklog(env.DB)
  if (backlog.recipes) {
    const ids = await nextRecipesToOrganize(env.DB)
    await Promise.all(ids.map((id) => organizeById(env.DB, key, id)))
  }
  if (backlog.ingredients) await estimateFlavors(env.DB, key).catch(() => 0)
}
