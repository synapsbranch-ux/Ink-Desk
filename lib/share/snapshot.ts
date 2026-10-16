// The snapshot a share publishes (v3, slice 21). Pure: a project goes in, and
// what a stranger holding the link may see comes out — through an ALLOW-LIST.
// Every field below is named on purpose; nothing is copied by spreading, so a
// field added to a project tomorrow (the scenario, the DNA, a cost, a note) can
// never reach a public page by accident. The allow-list is the chapter's title,
// the reading direction its style gives it, the drawn cover (its picture and
// the title lettered over it) and, for each COMPLETE page, its four panels:
// the picture, the line said, where the bubble sits, the speaking character's
// name and the slot's fixed shot label. Nothing else of the owner's.
//
// A panel's shot label is the reader's own static slot label ("wide
// establishing shot"), never the author's camera notes; the speaker is the
// character's name, never their look or DNA. The bubble is resolved here (the
// stored layout, or the derived default the reader would draw) so the public
// reader needs neither the camera notes nor the cast.
//
// Every string is control-character-stripped and length-capped; every picture
// id is checked to be the shape the store makes. `publicManga` runs the same
// allow-list over a snapshot read BACK from the store, so a record that was
// edited by hand, or written by a later version with more fields, still hands
// out exactly this much and no more. A project with nothing readable — no drawn
// cover and no complete page — has nothing to share: `NothingReadable`.
//
// The studio's "stale" test is also here: a share is stale when a snapshot
// taken now would differ from the one published (`snapshotsDiffer`), not when
// the project's timestamp moved — walking to another station touches the
// project but changes nothing a reader sees.
// See `devpost/spec.md > Sharing (v3)` and `devpost/prd.md > Sharing (v3)`.
import { bubbleLayout, clampBubble } from '../bubble'
import { Refused } from '../errors'
import { currentCoverImageId } from '../plan'
import { PANEL_LAYOUT } from '../prompts'
import { chapterTitle, isPageComplete, readingMode } from '../reader'
import { currentImageId } from '../script'
import { isImageId } from '../store/local'
import type { BubbleLayout, Panel, Project } from '../types'
import type { MangaSnapshot, ShareReading, SnapshotPage, SnapshotPanel } from './types'

/** What a manga share holds at most — a project never gets near these; they bound a hand-edited record. */
export const SNAPSHOT_LIMITS = {
  title: 200,
  coverTitle: 120,
  dialogue: 500,
  speaker: 60,
  shot: 60,
  pages: 12,
} as const

/** The sentence for a project with nothing to publish yet. */
export const NOTHING_READABLE = 'There’s nothing to share yet. Ink the cover or a whole page first, then share it.'

/** A project with no drawn cover and no complete page: 409, with a way forward in the sentence. */
export class NothingReadable extends Refused {
  constructor() {
    super(NOTHING_READABLE, 409)
    this.name = 'NothingReadable'
  }
}

// Controls (C0, C1, DEL), line and paragraph separators, the bidi embeddings, overrides and isolates (which can make
// one line read as another), the byte-order mark and the interlinear annotation marks. Tabs and line breaks become a
// space first; everything else here is simply dropped.
const BREAKS = /[\t\n\r\u2028\u2029]+/gu
const DROPPED = /[\p{Cc}\u202A-\u202E\u2066-\u2069\uFEFF\uFFF9-\uFFFB]/gu

/** A string as a share may carry it: well-formed, control-free, on one line, trimmed, at most `max` characters. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  const wellFormed = typeof value.toWellFormed === 'function' ? value.toWellFormed() : value
  const flat = wellFormed.replace(BREAKS, ' ').replace(DROPPED, '').replace(/ {2,}/g, ' ').trim()
  // By code point, so a cap never cuts an emoji or any other surrogate pair in half.
  const points = Array.from(flat)
  return points.length > max ? points.slice(0, max).join('').trim() : flat
}

/** A number as a bubble coordinate: finite, or the layout is not trusted at all. */
function bubbleOf(raw: unknown): BubbleLayout | null {
  const b = raw as Partial<Record<keyof BubbleLayout, unknown>> | null
  if (typeof b !== 'object' || b === null) return null
  const keys = ['x', 'y', 'w', 'h', 'tailX', 'tailY'] as const
  if (!keys.every((key) => typeof b[key] === 'number' && Number.isFinite(b[key]))) return null
  return clampBubble({ x: b.x as number, y: b.y as number, w: b.w as number, h: b.h as number, tailX: b.tailX as number, tailY: b.tailY as number })
}

const READINGS: readonly ShareReading[] = ['ltr', 'rtl', 'vertical']

/** The preset's reading mode in the snapshot's words: manga opens right to left, manhwa as one scroll. */
function readingOf(stylePresetId: string): ShareReading {
  return readingMode(stylePresetId) === 'vertical' ? 'vertical' : 'rtl'
}

/**
 * The manga snapshot of a project as it stands `now`: the chapter's title (the
 * one the reader shows), the style's reading direction, the drawn cover, and
 * every complete page. Throws `NothingReadable` when there is neither a drawn
 * cover nor a complete page.
 */
export function buildMangaSnapshot(project: Project, now: Date | string): MangaSnapshot {
  const chapter = project.chapters[0]
  if (!chapter) throw new NothingReadable()

  const title =
    cleanText(chapterTitle({ cover: chapter.cover, synopsis: project.story.synopsis, title: project.title }), SNAPSHOT_LIMITS.title) || 'Untitled chapter'

  const coverImageId = currentCoverImageId(chapter.cover)
  const cover =
    chapter.cover && coverImageId && isImageId(coverImageId)
      ? { imageId: coverImageId, title: cleanText(chapter.cover.title, SNAPSHOT_LIMITS.coverTitle) }
      : null

  const nameOf = (characterId: string): string | null =>
    cleanText(project.library.characters.find((c) => c.id === characterId)?.name, SNAPSHOT_LIMITS.speaker) || null

  const pages: SnapshotPage[] = []
  chapter.pages.forEach((page, index) => {
    if (pages.length >= SNAPSHOT_LIMITS.pages || !isPageComplete(page.panels)) return
    const panels: SnapshotPanel[] = []
    for (const slot of PANEL_LAYOUT) {
      const panel: Panel | undefined = page.panels[slot.index]
      const imageId = panel ? currentImageId(panel) : null
      if (!panel || !imageId || !isImageId(imageId)) return // a page with a hole in it does not read
      panels.push({
        imageId,
        dialogue: cleanText(panel.dialogue, SNAPSHOT_LIMITS.dialogue),
        bubble: bubbleLayout(panel),
        speaker: nameOf(panel.characterId),
        shot: slot.shot,
      })
    }
    pages.push({ index, panels })
  })

  if (!cover && pages.length === 0) throw new NothingReadable()
  return {
    kind: 'manga',
    title,
    reading: readingOf(project.stylePresetId),
    cover,
    pages,
    takenAt: typeof now === 'string' ? now : now.toISOString(),
  }
}

/**
 * A snapshot as the PUBLIC may see it: the allow-list applied again to whatever
 * the store returned. Every field is re-picked and re-checked, never spread, so
 * the page, the JSON route and the preview image can hand out nothing a
 * snapshot was never meant to hold — whatever is in the record. Null for a
 * record that is not a manga snapshot.
 */
export function publicManga(raw: unknown): MangaSnapshot | null {
  const s = raw as Partial<MangaSnapshot> | null
  if (typeof s !== 'object' || s === null || s.kind !== 'manga') return null

  const cover =
    typeof s.cover === 'object' && s.cover !== null && typeof s.cover.imageId === 'string' && isImageId(s.cover.imageId)
      ? { imageId: s.cover.imageId, title: cleanText(s.cover.title, SNAPSHOT_LIMITS.coverTitle) }
      : null

  const pages: SnapshotPage[] = []
  for (const page of Array.isArray(s.pages) ? s.pages.slice(0, SNAPSHOT_LIMITS.pages) : []) {
    const p = page as Partial<SnapshotPage> | null
    if (typeof p !== 'object' || p === null || !Number.isInteger(p.index) || (p.index as number) < 0 || !Array.isArray(p.panels) || p.panels.length !== 4) continue
    const panels: SnapshotPanel[] = []
    for (const slot of PANEL_LAYOUT) {
      const q = p.panels[slot.index] as Partial<SnapshotPanel> | null
      if (typeof q !== 'object' || q === null || typeof q.imageId !== 'string' || !isImageId(q.imageId)) break
      panels.push({
        imageId: q.imageId,
        dialogue: cleanText(q.dialogue, SNAPSHOT_LIMITS.dialogue),
        bubble: bubbleOf(q.bubble),
        speaker: cleanText(q.speaker, SNAPSHOT_LIMITS.speaker) || null,
        // The slot's own label, whatever the record says: the set of words is fixed.
        shot: slot.shot,
      })
    }
    if (panels.length === 4) pages.push({ index: p.index as number, panels })
  }

  return {
    kind: 'manga',
    title: cleanText(s.title, SNAPSHOT_LIMITS.title) || 'Untitled chapter',
    reading: READINGS.includes(s.reading as ShareReading) ? (s.reading as ShareReading) : 'rtl',
    cover,
    pages,
    takenAt: typeof s.takenAt === 'string' ? cleanText(s.takenAt, 40) : '',
  }
}

/** Every picture a snapshot publishes — the only ids the image route will serve for its token. */
export function snapshotImageIds(snapshot: MangaSnapshot): Set<string> {
  const ids = new Set<string>()
  if (snapshot.cover) ids.add(snapshot.cover.imageId)
  for (const page of snapshot.pages) for (const panel of page.panels) ids.add(panel.imageId)
  return ids
}

/** JSON with every object's keys in order, so two snapshots compare by what they hold and not by how a store ordered the keys. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const o = value as Record<string, unknown>
    return `{${Object.keys(o)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(o[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** Would the reader see something different? Everything but the time the snapshot was taken is compared. */
export function snapshotsDiffer(published: MangaSnapshot, current: MangaSnapshot): boolean {
  return stable({ ...published, takenAt: '' }) !== stable({ ...current, takenAt: '' })
}
