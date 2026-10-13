// The v1 desk becomes a v2 project — once, field by field, nothing re-derived.
// `data/chapter.json` (one chapter of four panels, two characters) turns into
// one project with one chapter of one page; every character, panel, version,
// bubble and image id is copied by reference, so the migrated project serves
// exactly the bytes the v1 desk did. The v1 file itself is never modified.
// See `devpost/spec.md > Data Model (v2)` ("Migration").
//
// Pure, and env-free on purpose: `lib/store/local.ts` calls it; the checks
// can import it before `INKDESK_DATA_DIR` is set.
import { DEFAULT_STYLE_PRESET_ID } from './styles'
import type { Character, Panel, Pitch, Project, Station, Synopsis } from './types'

/** The v1 file shape, kept here as the migration's input type. */
export type ChapterV1 = {
  version: 1
  serverRunId: string
  station: Station
  pitch: Pitch
  synopsis: Synopsis | null
  cast: Character[]
  script: Panel[] | null
  imageCount: number
  updatedAt: string
}

export function isChapterV1(value: unknown): value is ChapterV1 {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return v.version === 1 && Array.isArray(v.cast) && typeof v.pitch === 'object' && v.pitch !== null
}

export function migrateV1(
  v1: ChapterV1,
  ids: { projectId: string; chapterId: string },
  serverRunId: string,
  now: string,
  migratedFrom = 'chapter.json'
): Project {
  return {
    version: 2,
    id: ids.projectId,
    title: v1.synopsis?.title.trim() || 'Chapter 1',
    stylePresetId: DEFAULT_STYLE_PRESET_ID, // v1 drew in the manga rules, verbatim the same text
    story: { mode: 'pitch', pitch: v1.pitch, synopsis: v1.synopsis, scenario: null },
    library: { characters: v1.cast, assets: [] },
    chapters: [
      {
        id: ids.chapterId,
        title: 'Chapter 1',
        plan: null,
        cover: null,
        pages: [{ index: 0, layoutId: 'four-shot', panels: v1.script ?? [] }],
      },
    ],
    // v1 counted images but never stored their cost; the readout starts at $0
    // for a migrated desk and accrues from here on. An honest limit.
    usage: { images: v1.imageCount, costUsd: 0 },
    station: v1.station,
    openPage: 0,
    serverRunId,
    createdAt: v1.updatedAt,
    updatedAt: now,
    migratedFrom,
  }
}
