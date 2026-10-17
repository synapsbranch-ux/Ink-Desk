// The trailer's shapes (v3, slice 22). Plain data and constants, client-safe:
// nothing here imports a server module, so a component, a route, the worker and
// the checks all read the same words. `lib/video/plan.ts` is the pure planner
// over them; `lib/share/types.ts > VideoRecord` is what is stored. See
// `devpost/spec.md > Animate a Page (v3)` and `> As built — slice 22`.
//
// A TRAILER is one finished page animated: an opening title card, one shot per
// panel (Seedance), each line of dialogue spoken by its character's voice with
// its bubble lettered by the app over the shot, music under it all, and a
// closing hold — assembled by ffmpeg in the worker into `final.mp4`.
import type { BubbleLayout } from '../types'

/** The two ways to hand Seedance a panel (`spec.md > Decisions and Open Issues (v3)`): A = the panel as the first frame; B = the panel and the character's sheet as references. */
export type MotionMethod = 'A' | 'B'

/** The two ratios a panel is sent at. Seedance has no 3:2, so a wide panel is cropped to 16:9; a square panel goes as it is. */
export type ShotAspect = '16:9' | '1:1'

// --- Lengths (seconds) ----------------------------------------------------------

/** Seedance 2.x offers 4–15 s per shot (`GET /videos/models`, measured in slice 17): 4 is the shortest a shot can be. */
export const SHOT_MIN_SECONDS = 4
export const SHOT_MAX_SECONDS = 5
/** The opening title card, and the least the closing hold may be. */
export const INTRO_SECONDS = 3
export const OUTRO_MIN_SECONDS = 2
/** The finished trailer is 20–30 s (`prd.md > Animate a Page (v3)`); four shots of 4–5 s plus the two cards always land inside it. */
export const TRAILER_MIN_SECONDS = 20
export const TRAILER_MAX_SECONDS = 30
/** The picture is 1280×720 at every resolution the assembly writes; a 1:1 shot sits centred on the paper canvas. */
export const TRAILER_WIDTH = 1280
export const TRAILER_HEIGHT = 720
export const TRAILER_FPS = 24

// --- The plan (what Confirm commits to) -------------------------------------------

/** One spoken line: who says it, in which voice, and the bubble that carries it over the shot. */
export type TrailerLine = {
  panel: number
  /** The speaking character, or null for narration (a panel whose speaker is not in the cast). */
  characterId: string | null
  speaker: string | null
  /** The words, as the panel's `dialogue` is at the moment of Confirm. */
  text: string
  /** The ElevenLabs voice name (`Character.voice`), chosen once and kept. */
  voice: string
  chars: number
  /** Where the bubble sits on the PANEL, as the reader shows it (% of the panel, 3:2 or 1:1) — mapped onto the shot's frame by `bubbleOnShot`. */
  bubble: BubbleLayout
}

/** One shot of the plan: a panel, the picture it starts from and how long it runs. */
export type TrailerShot = {
  panel: number
  /** The panel's current picture when the plan was made — pinned, so an edit while it animates changes nothing. */
  imageId: string
  characterId: string
  aspect: ShotAspect
  seconds: number
  /** The panel's own words, kept so the motion prompt needs no second read of the project. */
  camera: string
  action: string
  background: string
  /** The line spoken over this shot, if the panel has dialogue. */
  line: TrailerLine | null
}

export type TrailerPlan = {
  /** The project's title, lettered on the opening card. */
  title: string
  /** Zero-based page index, as `Desk.openPage`. */
  page: number
  /** What the shots are made with, pinned at Confirm. */
  model: string
  resolution: string
  method: MotionMethod
  shots: TrailerShot[]
  /** Σ shot seconds. */
  shotSeconds: number
  introSeconds: number
  outroSeconds: number
  /** The finished trailer's length: intro + shots + outro. */
  runSeconds: number
  /** Σ characters to be spoken. */
  speechChars: number
}

// --- What is stored per part ----------------------------------------------------------

/**
 * A shot's life. `submitting` is written BEFORE the paid POST and `animating`
 * (with the provider's job id) straight after, so a crash between the two leaves
 * a `submitting` shot with no id: it becomes `orphaned` and is never re-submitted
 * by the machine — a person's Try again is the only thing that pays for it again.
 */
export type ShotState = 'queued' | 'submitting' | 'animating' | 'done' | 'failed' | 'orphaned'

export type ShotRecord = {
  panel: number
  state: ShotState
  /** OpenRouter's video job id, once the POST answered. */
  providerJobId: string | null
  /** The downloaded clip in the outputs store. */
  blobKey: string | null
  /** What the provider billed for this shot, across attempts. */
  costUsd: number
  /** How many times a person or the machine has started it. */
  attempts: number
  /** A sentence the browser may show; never internals. */
  error: string | null
  updatedAt: string
}

export type PartState = 'queued' | 'working' | 'done' | 'failed'

/** One line's voice clip. */
export type SpeechRecord = {
  panel: number
  state: PartState
  blobKey: string | null
  /** The clip's measured length. */
  seconds: number | null
  costUsd: number
  error: string | null
}

export type MusicRecord = {
  state: PartState
  blobKey: string | null
  seconds: number | null
  costUsd: number
  error: string | null
}

// --- What the browser sees --------------------------------------------------------------

/** The four states a shot card shows. `orphaned` reads as `failed` with its own sentence. */
export type ShotCardState = 'queued' | 'animating' | 'done' | 'failed'

export type ShotView = {
  panel: number
  state: ShotCardState
  seconds: number
  /** The panel's picture, for the card (served under the project's own image route). */
  imageId: string
  /** The sentence for a failed shot. */
  error: string | null
  /** A person may press Try again on this one (it failed, nothing is running). */
  canRetry: boolean
}

/** A trailer as the studio and the dashboard poll it: no keys, owner or costs. */
export type VideoView = {
  id: string
  projectId: string
  /** Zero-based page. */
  page: number
  status: 'queued' | 'making' | 'done' | 'failed'
  /** Where the work is: the shots, the assembly, or nothing running. */
  phase: 'shots' | 'assembling' | null
  /** The trailer's length: the plan's until it is assembled, the measured one after. */
  seconds: number
  /** 0..1 while one is being made, else null. */
  progress: number | null
  shots: ShotView[]
  /** Calm notes about parts that did not make it (a voice line or the music): the trailer is whole without them. */
  warnings: string[]
  error: string | null
  /** Present once `final.mp4` exists. */
  videoUrl: string | null
  posterUrl: string | null
  captionsUrl: string | null
  createdAt: string
  updatedAt: string
}

/** What the Animate station shows before anything is spent. */
export type AnimateEstimate =
  | {
      ok: true
      page: number
      shots: { panel: number; seconds: number; aspect: ShotAspect }[]
      shotSeconds: number
      runSeconds: number
      speechChars: number
      /** The dollar estimate the hold is taken at (shots + voices + music), as an estimate always. */
      usd: number
      /** What it takes from today's quota — the same figures `reserve` is asked for. */
      uses: { videoSeconds: number; audioChars: number }
      model: string
      resolution: string
      /** A trailer already in the works (this person may have one at a time). */
      busyVideoId: string | null
    }
  | { ok: false; reason: string }

export const FINISH_THIS_PAGE_FIRST = 'Finish this page first — all four panels need their pictures.'
export const ONE_TRAILER_AT_A_TIME = 'You already have a trailer in the works. Let it finish, then animate another.'
export const VIDEO_IS_CLOSED = 'Animating pages isn’t open yet.'
