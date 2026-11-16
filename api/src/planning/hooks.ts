import { notifyListReady } from '../notifications/events'
import { buildListForWeek } from '../shopping/build'

// Called after a week is marked planned: build (or refresh) the week's shopping
// list, then tell both phones it's ready. notifyListReady never throws.
export async function onWeekPlanned(env: Env, weekId: string): Promise<void> {
  await buildListForWeek(env, weekId)
  await notifyListReady(env, weekId)
}
