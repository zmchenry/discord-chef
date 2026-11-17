import { z } from 'zod'

// The wire contract for household members (api/src/household): who eats at
// home, how big a portion they take, and which meals they're usually home
// for. The adults are the household's people (GET /api/settings/household);
// kids are added here. The scaling math lives in shared/household/servings.ts.

export const HOME_MEALS = ['breakfast', 'lunch', 'dinner', 'snack'] as const
export const homeMealSchema = z.enum(HOME_MEALS)
export type HomeMeal = z.infer<typeof homeMealSchema>

export const memberKindSchema = z.enum(['adult', 'kid'])
export type MemberKind = z.infer<typeof memberKindSchema>

// Portion choices for a kid: Small ¼, Half ½, Full 1.
export const KID_PORTIONS = [0.25, 0.5, 1] as const
export const DEFAULT_PORTION: Record<MemberKind, number> = { adult: 1, kid: 0.5 }

export const memberSchema = z.object({
  name: z.string().trim().max(40),
  kind: memberKindSchema,
  // Servings this person eats, as a multiplier of one recipe serving.
  portion: z.number().min(0.25).max(3),
  meals: z.array(homeMealSchema).max(HOME_MEALS.length),
})
export type Member = z.infer<typeof memberSchema>

// GET/PUT /api/settings/household-members. Adults not in the household's
// people are dropped; a kid with no name becomes "Kid 1", "Kid 2", ...
export const householdMembersSchema = z.object({ members: z.array(memberSchema).max(12) })
export type HouseholdMembers = z.infer<typeof householdMembersSchema>
