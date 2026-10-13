// The shapes in `data/chapter.json`. See `devpost/spec.md > Data Model`.
// Anything derivable from these (which stations are open, where a speech
// bubble sits) is computed, never stored — see `lib/gates.ts`.

export type Station = 'story' | 'cast' | 'storyboard' | 'reader'

export const STATIONS: readonly Station[] = ['story', 'cast', 'storyboard', 'reader']

export type Pitch = { text: string; genre: string; tone: string }

export type Synopsis = { title: string; body: string; accepted: boolean }

export type Character = {
  id: string
  name: string
  role: string
  traits: string[]
  look: string
  dna: string | null // written by Claude on Draw sheet, frozen at lock
  sheetImageId: string | null // → data/images/<id>.<ext>
  locked: boolean // final; no unlock in this version
}

export type PanelStatus = 'empty' | 'inking' | 'done' | 'failed' | 'refused'

export type PanelVersion = { imageId: string; createdAt: string }

/**
 * Where a panel's speech bubble sits, as percentages of the panel — so the
 * layout survives any resolution, a reload, and the slice 7 PNG export
 * composites exactly what the user placed. Absent/null = the derived corner
 * default from `lib/bubble.ts`; it is stored only once the user touches the
 * bubble. A slice 5b addition — `prd.md > Changes Since Approval`.
 */
export type BubbleLayout = {
  x: number // left edge, % of panel width
  y: number // top edge, % of panel height
  w: number // width, % of panel width
  h: number // height, % of panel height
  tailX: number // tail tip, % of panel width — dragged to point at the speaker
  tailY: number // tail tip, % of panel height
}

export type Panel = {
  index: 0 | 1 | 2 | 3
  characterId: string // exactly one, enforced by schema
  action: string
  camera: string
  background: string
  dialogue: string // Claude's line to start; the user's edits replace it
  bubble?: BubbleLayout | null // null/absent = derived default, see above
  versions: PanelVersion[] // newest last, max 3, oldest dropped
  currentVersion: number // the one that counts: on the page and in the export
  status: PanelStatus
  startedAt: string | null // for the timeout fallback
  startedByRun: string | null // for the restart fallback
}

export type Chapter = {
  version: 1 // lets a future shape change migrate rather than crash
  serverRunId: string // the process that last wrote the file
  station: Station
  pitch: Pitch
  synopsis: Synopsis | null
  cast: Character[] // exactly 2 once proposed
  script: Panel[] | null // exactly 4 once written
  imageCount: number // the "Images this chapter: N" counter
  updatedAt: string
}

export function emptyChapter(serverRunId: string): Chapter {
  return {
    version: 1,
    serverRunId,
    station: 'story',
    pitch: { text: '', genre: '', tone: '' },
    synopsis: null,
    cast: [],
    script: null,
    imageCount: 0,
    updatedAt: new Date().toISOString(),
  }
}
