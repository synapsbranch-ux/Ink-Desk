// The shapes on the desk. See `devpost/spec.md > Data Model` (v1) and
// `> Data Model (v2)`.
//
// Since v2 there are two layers:
//
//   • `Project` is what is persisted — `data/projects/<id>/project.json`: the
//     locked style, the story, the library (characters, assets), chapters of
//     pages, usage. Written only through `lib/store/`.
//   • `Desk` is the per-page working view the page engine, the patch route
//     and every station component operate on: the project's story and cast
//     beside ONE page's four panels. It is projected from a project and
//     written back by `lib/chapter.ts`, never stored. It is v1's `Chapter`
//     shape plus the project's identity, so the pure helpers in `lib/script.ts`,
//     `lib/cast.ts`, `lib/patch.ts`, `lib/gates.ts` and the components run
//     unchanged on it — the v1 name `Chapter` is kept as an alias.
//
// Anything derivable from these (which stations are open, where a speech
// bubble sits) is computed, never stored — see `lib/gates.ts`.
import type { Activity } from './queue/jobs'
import type { PanelLine } from './schemas'
import { DEFAULT_STYLE_PRESET_ID, type StylePresetId } from './styles'

/**
 * The rail's stations, in order. The ids kept their v1 names when slice 11
 * grew the v2 rail, so a stored `station` never needed migrating: `cast` is
 * the Library and `storyboard` is the Page station on screen
 * (`checklist.md > Revisions`).
 */
export type Station = 'story' | 'cast' | 'director' | 'storyboard' | 'reader'

export const STATIONS: readonly Station[] = ['story', 'cast', 'director', 'storyboard', 'reader']

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
  /** v2 (slice 10): set when the sheet is the storyteller's own uploaded
   *  picture rather than a generated sheet. Absent = drawn, as in v1. */
  source?: 'imported'
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

// --- v2: what is persisted -------------------------------------------------

/** Which page of which chapter of which project a desk view shows. */
export type PageAddress = { projectId: string; chapterId: string; pageIndex: number }
export type PageRef = { chapterId: string; pageIndex: number }

/** An uploaded reference (slice 10). Declared now so the shape has room. */
export type Asset = {
  id: string
  kind: 'reference'
  name: string
  blobId: string
  mediaType: string
  bytes: number
  createdAt: string
}

/**
 * Scenario mode (slice 11): a long text, notes, and the shelf references
 * ticked for the Director. `saved` is the explicit "Use this scenario" — the
 * scenario form of accepting a synopsis; it unlocks the Library.
 */
export type Scenario = { text: string; notes: string; referenceAssetIds: string[]; saved: boolean }

/** One page of the plan: the v1 four-shot page, one line per slot. */
export type PlanPage = { panels: PanelLine[] } // exactly 4, slot order

/**
 * The Director's chapter plan (slice 11): every page's four lines and the
 * cover brief, written by one text call and editable after. A page's lines
 * become its panels when the page is generated; from then on the panels are
 * the truth and the plan's lines for that page are read-only.
 */
export type ChapterPlan = {
  pageCount: number // always pages.length, 3–6
  coverBrief: string
  pages: PlanPage[]
  /** What the Director planned from. */
  source: 'scenario' | 'synopsis'
  /** A scenario past the planner's comfortable size was condensed first. */
  summarized: boolean
  writtenAt: string
}

/** The cover (slice 11): one image, the title lettered by the app. */
export type CoverState = {
  brief: string
  title: string
  versions: PanelVersion[]
  currentVersion: number
  status: PanelStatus
  startedAt: string | null
  startedByRun: string | null
}

export type ProjectPage = {
  index: number // 0-based within the chapter
  layoutId: 'four-shot' // the v1 layout; the only one built
  /** `[]` until the page script is written, exactly 4 after. The desk view
   *  shows `[]` as `script: null`, which is what the v1 helpers key on. */
  panels: Panel[]
}

export type ProjectChapter = {
  id: string
  title: string
  plan: ChapterPlan | null
  cover: CoverState | null
  pages: ProjectPage[]
}

export type Project = {
  version: 2
  id: string
  title: string
  stylePresetId: StylePresetId // locked at creation
  story: {
    mode: 'pitch' | 'scenario'
    pitch: Pitch
    synopsis: Synopsis | null
    scenario: Scenario | null
  }
  library: { characters: Character[]; assets: Asset[] }
  chapters: ProjectChapter[] // the UI shows one; the shape allows more
  usage: { images: number; costUsd: number } // the budget readout, from usage.cost
  station: Station
  openPage: number
  serverRunId: string // the process that last wrote the file
  createdAt: string
  updatedAt: string
  /** Set on the project the v1 desk migrated into. */
  migratedFrom?: string
  /** Whose project it is (v3, slice 19): the Clerk user id, or `local` on a
   *  desk without accounts. Absent on a project written before accounts, which
   *  counts as `local` — so only a desk running with `INKDESK_AUTH=off` opens
   *  it until `scripts/claim-projects.mts` gives it an owner. Set once, at
   *  creation; no edit changes it. */
  ownerId?: string
}

/** What the dashboard lists — derived from the project file, never stored. */
export type ProjectSummary = {
  id: string
  title: string
  stylePresetId: StylePresetId
  station: Station
  images: number
  costUsd: number
  pageCount: number
  pagesInked: number
  /** The cover, else the first inked panel, else null. */
  thumbnailImageId: string | null
  /** Every locked character in the project — the dashboard's library shelf. */
  characters: LibraryCharacter[]
  createdAt: string
  updatedAt: string
  /** A project whose stored copy can't be read (CR-14): listed so it isn't
   *  lost from sight, with its id and when it last changed; the rest is empty. */
  unreadable?: true
}

/** One locked character as the global library shows it: read-only. */
export type LibraryCharacter = {
  /** The project it belongs to — its sheet is served under that project's address (slice 19). */
  projectId: string
  id: string
  name: string
  role: string
  sheetImageId: string
  imported: boolean
}

// --- The desk view -----------------------------------------------------------

export type Desk = {
  version: 2 // the view's shape; the browser recognises a desk reply by this field
  address: PageAddress
  title: string
  stylePresetId: StylePresetId
  pageCount: number
  // No serverRunId: it says when the server restarted, and the browser never needed it (SEC-11).
  station: Station
  pitch: Pitch
  synopsis: Synopsis | null
  cast: Character[] // exactly 2 once proposed
  /** The project's uploaded references (slice 10) — the shelf in the Cast station. */
  assets: Asset[]
  script: Panel[] | null // exactly 4 once written — this page's panels
  imageCount: number // the project's images, the header counter
  costUsd: number // the project's spend, from the providers' usage.cost (images and, since slice 11, text)
  updatedAt: string
  // --- slice 11: the Director ---
  storyMode: 'pitch' | 'scenario'
  scenario: Scenario | null
  /** The chapter's plan and cover — chapter-level, so every page's view carries the same ones. */
  plan: ChapterPlan | null
  cover: CoverState | null
  /** The project's open page; a patch to it is the page switcher. */
  openPage: number
  /** Every page of the chapter, derived — the page switcher and "P of Q pages complete". */
  pages: PageSummary[]
  /** The configured panel quality (`IMAGE_PANEL_QUALITY`), for the estimate. Read by the server. */
  panelQuality: string
  /** Slice 12: every page's panels in page order (`[]` for an unwritten page) —
   *  the reader reads and exports the whole chapter from it. Derived, never
   *  written back; the open page's copy to edit is `script`. */
  chapterPanels: Panel[][]
  /** Slice 18: what is being drawn (the job records) and whether the queue is up.
   *  Added to a reply by the routes that report it — the project GET and the
   *  generation POSTs — never stored, never written back; a reply without it
   *  says nothing new, and the studio keeps what it last had. */
  activity?: Activity
}

/** One page as the switcher sees it — derived from the project, never stored. */
export type PageSummary = {
  index: number
  /** The page's four panels exist (from the plan, or a v1 script). */
  written: boolean
  /** Panels with at least one version. */
  inked: number
  inking: number
  /** Failed or refused, with Try again / Rewrite waiting. */
  failed: number
  /** Written panels with no art and nothing in flight — what Generate would still queue. */
  blank: number
  /** Panel 1's current art, else the first inked panel's. */
  thumbnailImageId: string | null
  /** Each slot's current art, in slot order — `[]` until the page is written. */
  panelImageIds: (string | null)[]
}

/** v1's name for the working shape, kept so nothing downstream had to move. */
export type Chapter = Desk

export function emptyDesk(
  address: PageAddress = { projectId: '', chapterId: '', pageIndex: 0 },
  title = '',
  stylePresetId: StylePresetId = DEFAULT_STYLE_PRESET_ID
): Desk {
  return {
    version: 2,
    address,
    title,
    stylePresetId,
    pageCount: 1,
    station: 'story',
    pitch: { text: '', genre: '', tone: '' },
    synopsis: null,
    cast: [],
    assets: [],
    script: null,
    imageCount: 0,
    costUsd: 0,
    updatedAt: new Date().toISOString(),
    storyMode: 'pitch',
    scenario: null,
    plan: null,
    cover: null,
    openPage: 0,
    pages: [{ index: 0, written: false, inked: 0, inking: 0, failed: 0, blank: 0, thumbnailImageId: null, panelImageIds: [] }],
    panelQuality: 'low',
    chapterPanels: [[]],
  }
}

/** v1's name, kept for the checks and the pure helpers. */
export const emptyChapter = emptyDesk

export function emptyProject(input: {
  id: string
  chapterId: string
  title: string
  stylePresetId: StylePresetId
  serverRunId: string
  now?: string
}): Project {
  const now = input.now ?? new Date().toISOString()
  return {
    version: 2,
    id: input.id,
    title: input.title,
    stylePresetId: input.stylePresetId,
    story: { mode: 'pitch', pitch: { text: '', genre: '', tone: '' }, synopsis: null, scenario: null },
    library: { characters: [], assets: [] },
    chapters: [{ id: input.chapterId, title: 'Chapter 1', plan: null, cover: null, pages: [{ index: 0, layoutId: 'four-shot', panels: [] }] }],
    usage: { images: 0, costUsd: 0 },
    station: 'story',
    openPage: 0,
    serverRunId: input.serverRunId,
    createdAt: now,
    updatedAt: now,
  }
}
