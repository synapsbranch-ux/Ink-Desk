// The Director's plan and the cover, as pure functions over the desk (v2,
// slice 11). Like `lib/script.ts` and `lib/cast.ts`, each mutation runs inside
// `update()` against the freshest desk, so the rules here are what the server
// enforces — and the lenient half (`applyPlanEdit`, `applyCoverEdit`) is what
// the browser runs as you type. See `devpost/spec.md > The Director (v2)` and
// `devpost/prd.md > The Director — Chapter Plan and Cover`.
//
// The plan and the cover are chapter-level: every page's desk view carries
// the same `plan` and `cover`, and `lib/chapter.ts > applyDesk` writes them
// back to the chapter and keeps its pages in step with the plan's length.
//
// Shared with the browser, so no Node imports.
import { Refused } from './errors'
import { PANEL_LAYOUT } from './prompts'
import { PAGE_COUNT_MAX, PAGE_COUNT_MIN, planPages, type ChapterPlanOutput, type PageScriptOutput, type PanelLine } from './schemas'
import { claimIsStale, lockedPair, MAX_PANEL_VERSIONS, newScript } from './script'
import { defaultCoverTitle } from './story'
import type { ChapterPlan, CoverState, Desk, PageSummary, PanelStatus, PlanPage, ProjectPage } from './types'

export type PlanLineEdit = Partial<Pick<PanelLine, 'action' | 'camera' | 'background' | 'dialogue'>>

/** One edit to the plan, from the Director's fields and the page-count stepper. */
export type PlanEdit = {
  pageCount?: number
  coverBrief?: string
  /** Keyed by page index, then panel index "0"–"3". */
  pages?: Record<string, Record<string, PlanLineEdit>>
}

export type CoverEdit = { title?: string; version?: number }

// --- Reading the plan ---------------------------------------------------------

export function clampPageCount(n: number): number {
  return Math.min(PAGE_COUNT_MAX, Math.max(PAGE_COUNT_MIN, Math.trunc(Number.isFinite(n) ? n : PAGE_COUNT_MIN)))
}

/** The derived page list — what the switcher and the header read. */
export function pageSummaries(pages: readonly ProjectPage[]): PageSummary[] {
  return pages.map((pg) => {
    const panels = pg.panels
    const inkedPanels = panels.filter((p) => p.versions.length > 0)
    const thumb = panels[0]?.versions.length ? panels[0] : inkedPanels[0]
    return {
      index: pg.index,
      written: panels.length === 4,
      inked: inkedPanels.length,
      inking: panels.filter((p) => p.status === 'inking').length,
      failed: panels.filter((p) => p.status === 'failed' || p.status === 'refused').length,
      blank: panels.filter((p) => p.status === 'empty' && p.versions.length === 0).length,
      thumbnailImageId: thumb ? (thumb.versions[thumb.currentVersion]?.imageId ?? null) : null,
      panelImageIds: panels.map((p) => p.versions[p.currentVersion]?.imageId ?? null),
    }
  })
}

/** Pages with all four panels inked. */
export function pagesComplete(d: Pick<Desk, 'pages'>): number {
  return d.pages.filter((p) => p.written && p.inked === 4).length
}

function isWritten(d: Pick<Desk, 'pages'>, index: number): boolean {
  return d.pages.find((p) => p.index === index)?.written === true
}

/** The two locked ids in layout order, from the plan's own first page. */
function planIds(plan: ChapterPlan): [string, string] {
  const first = plan.pages[0]?.panels
  return [first?.[0]?.characterId ?? '', first?.[1]?.characterId ?? '']
}

/** A page appended by the stepper: the slot's character, every line for the storyteller to write. */
export function blankPlanPage(ids: readonly [string, string]): PlanPage {
  return {
    panels: PANEL_LAYOUT.map((slot) => ({ characterId: ids[slot.cast], action: '', camera: '', background: '', dialogue: '' })),
  }
}

function cleanLine(line: PanelLine): PanelLine {
  return {
    characterId: line.characterId,
    action: line.action.trim(),
    camera: line.camera.trim(),
    background: line.background.trim(),
    dialogue: line.dialogue.trim(),
  }
}

// --- Writing the plan ---------------------------------------------------------

/**
 * Whether the Director may write (or, with `replace`, rewrite) this chapter's
 * plan — checked before the call so a refused request costs nothing, and
 * again inside the lock by `newPlan`. Returns the locked pair.
 */
export function assertPlanWritable(desk: Desk, replace: boolean): ReturnType<typeof lockedPair> {
  const pair = lockedPair(desk)
  if (desk.pages.some((p) => p.written)) {
    throw new Refused(
      desk.plan
        ? 'Pages are already being inked from this plan, so the Director can’t rewrite it. Edit the pages that aren’t written yet.'
        : 'This project’s page was scripted before the Director existed. Plan a chapter in a new project — this one stays as it is.'
    )
  }
  if (desk.plan && !replace) throw new Refused('The chapter plan is already written. Edit it, or ask the Director again.')
  return pair
}

/**
 * The Director's reply becomes the plan — once, or again with `replace`
 * ("Ask the Director again") while no page has been written from it. The
 * schema already held every slot to its one locked character; this checks
 * it again so a schema edit cannot silently break the alternation. The cover
 * is created with the plan; a replan keeps the cover's art and title and
 * takes the new brief.
 */
export function newPlan(
  desk: Desk,
  out: ChapterPlanOutput,
  pageCount: number,
  meta: { source: ChapterPlan['source']; summarized: boolean; replace?: boolean; now?: Date }
): Desk {
  const pair = assertPlanWritable(desk, meta.replace === true)

  const pages: PlanPage[] = planPages(out, pageCount).map((page, p) => {
    const lines = [page.panel1, page.panel2, page.panel3, page.panel4]
    return {
      panels: PANEL_LAYOUT.map((slot, i) => {
        const line = lines[i]
        const expected = pair[slot.cast].id
        if (!line || line.characterId !== expected) {
          throw new Error(`plan page ${p + 1} panel ${i + 1} names ${line?.characterId}; the layout puts ${expected} there`)
        }
        return cleanLine(line)
      }),
    }
  })
  const brief = out.coverBrief.trim()
  const plan: ChapterPlan = {
    pageCount,
    coverBrief: brief,
    pages,
    source: meta.source,
    summarized: meta.summarized,
    writtenAt: (meta.now ?? new Date()).toISOString(),
  }
  const cover: CoverState = desk.cover ? { ...desk.cover, brief } : newCover(brief, defaultCoverTitle(desk))
  return { ...desk, plan, cover, pageCount: pages.length }
}

/**
 * A plan edit, applied the same way in the browser (instantly) and on the
 * server (inside the lock, after `assertPlanEdit`). Lenient on purpose: an
 * edit that no longer applies — a line on a page that has since been written,
 * a count that would drop an inked page — is ignored here and refused by the
 * server's assert, so typing can never throw inside React.
 */
export function applyPlanEdit(desk: Desk, edit: PlanEdit): Desk {
  const plan = desk.plan
  if (!plan) return desk
  let pages = plan.pages

  if (edit.pageCount !== undefined) {
    const count = clampPageCount(edit.pageCount)
    if (count > pages.length) {
      const ids = planIds(plan)
      pages = [...pages, ...Array.from({ length: count - pages.length }, () => blankPlanPage(ids))]
    } else if (count < pages.length) {
      const dropsWritten = pages.some((_, i) => i >= count && isWritten(desk, i))
      if (!dropsWritten) pages = pages.slice(0, count)
    }
  }

  if (edit.pages) {
    pages = pages.map((page, p) => {
      const lines = edit.pages?.[String(p)]
      if (!lines || isWritten(desk, p)) return page
      return {
        panels: page.panels.map((line, i) => {
          const e = lines[String(i)]
          return e ? { ...line, ...pick(e) } : line
        }),
      }
    })
  }

  const coverBrief = edit.coverBrief ?? plan.coverBrief
  const next: ChapterPlan = { ...plan, pages, pageCount: pages.length, coverBrief }
  const cover = desk.cover && edit.coverBrief !== undefined ? { ...desk.cover, brief: edit.coverBrief } : desk.cover
  return { ...desk, plan: next, cover, pageCount: pages.length }
}

function pick(e: PlanLineEdit): PlanLineEdit {
  const out: PlanLineEdit = {}
  if (e.action !== undefined) out.action = e.action
  if (e.camera !== undefined) out.camera = e.camera
  if (e.background !== undefined) out.background = e.background
  if (e.dialogue !== undefined) out.dialogue = e.dialogue
  return out
}

/** The server's rules for the same edit — refused with a sentence, never dropped silently. */
export function assertPlanEdit(desk: Desk, edit: PlanEdit): void {
  const plan = desk.plan
  if (!plan) throw new Refused('Write the chapter plan first.')
  const count = edit.pageCount === undefined ? plan.pages.length : edit.pageCount
  if (edit.pageCount !== undefined) {
    if (!Number.isInteger(count) || count < PAGE_COUNT_MIN || count > PAGE_COUNT_MAX) {
      throw new Refused(`A chapter plan has ${PAGE_COUNT_MIN} to ${PAGE_COUNT_MAX} pages.`, 400)
    }
    for (let i = count; i < plan.pages.length; i++) {
      if (isWritten(desk, i)) throw new Refused(`Page ${i + 1} is already on the board, so the plan can’t drop it.`)
    }
  }
  for (const key of Object.keys(edit.pages ?? {})) {
    const p = Number(key)
    // A line typed on a page this same edit drops (the save was still waiting
    // when the stepper went down) is accepted here and ignored by `applyPlanEdit`.
    if (!Number.isInteger(p) || p < 0 || p >= Math.max(count, plan.pages.length)) {
      throw new Refused(`There is no page ${p + 1} in the plan.`, 404)
    }
    if (isWritten(desk, p)) throw new Refused(`Page ${p + 1} is already on the board — edit its panels there.`)
  }
}

/**
 * Generate page: the plan's four lines for this desk's page become its four
 * panels — once; a page already written comes back unchanged, which is what
 * makes Generate page and Generate all idempotent. A line with nothing to
 * draw is refused with its page and panel, before any image is requested.
 */
export function pageFromPlan(desk: Desk): Desk {
  if (desk.script) return desk
  const plan = desk.plan
  if (!plan) throw new Refused('Write the chapter plan first.')
  const n = desk.address.pageIndex
  const page = plan.pages[n]
  if (!page) throw new Refused(`There is no page ${n + 1} in the plan.`, 404)
  const blank = assertPageDrawable(page, n)
  if (blank) throw new Refused(blank)
  const [p1, p2, p3, p4] = page.panels
  const out: PageScriptOutput = { panel1: cleanLine(p1), panel2: cleanLine(p2), panel3: cleanLine(p3), panel4: cleanLine(p4) }
  return newScript(desk, out)
}

/** The sentence for the first line on a plan page with nothing to draw, or null. */
export function assertPageDrawable(page: PlanPage, pageIndex: number): string | null {
  if (page.panels.length !== 4) return `Page ${pageIndex + 1} of the plan doesn’t have four panels. Ask the Director again.`
  for (const [i, line] of page.panels.entries()) {
    const missing = (['action', 'camera', 'background', 'dialogue'] as const).find((f) => line[f].trim() === '')
    if (missing) return `Page ${pageIndex + 1}, panel ${i + 1} needs ${missing === 'action' ? 'an action' : `a ${missing === 'dialogue' ? 'line of dialogue' : missing}`} before it can be drawn.`
  }
  return null
}

// --- The cover -----------------------------------------------------------------

export function newCover(brief: string, title: string): CoverState {
  return { brief, title, versions: [], currentVersion: 0, status: 'empty', startedAt: null, startedByRun: null }
}

export function currentCoverImageId(cover: CoverState | null): string | null {
  return cover?.versions[cover.currentVersion]?.imageId ?? null
}

/** The title is the storyteller's; it is lettered over the art and never sent to the model. */
export function applyCoverEdit(desk: Desk, edit: CoverEdit): Desk {
  if (!desk.cover) return desk
  let next = desk
  if (edit.title !== undefined) next = { ...next, cover: { ...(next.cover as CoverState), title: edit.title } }
  if (edit.version !== undefined) next = setCoverVersion(next, edit.version)
  return next
}

/**
 * The cover starts drawing: stamped with the job's claim, like a panel.
 * Refused while another claim holds it, without a brief, or unless both
 * characters are locked — the lead's sheet is the cover's one reference.
 */
export function markCoverInking(desk: Desk, runId: string, now = new Date()): Desk {
  const cover = desk.cover
  if (!cover) throw new Refused('Write the chapter plan first — the cover brief comes with it.')
  if (cover.status === 'inking' && cover.startedByRun !== runId) throw new Refused('The cover is already inking.')
  if (cover.brief.trim() === '') throw new Refused('Write the cover brief first.')
  lockedPair(desk)
  return { ...desk, cover: { ...cover, status: 'inking', startedAt: now.toISOString(), startedByRun: runId } }
}

/** The cover's art landed: a new version, newest last, three kept — the panels' rule. */
export function attachCoverVersion(desk: Desk, imageId: string, now = new Date(), claim?: string): Desk {
  const cover = desk.cover
  if (!cover) throw new Error('attachCoverVersion without a cover')
  if (claim !== undefined && (cover.status !== 'inking' || cover.startedByRun !== claim)) {
    throw new Refused('The cover was reset while it was inking, so this picture was set aside.')
  }
  const versions = [...cover.versions, { imageId, createdAt: now.toISOString() }].slice(-MAX_PANEL_VERSIONS)
  return {
    ...desk,
    cover: { ...cover, versions, currentVersion: versions.length - 1, status: 'done', startedAt: null, startedByRun: null },
  }
}

/** Does the cover already keep this picture? */
export function coverHasVersion(desk: Desk, imageId: string): boolean {
  return desk.cover?.versions.some((v) => v.imageId === imageId) ?? false
}

export function markCoverFailed(desk: Desk, status: Extract<PanelStatus, 'failed' | 'refused'>, claim?: string): Desk {
  const cover = desk.cover
  if (!cover) return desk
  if (claim !== undefined && (cover.status !== 'inking' || cover.startedByRun !== claim)) return desk
  return { ...desk, cover: { ...cover, status, startedAt: null, startedByRun: null } }
}

/** The panels' floor, for the cover: inking that no live job holds is stale. */
export function coverIsStale(cover: CoverState | null, live: ReadonlySet<string>, maxAgeMs: number, now = new Date()): boolean {
  if (cover?.status !== 'inking') return false
  return claimIsStale(cover.startedByRun, cover.startedAt, live, maxAgeMs, now)
}

/** The cover's stepper: the displayed version, clamped to what is kept. */
export function setCoverVersion(desk: Desk, version: number): Desk {
  const cover = desk.cover
  if (!cover || cover.versions.length === 0) return desk
  const v = Math.min(cover.versions.length - 1, Math.max(0, Math.trunc(version)))
  return { ...desk, cover: { ...cover, currentVersion: v } }
}
