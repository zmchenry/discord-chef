import { notifyListReady } from '../notifications/events'
import { buildListForWeek } from '../shopping/build'

// Called after a week is marked planned: build (or refresh) the week's shopping
// list, then tell both phones it's ready. notifyListReady never throws.
// waitUntil (c.executionCtx.waitUntil) lets price estimates for the new list
// run after the response.
export async function onWeekPlanned(env: Env, weekId: string, waitUntil?: (p: Promise<unknown>) => void): Promise<void> {
  await buildListForWeek(env, weekId, { waitUntil })
  await notifyListReady(env, weekId)
}
