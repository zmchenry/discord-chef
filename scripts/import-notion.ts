// One-time import of the cleaned Notion data into D1.
//
//   node --experimental-transform-types scripts/import-notion.ts \
//     --export <dir> --proposal <file> \
//     --decisions <dir> --out <file.sql>
//
// Node 22.7+ runs this TypeScript file directly, so there is no build step
// and no extra runtime dependency. Imports therefore carry their .ts
// extension. The flag is needed because shared/normalize.ts uses a parameter
// property, which plain type stripping rejects.
//
// Inputs are the raw Notion export, the audit proposal and the user's
// decisions on each audit item (authoritative). Output is one SQL file of
// INSERTs, plus a dry-run summary printed to stdout and written next to it.
// Every decision must be applied (or explicitly superseded by another
// decision). Anything else fails the run before any SQL is written.
//
// The export holds personal data. Never point --out inside the repo.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import {
  cleanText,
  normalizeIngredientName,
  normalizeRecipeTitle,
  normalizeSectionName,
  normalizeStoreName,
  normalizeTag,
  normalizeUnit,
  parseIngredientLine,
} from '../shared/normalize.ts'

// ---------------------------------------------------------------------------
// Input shapes (only the fields this script reads)

interface MealRow {
  name: string
  tags: string[]
  ingredient_ids: string[]
  link: string | null
  icon: string | null
  cover_url: string | null
  page_id: string
  created_time: string
  last_edited?: string
}

interface ShoppingRow {
  name: string
  page_id: string
}

interface StandalonePage {
  page_id: string
  title: string
  properties_rich?: { title?: string }
  last_edited?: string
}

interface BodyLine {
  raw: string
  qty: number | null
  unit: string | null
  ingredient: string
  note: string | null
}

interface ProposalItem {
  id: string
  kind: string
  title: string
  summary?: string
  rows?: { name: string; raw: string; section: string; perishable: boolean }[]
  ingredients?: BodyLine[]
  steps?: string[]
  payload_static?: Record<string, unknown>
}

interface Proposal {
  groups: { id: string; items: ProposalItem[] }[]
}

interface Decision {
  item: string
  group: string
  kind: string
  action: string
  payload: Record<string, unknown>
  note?: string
}

export interface ImportInput {
  meals: MealRow[]
  shopping: ShoppingRow[]
  standalone: StandalonePage[]
  proposal: Proposal
  decisions: Decision[]
  now: number
}

export interface ImportResult {
  sql: string
  summary: string
  errors: string[]
}

// ---------------------------------------------------------------------------
// Loading

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf-8')) as T
}

export function loadInput(exportDir: string, proposalFile: string, decisionsDir: string, now = Date.now()): ImportInput {
  const rows = <T>(file: string): T[] => {
    const data = readJson<{ rows: T[] } | T[]>(path.join(exportDir, file))
    return Array.isArray(data) ? data : data.rows
  }
  let standalone: StandalonePage[] = []
  try {
    standalone = readJson<StandalonePage[]>(path.join(exportDir, 'standalone_pages.json'))
  } catch {
    // Optional: only needed when a merge pulls in a page outside Meals.
  }
  const decisions = readdirSync(decisionsDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const raw = readJson<Decision | { data: Decision }>(path.join(decisionsDir, f))
      return 'data' in raw ? raw.data : raw
    })
  return {
    meals: rows<MealRow>('meals.json'),
    shopping: rows<ShoppingRow>('shopping_list.json'),
    standalone,
    proposal: readJson<Proposal>(proposalFile),
    decisions,
    now,
  }
}

// ---------------------------------------------------------------------------
// The import

interface Ingredient {
  name: string
  section: string | null
  perishable: boolean
  isStaple: boolean
  fromBody: boolean
}

interface Amount {
  qty: number | null
  unit: string | null
  note: string | null
}

interface RecipeLine {
  rawText: string
  name: string
  quantity: number | null
  unit: string | null
  note: string | null
}

interface Draft {
  pageId: string
  sourceTitles: string[]
  title: string
  tags: string[]
  ingredientIds: string[]
  links: string[]
  icon: string | null
  imageUrl: string | null
  createdAt: number
  updatedAt: number
  notes: string[]
  bodyDropped: boolean
  bodyLines: BodyLine[] | null
  steps: string[]
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const splitList = (v: unknown): string[] =>
  str(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
const parseTime = (s: string | undefined, fallback: number) => {
  const t = s ? Date.parse(s.replace(' ', 'T')) : NaN
  return Number.isFinite(t) ? t : fallback
}
// Notion page ids are 32 hex digits: written as a UUID they make a stable
// recipe id across re-runs.
const pageUuid = (id: string) => id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5')
const round3 = (n: number | null) => (n === null || !(n > 0) ? null : Math.round(n * 1000) / 1000)

export function buildImport(input: ImportInput): ImportResult {
  const errors: string[] = []
  const applied = new Set<string>()
  const superseded = new Map<string, string>()
  const fail = (id: string, msg: string) => errors.push(`${id}: ${msg}`)

  const proposalItems = new Map<string, ProposalItem>()
  for (const g of input.proposal.groups) for (const it of g.items) proposalItems.set(it.id, it)
  const decisions = new Map<string, Decision>()
  for (const d of input.decisions) {
    if (decisions.has(d.item)) fail(d.item, 'duplicate decision')
    if (!proposalItems.has(d.item)) fail(d.item, 'decision for an item that is not in the proposal')
    decisions.set(d.item, d)
  }
  const byKind = (kind: string) => [...decisions.values()].filter((d) => d.kind === kind)
  const unsupported = (d: Decision) => fail(d.item, `unsupported action "${d.action}" for kind "${d.kind}"`)

  const shoppingById = new Map(input.shopping.map((r) => [r.page_id, r]))

  // --- Ingredients (groups C and D) ----------------------------------------

  const catalog = new Map<string, Ingredient>()
  const rowToName = new Map<string, string>()
  const rowAmount = new Map<string, Amount>()
  const droppedRows = new Set<string>()
  const droppedStaples: string[] = []

  const addIngredient = (id: string, ing: Ingredient) => {
    if (!ing.name) return fail(id, 'ingredient name normalises to empty')
    const existing = catalog.get(ing.name)
    if (!existing) return void catalog.set(ing.name, ing)
    if (existing.section && ing.section && existing.section !== ing.section) {
      fail(id, `"${ing.name}" is already in section ${existing.section}, not ${ing.section}`)
    }
    existing.section ??= ing.section
    existing.perishable ||= ing.perishable
    existing.isStaple ||= ing.isStaple
    existing.fromBody &&= ing.fromBody
  }
  const mapRow = (id: string, pageId: string, name: string) => {
    if (!shoppingById.has(pageId)) return fail(id, `shopping row ${pageId} is not in the export`)
    const prev = rowToName.get(pageId)
    if (prev && prev !== name) return fail(id, `shopping row ${pageId} already maps to "${prev}"`)
    rowToName.set(pageId, name)
  }
  const section = (id: string, s: unknown): string | null => {
    if (!str(s)) return null
    try {
      return normalizeSectionName(str(s))
    } catch (e) {
      fail(id, (e as Error).message)
      return null
    }
  }

  for (const d of byKind('ingredient')) {
    if (d.action !== 'accept') {
      unsupported(d)
      continue
    }
    const name = normalizeIngredientName(str(d.payload.name))
    addIngredient(d.item, {
      name,
      section: section(d.item, d.payload.section),
      perishable: d.payload.perishable === true,
      isStaple: false,
      fromBody: false,
    })
    for (const pid of strList(d.payload.page_ids)) mapRow(d.item, pid, name)
    for (const a of (d.payload.amounts as (Amount & { page_id: string })[] | undefined) ?? []) {
      rowAmount.set(a.page_id, { qty: a.qty, unit: a.unit, note: a.note })
    }
    applied.add(d.item)
  }

  // The one-to-one table maps by the Notion name, as its rows carry no page id.
  const unmappedByName = () => {
    const m = new Map<string, string[]>()
    for (const r of input.shopping) {
      if (rowToName.has(r.page_id)) continue
      m.set(r.name, [...(m.get(r.name) ?? []), r.page_id])
    }
    return m
  }
  for (const d of byKind('ingredient_table')) {
    if (d.action !== 'accept') {
      unsupported(d)
      continue
    }
    const overrides = (d.payload.section_overrides ?? {}) as Record<string, string>
    const byName = unmappedByName()
    for (const row of proposalItems.get(d.item)?.rows ?? []) {
      const name = normalizeIngredientName(row.name)
      addIngredient(d.item, {
        name,
        section: section(d.item, overrides[row.name] ?? row.section),
        perishable: row.perishable,
        isStaple: false,
        fromBody: false,
      })
      const pids = byName.get(row.raw) ?? []
      if (pids.length !== 1) fail(d.item, `row "${row.name}" matches ${pids.length} shopping rows by name`)
      else mapRow(d.item, pids[0], name)
    }
    applied.add(d.item)
  }

  for (const d of byKind('staple')) {
    const pids = strList(d.payload.page_ids)
    if (d.action === 'drop') {
      pids.forEach((p) => droppedRows.add(p))
      droppedStaples.push(str(d.payload.name))
    } else if (d.action === 'staple') {
      const name = normalizeIngredientName(str(d.payload.name))
      addIngredient(d.item, {
        name,
        section: section(d.item, d.payload.section),
        perishable: d.payload.perishable === true,
        isStaple: true,
        fromBody: false,
      })
      for (const pid of pids) mapRow(d.item, pid, name)
    } else {
      unsupported(d)
      continue
    }
    applied.add(d.item)
  }

  // Dead relation targets, per recipe.
  const dangling = new Map<string, Set<string>>()
  let danglingRefs = 0
  for (const d of byKind('bulk').filter((d) => d.group === 'C')) {
    if (d.action !== 'drop' || !d.payload.by_recipe) {
      unsupported(d)
      continue
    }
    for (const [rid, ids] of Object.entries(d.payload.by_recipe as Record<string, string[]>)) {
      dangling.set(rid, new Set(ids))
      danglingRefs += ids.length
    }
    applied.add(d.item)
  }

  // --- Recipes (groups A, B and E) -----------------------------------------

  const drafts = new Map<string, Draft>()
  for (const m of input.meals) {
    drafts.set(m.page_id, {
      pageId: m.page_id,
      sourceTitles: [m.name],
      title: m.name,
      tags: [...m.tags],
      ingredientIds: m.ingredient_ids.filter((id) => !dangling.get(m.page_id)?.has(id)),
      links: m.link ? [m.link] : [],
      icon: m.icon || null,
      imageUrl: m.cover_url || null,
      createdAt: parseTime(m.created_time, input.now),
      updatedAt: parseTime(m.last_edited ?? m.created_time, input.now),
      notes: [],
      bodyDropped: false,
      bodyLines: null,
      steps: [],
    })
  }
  // Survivor of a merge, for decisions that name a merged-away page.
  const mergedInto = new Map<string, string>()
  const resolve = (pid: string) => mergedInto.get(pid) ?? pid
  const draftFor = (id: string, pid: unknown): Draft | undefined => {
    const d = drafts.get(resolve(str(pid)))
    if (!d) fail(id, `recipe ${str(pid)} is not in the export (or was already removed)`)
    return d
  }

  const markers: string[] = []
  const eatOutSpots: { name: string; meals: string[]; pageId: string }[] = []
  const droppedRecipes: string[] = []
  const merges: string[] = []

  // B: markers and restaurants leave the recipe list.
  for (const d of byKind('recipe_marker')) {
    const r = draftFor(d.item, d.payload.recipe)
    if (!r) continue
    if (d.action === 'marker') markers.push(`${r.title} -> built-in "${str(d.payload.marker_kind)}" slot`)
    else if (d.action === 'drop') droppedRecipes.push(r.title)
    else if (d.action === 'eat_out_spot') {
      eatOutSpots.push({
        name: normalizeStoreName(r.title),
        meals: splitList(d.payload.meals).map(normalizeTag).filter(Boolean),
        pageId: r.pageId,
      })
    } else if (d.action === 'takeout_recipe') {
      r.tags.push('takeout')
      applied.add(d.item)
      continue
    } else {
      unsupported(d)
      continue
    }
    drafts.delete(r.pageId)
    applied.add(d.item)
  }

  // A: merges. A payload names a survivor, or lists recipes and a title (the
  // survivor is the one already carrying that title, else the first).
  for (const d of byKind('recipe_merge')) {
    if (d.action === 'keep_both') {
      applied.add(d.item)
      continue
    }
    if (d.action !== 'merge') {
      unsupported(d)
      continue
    }
    const title = str(d.payload.title)
    let survivorId = str(d.payload.survivor)
    let others = strList(d.payload.merge)
    if (!survivorId) {
      const ids = strList(d.payload.recipes)
      survivorId =
        ids.find((id) => normalizeRecipeTitle(drafts.get(id)?.title ?? '') === normalizeRecipeTitle(title)) ?? ids[0]
      others = ids.filter((id) => id !== survivorId)
    }
    const survivor = draftFor(d.item, survivorId)
    if (!survivor) continue
    const mergedTitles: string[] = []
    for (const oid of others) {
      const other = drafts.get(oid)
      const page = input.standalone.find((p) => p.page_id === oid)
      if (other) {
        survivor.tags.push(...other.tags)
        survivor.ingredientIds.push(...other.ingredientIds)
        survivor.links.push(...other.links)
        survivor.sourceTitles.push(...other.sourceTitles)
        survivor.icon ??= other.icon
        survivor.imageUrl ??= other.imageUrl
        survivor.createdAt = Math.min(survivor.createdAt, other.createdAt)
        survivor.updatedAt = Math.max(survivor.updatedAt, other.updatedAt)
        mergedTitles.push(other.title)
        drafts.delete(oid)
      } else if (page) {
        // A page outside Meals (no tags or ingredient relations).
        const t = page.properties_rich?.title ?? page.title
        survivor.sourceTitles.push(t)
        mergedTitles.push(t)
      } else {
        fail(d.item, `merged recipe ${oid} is not in the export`)
        continue
      }
      mergedInto.set(oid, survivor.pageId)
    }
    if (d.payload.add_alias) survivor.notes.push(`Also called ${cleanText(str(d.payload.add_alias))}.`)
    if (title) survivor.title = title
    merges.push(`${normalizeRecipeTitle(survivor.title)} <- ${mergedTitles.map(normalizeRecipeTitle).join(', ')}`)
    applied.add(d.item)
  }

  // B: titles, tags, bodies.
  let tagRemove = new Set<string>()
  let tagRename = new Map<string, string>()
  const tagKey = (t: string) => cleanText(t).toLowerCase()
  for (const d of byKind('bulk').filter((d) => d.group === 'B')) {
    if (d.action === 'keep') {
      applied.add(d.item)
    } else if (d.action !== 'accept') {
      unsupported(d)
    } else if (d.payload.rename || d.payload.remove) {
      tagRemove = new Set(strList(d.payload.remove).map(tagKey))
      tagRename = new Map(Object.entries((d.payload.rename ?? {}) as Record<string, string>).map(([k, v]) => [tagKey(k), v]))
      applied.add(d.item)
    } else if (d.payload.recipes) {
      // Cleaned titles: normalizeRecipeTitle strips the HTML for every title.
      for (const pid of strList(d.payload.recipes)) draftFor(d.item, pid)
      applied.add(d.item)
    } else {
      unsupported(d)
    }
  }
  for (const d of byKind('recipe_rename')) {
    const r = draftFor(d.item, d.payload.recipe)
    if (!r) continue
    if (d.action === 'rename') r.title = str(d.payload.title)
    else if (d.action !== 'keep') {
      unsupported(d)
      continue
    }
    applied.add(d.item)
  }
  for (const d of byKind('recipe_tags')) {
    const r = draftFor(d.item, d.payload.recipe)
    if (!r) continue
    if (d.action === 'set_tags') r.tags = splitList(d.payload.tags)
    else if (d.action !== 'keep') {
      unsupported(d)
      continue
    }
    applied.add(d.item)
  }
  for (const d of byKind('recipe_fix')) {
    const r = draftFor(d.item, d.payload.recipe)
    if (!r) continue
    if (d.action === 'drop_body') r.bodyDropped = true
    else if (d.action !== 'keep') {
      // "split" would need the body as its own recipe: not supported.
      unsupported(d)
      continue
    }
    applied.add(d.item)
  }

  // E: links.
  for (const d of byKind('link')) {
    const r = draftFor(d.item, d.payload.recipe)
    if (!r) continue
    const links = strList(d.payload.links)
    if (d.action === 'reimport' || d.action === 'no_reimport') {
      r.links = [...new Set([...links, ...r.links])]
      if (d.action === 'reimport') r.notes.unshift('Re-import from link to fill in steps.')
    } else {
      unsupported(d)
      continue
    }
    applied.add(d.item)
  }

  // E: parsed bodies. Proposal items name their recipe by title. A title like
  // "X (from Y)" is Y's body split into its own recipe, which only applies
  // when Y's body was kept.
  const byTitle = new Map<string, Set<string>>()
  for (const r of drafts.values()) {
    for (const t of r.sourceTitles) {
      const k = normalizeRecipeTitle(t)
      byTitle.set(k, (byTitle.get(k) ?? new Set()).add(r.pageId))
    }
  }
  const allSourceTitle = new Map<string, string>()
  for (const m of input.meals) allSourceTitle.set(normalizeRecipeTitle(m.name), m.page_id)
  for (const d of byKind('structured')) {
    const item = proposalItems.get(d.item)!
    if (d.action === 'use_links' || d.action === 'skip_body') {
      applied.add(d.item)
      continue
    }
    if (d.action !== 'use_body') {
      unsupported(d)
      continue
    }
    const split = item.title.match(/^(.*)\(from (.*)\)\s*$/)
    if (split) {
      const src = drafts.get(resolve(allSourceTitle.get(normalizeRecipeTitle(split[2])) ?? ''))
      if (src?.bodyDropped) superseded.set(d.item, `body of "${normalizeRecipeTitle(src.title)}" was discarded in group B`)
      else fail(d.item, 'split bodies into a new recipe are not supported')
      continue
    }
    const ids = [...(byTitle.get(normalizeRecipeTitle(item.title)) ?? [])]
    if (ids.length !== 1) {
      fail(d.item, `title "${item.title}" matches ${ids.length} recipes`)
      continue
    }
    const r = drafts.get(ids[0])!
    if (r.bodyDropped) {
      fail(d.item, 'use_body conflicts with drop_body for the same recipe')
      continue
    }
    r.steps = (item.steps ?? []).map(cleanText).filter(Boolean)
    // A body with steps only keeps the Notion ingredient links.
    if (item.ingredients?.length) r.bodyLines = item.ingredients
    applied.add(d.item)
  }

  for (const d of decisions.values()) {
    if (!applied.has(d.item) && !superseded.has(d.item) && !errors.some((e) => e.startsWith(`${d.item}:`))) {
      fail(d.item, `decision (${d.kind}/${d.action}) was not applied`)
    }
  }

  // --- Build rows ------------------------------------------------------------

  const finalTags = (raw: string[]) => {
    const out = new Set<string>()
    for (const t of raw) {
      const k = tagKey(t)
      if (tagRemove.has(k)) continue
      const n = normalizeTag(tagRename.get(k) ?? t)
      if (n) out.add(n)
    }
    return [...out]
  }

  const recipes: { draft: Draft; title: string; tags: string[]; lines: RecipeLine[] }[] = []
  const titles = new Map<string, string>()
  for (const r of drafts.values()) {
    const title = normalizeRecipeTitle(r.title)
    if (!title) {
      fail(r.pageId, 'title normalises to empty')
      continue
    }
    const dupe = titles.get(title.toLowerCase())
    if (dupe) fail(r.pageId, `title "${title}" is also used by ${dupe} (titles must be unique)`)
    titles.set(title.toLowerCase(), r.pageId)

    const lines: RecipeLine[] = []
    if (r.bodyLines) {
      for (const b of r.bodyLines) {
        const parsed = parseIngredientLine(b.raw)
        const name = normalizeIngredientName(b.ingredient) || parsed.name
        if (!catalog.has(name)) {
          catalog.set(name, { name, section: null, perishable: false, isStaple: false, fromBody: true })
        }
        lines.push({
          rawText: cleanText(b.raw),
          name,
          quantity: round3(b.qty ?? parsed.quantity),
          unit: b.unit ? (normalizeUnit(b.unit) ?? cleanText(b.unit).toLowerCase()) : parsed.unit,
          note: b.note ? cleanText(b.note) : parsed.note,
        })
      }
    } else {
      const seen = new Set<string>()
      for (const pid of r.ingredientIds) {
        const name = rowToName.get(pid)
        if (!name) {
          fail(r.pageId, `ingredient relation ${pid} is covered by no decision${droppedRows.has(pid) ? ' (dropped in group D)' : ''}`)
          continue
        }
        if (seen.has(name)) continue
        seen.add(name)
        const a = rowAmount.get(pid)
        lines.push({
          rawText: cleanText(shoppingById.get(pid)!.name),
          name,
          quantity: round3(a?.qty ?? null),
          unit: a?.unit ? (normalizeUnit(a.unit) ?? cleanText(a.unit).toLowerCase()) : null,
          note: a?.note ? cleanText(a.note) : null,
        })
      }
    }
    recipes.push({ draft: r, title, tags: finalTags(r.tags), lines })
  }
  recipes.sort((a, b) => a.title.localeCompare(b.title))

  // --- SQL -----------------------------------------------------------------

  // One statement per line: no raw newlines inside values.
  const q = (v: string | number | null | boolean): string => {
    if (v === null) return 'NULL'
    if (typeof v === 'boolean') return v ? '1' : '0'
    if (typeof v === 'number') return String(v)
    return `'${v.replace(/[\r\n]+/g, ' ').replace(/'/g, "''")}'`
  }
  const sql: string[] = ['-- Generated by scripts/import-notion.ts. Apply to a database with migrations applied.']
  const ingredients = [...catalog.values()].sort((a, b) => a.name.localeCompare(b.name))
  for (const i of ingredients) {
    sql.push(
      `INSERT INTO ingredients (name, section, perishable, is_staple, created_at) VALUES (${q(i.name)}, ${q(i.section)}, ${q(i.perishable)}, ${q(i.isStaple)}, ${input.now});`,
    )
  }
  for (const s of eatOutSpots) {
    sql.push(
      `INSERT INTO eat_out_spots (name, meals, notion_page_id, created_at) VALUES (${q(s.name)}, ${q(JSON.stringify(s.meals))}, ${q(s.pageId)}, ${input.now});`,
    )
  }
  for (const { draft: r, title, tags, lines } of recipes) {
    const id = pageUuid(r.pageId)
    const extraLinks = r.links.slice(1)
    const notes = [...r.notes, ...(extraLinks.length ? [`More links: ${extraLinks.join(' ')}`] : [])].join(' ')
    sql.push(
      `INSERT INTO recipes (id, title, source_url, image_url, icon, instructions, notes, created_at, updated_at, notion_page_id) VALUES (${[
        q(id),
        q(title),
        q(r.links[0] ?? null),
        q(r.imageUrl),
        q(r.icon),
        q(JSON.stringify(r.steps)),
        q(notes || null),
        r.createdAt,
        r.updatedAt,
        q(r.pageId),
      ].join(', ')});`,
    )
    for (const t of tags) sql.push(`INSERT INTO recipe_tags (recipe_id, tag) VALUES (${q(id)}, ${q(t)});`)
    lines.forEach((l, pos) => {
      sql.push(
        `INSERT INTO recipe_ingredients (recipe_id, position, raw_text, ingredient_id, quantity, unit, note) VALUES (${q(id)}, ${pos}, ${q(l.rawText)}, (SELECT id FROM ingredients WHERE name = ${q(l.name)}), ${q(l.quantity)}, ${q(l.unit)}, ${q(l.note)});`,
      )
    })
  }

  // --- Summary -------------------------------------------------------------

  const tagRows = recipes.reduce((n, r) => n + r.tags.length, 0)
  const lineRows = recipes.reduce((n, r) => n + r.lines.length, 0)
  const unimportedRows = input.shopping.filter((r) => !rowToName.has(r.page_id)).length
  const list = (items: string[]) => (items.length ? items.map((s) => `  - ${s}`).join('\n') : '  (none)')
  const summary = [
    'Notion import: dry-run summary',
    '',
    'Rows per table:',
    `  recipes             ${recipes.length}`,
    `  recipe_tags         ${tagRows}`,
    `  recipe_ingredients  ${lineRows} (${recipes.filter((r) => r.draft.bodyLines).length} recipes from parsed bodies)`,
    `  ingredients         ${ingredients.length} (${ingredients.filter((i) => i.isStaple).length} staples, ${ingredients.filter((i) => i.fromBody).length} new from bodies, unclassified)`,
    `  eat_out_spots       ${eatOutSpots.length}`,
    '',
    `Decisions: ${decisions.size} read, ${applied.size} applied, ${superseded.size} superseded, ${errors.length} errors`,
    '',
    'Merged duplicates:',
    list(merges),
    '',
    'Dropped:',
    list([
      ...droppedRecipes.map((t) => `recipe: ${normalizeRecipeTitle(t)}`),
      ...markers.map((m) => `marker: ${m}`),
      ...droppedStaples.map((s) => `item: ${s}`),
      `${danglingRefs} links to deleted ingredients`,
      `${unimportedRows} shopping rows not imported`,
    ]),
    '',
    'Eat-out spots:',
    list(eatOutSpots.map((s) => `${s.name} (${s.meals.join(', ')})`)),
    '',
    'Recipes with no ingredients:',
    list(recipes.filter((r) => r.lines.length === 0).map((r) => r.title)),
    '',
    'Superseded decisions:',
    list([...superseded].map(([id, why]) => `${id}: ${why}`)),
    '',
    'Decisions that could not be applied:',
    list(errors),
    '',
  ].join('\n')

  return { sql: sql.join('\n') + '\n', summary, errors }
}

// ---------------------------------------------------------------------------
// CLI

function main(argv: string[]) {
  const args = new Map<string, string>()
  for (let i = 0; i < argv.length; i += 2) args.set(argv[i].replace(/^--/, ''), argv[i + 1])
  const need = ['export', 'proposal', 'decisions', 'out'].filter((k) => !args.get(k))
  if (need.length) {
    console.error(`usage: node --experimental-transform-types scripts/import-notion.ts --export <dir> --proposal <file> --decisions <dir> --out <file.sql>`)
    console.error(`missing: ${need.map((k) => `--${k}`).join(' ')}`)
    process.exit(2)
  }
  const input = loadInput(args.get('export')!, args.get('proposal')!, args.get('decisions')!)
  const result = buildImport(input)
  console.log(result.summary)
  if (result.errors.length) {
    console.error(`FAILED: ${result.errors.length} decision(s) could not be applied. No SQL written.`)
    process.exit(1)
  }
  const out = args.get('out')!
  mkdirSync(path.dirname(out), { recursive: true })
  writeFileSync(out, result.sql)
  writeFileSync(out.replace(/\.sql$/, '') + '.summary.txt', result.summary)
  console.log(`Wrote ${out}`)
}

if (process.argv[1]?.endsWith('import-notion.ts')) {
  main(process.argv.slice(2))
}
