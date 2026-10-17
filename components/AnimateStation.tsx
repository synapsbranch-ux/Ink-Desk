'use client'

// Animate this page (v3, slice 22): the section under the four panels that turns
// a finished page into a 20–30 second trailer. It is a small state machine the
// server keeps the truth for — the browser only asks, shows, and polls:
//
//   idle        an Animate button. Shut, with its reason in words beside it, until
//               the page is complete ("Finish this page first") and while today's
//               video allowance or a pause forbids it (`useSpend`, the same
//               sentence the picture buttons give).
//   estimate    `GET .../animate` — what Confirm commits to, worked out by the
//               server from the page as it is now: the shots and their seconds,
//               the trailer's length, the speech, "≈ $x.xx (an estimate)", what it
//               takes from today's video seconds and voice characters, and the
//               model in small print. Confirm or Cancel. Nothing is spent before
//               Confirm; the server plans again at Confirm and its plan is the truth.
//   making      `POST .../animate` → four ShotCards (each its own state, a failed
//               one with its sentence and Try again), a status line that says
//               what is happening ("Putting the trailer together…"), and a bar.
//   done        the player with its poster and captions, Share and Remove.
//
// IT RESUMES. On arrival the station asks `GET .../animate` for the page's newest
// trailer, so leaving the page, closing the tab or a restart of the studio never
// loses a shot: the same four cards are there when the person comes back, wherever
// the work has got to. While a trailer is `queued` or `making` it polls
// `GET /api/videos/<id>` on a recursive timer — never two reads at once, a hidden
// tab asks nothing and reads once when it returns, a failure backs off (the pure
// steps are `lib/poll.ts`) — and when the trailer ends it tells the quota meter
// (`announceUsageChanged`), since a trailer that failed gives its allowance back.
//
// Every refusal is the server's own sentence, shown as it is in a `role="status"`
// line: a busy studio, a rate wait, the pause, "you already have a trailer in the
// works". Nothing here shows a key, a provider's error or a cost other than the
// estimate. Focus moves with the state (to the estimate when it opens, to the
// shots when they start, back to Animate on Cancel). Motion respects
// `prefers-reduced-motion`. Implements `devpost/prd.md > Animate a Page (v3)`
// and `> Responsive (v3)`.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '@/components/api-fetch'
import { ShotCard } from '@/components/ShotCard'
import { SpendNote, spendTitle } from '@/components/SpendNote'
import { VideoActions, VideoPlayer } from '@/components/VideoPlayer'
import { imageUrl } from '@/lib/image-url'
import { asRefusal, refusalSentence } from '@/lib/limits/button'
import { announceUsageChanged, useSpend, useUsage } from '@/lib/limits/use-usage'
import type { UsageView } from '@/lib/limits/view'
import { afterAnswer, afterFailure, FRESH, parseRetryAfter, type Cadence, type PollState } from '@/lib/poll'
import {
  FINISH_THIS_PAGE_FIRST,
  ONE_TRAILER_AT_A_TIME,
  SHOT_MIN_SECONDS,
  type AnimateEstimate,
  type VideoView,
} from '@/lib/video/types'

/** How often a trailer being made is looked at: shots take minutes, so slower than the picture poll, and gentler still when nothing moves. */
const CADENCE: Cadence = { fastMs: 3_000, sameCapMs: 10_000, errorCapMs: 30_000 }
const READ_TIMEOUT_MS = 10_000
/** The least a page's trailer can take of the day's video seconds (four shots of the shortest length): what the Animate button is checked against before the exact plan is known. */
const LEAST_SECONDS = 4 * SHOT_MIN_SECONDS

const UNREACHABLE = 'The studio couldn’t be reached. Is the dev server running?'
const ESTIMATE_FAILED = 'The estimate couldn’t be worked out just now. Try again in a moment.'
const START_FAILED = 'The trailer couldn’t be started just now. Try again in a moment.'
const RETRY_FAILED = 'That shot couldn’t be started again just now. Try again in a moment.'
const LOOKUP_FAILED = 'This page’s trailer couldn’t be looked up just now.'

// --- Small pure helpers (also what the browser check exercises) ----------------------------------

/** "≈ $0.57": under a cent reads as "< $0.01". Always called an estimate where it is shown. */
export function dollars(n: number): string {
  return n > 0 && n < 0.005 ? '< $0.01' : `$${n.toFixed(2)}`
}

/** 24 → "24 s"; 90 → "1 min 30 s". */
export function secondsWords(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}`
}

const n0 = (n: number) => n.toLocaleString('en-US')

/**
 * What the trailer takes from today's allowances, in the words `usesLine` uses for pictures: "Uses 16 of your 20 video
 * seconds today (4 left after) and 420 of your 3,000 voice characters (2,580 left after)." An allowance the trailer does
 * not fit is said plainly instead ("This takes 20 video seconds and you have 4 left today."). Empty when nothing is counted
 * (limits off, the usage not read yet) or the plan has no such allowance.
 */
export function usesVideoLine(usage: UsageView | null | undefined, uses: { videoSeconds: number; audioChars: number }): string {
  if (!usage || !usage.metering) return ''
  const fits: string[] = []
  const short: string[] = []
  for (const [need, meter, words] of [
    [uses.videoSeconds, usage.videoSeconds, 'video seconds'],
    [uses.audioChars, usage.audioChars, 'voice characters'],
  ] as const) {
    if (need <= 0 || meter.limit <= 0) continue
    const left = Math.max(0, meter.limit - meter.used)
    if (need > left) short.push(`This takes ${n0(need)} ${words} and you have ${n0(left)} left today.`)
    else fits.push(`${n0(need)} of your ${n0(meter.limit)} ${words} today (${n0(left - need)} left after)`)
  }
  return [...(fits.length > 0 ? [`Uses ${fits.join(' and ')}.`] : []), ...short].join(' ')
}

/** The model as a person reads it in small print: "seedance-2.0-fast · 480p". */
export function modelWords(model: string, resolution: string): string {
  return `${model.split('/').pop() ?? model} · ${resolution}`
}

/** A reply body that is a trailer's view, else null — nothing the station would trip on. */
export function asVideo(data: unknown): VideoView | null {
  if (typeof data !== 'object' || data === null) return null
  const v = data as Partial<VideoView>
  if (typeof v.id !== 'string' || typeof v.status !== 'string' || !Array.isArray(v.shots) || typeof v.updatedAt !== 'string') return null
  return v as VideoView
}

const isOpen = (v: VideoView | null): boolean => v !== null && (v.status === 'queued' || v.status === 'making')

/** What changed, for the poll's back-off: the status, the phase and each shot's state. */
const signatureOf = (v: VideoView): string => JSON.stringify([v.status, v.phase, v.progress, v.shots.map((s) => s.state), v.videoUrl !== null])

/** The one line that says what is happening. */
export function statusLine(v: VideoView): string {
  const done = v.shots.filter((s) => s.state === 'done').length
  const failedShots = v.shots.filter((s) => s.state === 'failed').length
  if (v.status === 'queued') return 'Waiting its turn — the studio starts it in a moment. You can leave this page; nothing is lost.'
  if (v.status === 'making') {
    return v.phase === 'assembling'
      ? 'Putting the trailer together…'
      : `Animating the shots — ${done} of ${v.shots.length} done. You can leave this page; nothing is lost.`
  }
  if (v.status === 'failed') {
    return v.error ?? (failedShots > 0 ? 'Some shots didn’t finish. Press Try again on a shot to make it again.' : 'The trailer didn’t finish.')
  }
  return failedShots > 0 ? 'The trailer is ready, without the shots that didn’t finish.' : 'The trailer is ready.'
}

// --- The poll ------------------------------------------------------------------------------------

/**
 * Look at the trailer every few seconds while it is being made. A recursive timeout, never an interval: the next look
 * is scheduled when the last has finished, so reads cannot overlap. A tab nobody can see asks nothing and reads once when
 * it comes back; a failed or refused read backs off (and a 429 waits at least its `Retry-After`). A 404 is the trailer being
 * gone (removed in another tab): `onGone`.
 */
function useVideoPoll(videoId: string | null, running: boolean, onView: (v: VideoView) => void, onGone: () => void) {
  const latest = useRef({ onView, onGone })
  useEffect(() => {
    latest.current = { onView, onGone }
  })
  useEffect(() => {
    if (!videoId || !running) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let busy = false
    let paused = false
    let state: PollState = FRESH

    const schedule = (ms: number) => {
      if (stopped) return
      timer = setTimeout(() => {
        timer = null
        // A tab nobody can see asks nothing; coming back starts the loop again.
        if (document.visibilityState !== 'visible') paused = true
        else void look()
      }, ms)
    }
    const look = async () => {
      if (busy || stopped) return
      busy = true
      paused = false
      if (timer) clearTimeout(timer)
      timer = null
      let delay = CADENCE.fastMs
      try {
        const res = await apiFetch(`/api/videos/${encodeURIComponent(videoId)}`, { cache: 'no-store', signal: AbortSignal.timeout(READ_TIMEOUT_MS) })
        if (stopped) return
        if (res.status === 404) {
          latest.current.onGone()
          return
        }
        const view = res.ok ? asVideo(((await res.json().catch(() => null)) as { video?: unknown } | null)?.video) : null
        if (!view) {
          const next = afterFailure(state, CADENCE, res.status === 429 ? parseRetryAfter(res.headers.get('Retry-After')) : null)
          state = next.state
          delay = next.delayMs
          return
        }
        latest.current.onView(view)
        const next = afterAnswer(state, signatureOf(view), [videoId], CADENCE)
        state = next.state
        delay = next.delayMs
      } catch {
        const next = afterFailure(state, CADENCE)
        state = next.state
        delay = next.delayMs
      } finally {
        busy = false
        schedule(delay)
      }
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible' && paused && !busy) void look()
    }
    document.addEventListener('visibilitychange', onVisible)
    schedule(CADENCE.fastMs)
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [videoId, running])
}

// --- The station ---------------------------------------------------------------------------------

type Props = {
  projectId: string
  /** Zero-based page index, as the studio's `openPage`. */
  page: number
  /** All four panels have their pictures. */
  complete: boolean
}

type Phase = 'idle' | 'asking' | 'estimate' | 'starting'

/** A refused request as its one calm sentence: the server's own (with the reset time when a quota or the pause lifts at a known hour), else ours. */
async function sentenceOf(res: Response, fallback: string): Promise<string> {
  const refusal = asRefusal(await res.json().catch(() => null))
  return refusal && refusal.error.length < 300 ? refusalSentence(refusal) : fallback
}

export function AnimateStation({ projectId, page, complete }: Props) {
  const api = `/api/projects/${encodeURIComponent(projectId)}/pages/${page}/animate`
  const n = page + 1

  const [video, setVideo] = useState<VideoView | null>(null)
  const [loaded, setLoaded] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [phase, setPhase] = useState<Phase>('idle')
  const [estimate, setEstimate] = useState<Extract<AnimateEstimate, { ok: true }> | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [retrying, setRetrying] = useState<number | null>(null)

  const animateRef = useRef<HTMLButtonElement>(null)
  const estimateRef = useRef<HTMLHeadingElement>(null)
  const shotsRef = useRef<HTMLHeadingElement>(null)

  const running = isOpen(video)
  const { usage } = useUsage()
  // The Animate button is checked against the least a trailer can take; the estimate card against what this one takes.
  const idleSpend = useSpend({ videoSeconds: LEAST_SECONDS })
  const planSpend = useSpend({ videoSeconds: estimate?.uses.videoSeconds, audioChars: estimate?.uses.audioChars })

  /** A view from the server replaces ours unless it is an older one (a poll that was on the wire when a retry was answered). */
  const take = useCallback((view: VideoView | null) => {
    setVideo((current) => (view && current && current.id === view.id && view.updatedAt < current.updatedAt ? current : view))
  }, [])

  // Arrival: the page's newest trailer, if there is one — this is what makes leaving the page lose nothing.
  const read = useCallback(async () => {
    setLoaded('loading')
    try {
      const res = await apiFetch(api, { cache: 'no-store', signal: AbortSignal.timeout(READ_TIMEOUT_MS) })
      const body = (await res.json().catch(() => null)) as { video?: unknown } | null
      if (!res.ok || !body) throw new Error('unreadable')
      take(body.video ? asVideo(body.video) : null)
      setLoaded('ready')
    } catch {
      setLoaded('failed')
    }
  }, [api, take])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the station reads the page's trailer from the server once it opens
    void read()
  }, [read])

  useVideoPoll(
    video?.id ?? null,
    running,
    take,
    useCallback(() => setVideo(null), [])
  )

  // A trailer ending changes the meter (a failed one gives its allowance back).
  const wasRunning = useRef(false)
  useEffect(() => {
    if (wasRunning.current && !running) announceUsageChanged()
    wasRunning.current = running
  }, [running])

  // Focus follows the state: the estimate when it opens, the shots when they start.
  useEffect(() => {
    if (phase === 'estimate') estimateRef.current?.focus()
  }, [phase])
  const focusShots = useRef(false)
  useEffect(() => {
    if (focusShots.current && video && phase === 'idle') {
      focusShots.current = false
      shotsRef.current?.focus()
    }
  }, [video, phase])

  // Animate: ask for the estimate (never spends), then show it.
  const ask = useCallback(async () => {
    setNotice(null)
    setPhase('asking')
    try {
      const res = await apiFetch(api, { cache: 'no-store' })
      const body = (await res.json().catch(() => null)) as { estimate?: AnimateEstimate; video?: unknown; error?: unknown } | null
      if (!res.ok || !body || !body.estimate) {
        setNotice(typeof body?.error === 'string' && body.error.length < 300 ? body.error : ESTIMATE_FAILED)
        setPhase('idle')
        return
      }
      // Another tab may have started one while this page was open: show that rather than a second estimate.
      const there = body.video ? asVideo(body.video) : null
      if (isOpen(there)) {
        take(there)
        setPhase('idle')
        return
      }
      if (!body.estimate.ok) {
        setNotice(body.estimate.reason)
        setPhase('idle')
        return
      }
      setEstimate(body.estimate)
      setPhase('estimate')
    } catch {
      setNotice(UNREACHABLE)
      setPhase('idle')
    }
  }, [api, take])

  const cancel = useCallback(() => {
    setPhase('idle')
    setEstimate(null)
    setNotice(null)
    requestAnimationFrame(() => animateRef.current?.focus())
  }, [])

  // Confirm: the one request that spends.
  const confirm = useCallback(async () => {
    setNotice(null)
    setPhase('starting')
    try {
      const res = await apiFetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      if (!res.ok) {
        setNotice(await sentenceOf(res, START_FAILED))
        setPhase('estimate')
        return
      }
      const body = (await res.json().catch(() => null)) as { video?: unknown } | null
      const view = body?.video ? asVideo(body.video) : null
      if (!view) {
        setNotice(START_FAILED)
        setPhase('estimate')
        return
      }
      focusShots.current = true
      take(view)
      setEstimate(null)
      setPhase('idle')
    } catch {
      setNotice(UNREACHABLE)
      setPhase('estimate')
    }
  }, [api, take])

  // Try again on one shot: a new, smaller job for exactly that shot.
  const retry = useCallback(
    async (panel: number) => {
      if (!video) return
      setNotice(null)
      setRetrying(panel)
      try {
        const res = await apiFetch(`/api/videos/${encodeURIComponent(video.id)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'retry', shot: panel }),
        })
        if (!res.ok) {
          setNotice(await sentenceOf(res, RETRY_FAILED))
          return
        }
        const body = (await res.json().catch(() => null)) as { video?: unknown } | null
        const view = body?.video ? asVideo(body.video) : null
        if (view) take(view)
        else setNotice(RETRY_FAILED)
      } catch {
        setNotice(UNREACHABLE)
      } finally {
        setRetrying(null)
      }
    },
    [video, take]
  )

  const removed = useCallback(() => {
    setVideo(null)
    setNotice(null)
    requestAnimationFrame(() => animateRef.current?.focus())
  }, [])

  const uses = useMemo(
    () => (estimate ? usesVideoLine(usage, estimate.uses) : ''),
    [estimate, usage]
  )

  // --- What the idle button says about itself ---

  const incomplete = !complete
  const animateShut = incomplete || idleSpend.blocked || phase === 'asking'
  const animateWhy = incomplete ? FINISH_THIS_PAGE_FIRST : idleSpend.blocked ? idleSpend.reason : null
  const busyElsewhere = estimate?.busyVideoId != null
  const confirmShut = planSpend.blocked || busyElsewhere || phase === 'starting'
  const showCards = video !== null
  const finished = video?.status === 'done' || video?.status === 'failed'
  const percent = video?.progress == null ? null : Math.round(Math.min(1, Math.max(0, video.progress)) * 100)
  const anyFailed = video?.shots.some((s) => s.state === 'failed') ?? false
  const imageSrc = (id: string) => (id ? imageUrl(projectId, id) : null)

  const animateLabel = video && finished ? 'Animate again' : 'Animate this page'

  return (
    <section className="animate card" aria-labelledby="animate-title" aria-busy={running || phase === 'asking' || phase === 'starting'}>
      <div className="animate-head">
        <div className="eyebrow eyebrow-sm">Animate · Page {n}</div>
        <h2 id="animate-title" className="animate-title">
          A trailer from this page
        </h2>
        <p className="animate-lede">
          Four short shots, one for each panel, with every line spoken by its character, your bubbles lettered over them and music
          underneath: a trailer of 20 to 30 seconds. Nothing is made until you confirm the estimate.
        </p>
      </div>

      {loaded === 'loading' && !showCards && (
        <p className="animate-line" role="status">
          Looking for this page’s trailer…
        </p>
      )}
      {loaded === 'failed' && !showCards && (
        <div className="notice animate-notice" role="status">
          <span>{LOOKUP_FAILED}</span>
          <button type="button" className="btn btn-secondary" onClick={() => void read()}>
            Try again
          </button>
        </div>
      )}

      {phase === 'estimate' || phase === 'starting' ? (
        estimate && (
          <div className="animate-estimate" role="group" aria-labelledby="animate-estimate-title">
            <h3 id="animate-estimate-title" ref={estimateRef} tabIndex={-1} className="animate-sub">
              What this will take
            </h3>
            <ul className="estimate-shots" aria-label="The shots">
              {estimate.shots.map((s) => (
                <li key={s.panel} className="tag tag-neutral">
                  Panel {s.panel + 1} · {s.seconds} s
                </li>
              ))}
            </ul>
            <dl className="estimate-facts">
              <div>
                <dt>Shots</dt>
                <dd>
                  {estimate.shots.length} shots, {secondsWords(estimate.shotSeconds)} of animation
                </dd>
              </div>
              <div>
                <dt>Trailer</dt>
                <dd>about {secondsWords(estimate.runSeconds)}, with a title card and a closing hold</dd>
              </div>
              <div>
                <dt>Voices</dt>
                <dd>{estimate.speechChars === 0 ? 'No spoken lines on this page' : `${n0(estimate.speechChars)} characters of speech`}</dd>
              </div>
              <div>
                <dt>Cost</dt>
                <dd>
                  ≈ {dollars(estimate.usd)} <span className="estimate-aside">(an estimate)</span>
                </dd>
              </div>
            </dl>
            {uses && <p className="spend-line">{uses}</p>}
            <SpendNote spend={planSpend} id="animate-reason" />
            {busyElsewhere && (
              <p id="animate-busy" className="spend-note" role="status">
                {ONE_TRAILER_AT_A_TIME}
              </p>
            )}
            <p className="estimate-fine">Made with {modelWords(estimate.model, estimate.resolution)}. The studio counts what the provider actually charges.</p>
            {notice && (
              <p className="notice" role="status">
                {notice}
              </p>
            )}
            <div className="animate-actions">
              <button type="button" className="btn btn-secondary" disabled={phase === 'starting'} onClick={cancel}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-stamp"
                disabled={confirmShut}
                aria-describedby={planSpend.blocked ? 'animate-reason' : busyElsewhere ? 'animate-busy' : undefined}
                title={busyElsewhere ? ONE_TRAILER_AT_A_TIME : spendTitle(planSpend, undefined)}
                onClick={() => void confirm()}
              >
                {phase === 'starting' ? 'Starting…' : 'Confirm'}
              </button>
            </div>
          </div>
        )
      ) : (
        <>
          {showCards && video && (
            <>
              {video.status === 'done' && video.videoUrl && (
                <div className="animate-player">
                  <VideoPlayer
                    src={video.videoUrl}
                    poster={video.posterUrl}
                    captions={video.captionsUrl}
                    title={`Trailer of page ${n}`}
                  />
                </div>
              )}

              <h3 ref={shotsRef} tabIndex={-1} className="animate-sub">
                {video.status === 'done' ? 'The shots' : 'The shots, one for each panel'}
              </h3>
              <ol className="shot-grid" aria-label="The four shots">
                {video.shots.map((s) => (
                  <ShotCard
                    key={s.panel}
                    shot={s}
                    imageSrc={imageSrc(s.imageId)}
                    running={running}
                    retrying={retrying === s.panel}
                    otherBusy={retrying !== null && retrying !== s.panel}
                    onRetry={(panel) => void retry(panel)}
                  />
                ))}
              </ol>

              <p className={`animate-line${video.status === 'failed' && !anyFailed ? ' is-failed' : ''}`} role="status">
                {statusLine(video)}
              </p>
              {running && (
                <div
                  className={`animate-progress${percent === null ? ' is-unknown' : ''}`}
                  role="progressbar"
                  aria-label="The trailer’s progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent ?? undefined}
                  aria-valuetext={percent === null ? 'Working' : `${percent}%`}
                >
                  <span className="ink-bar" aria-hidden="true">
                    <span className="ink-bar-fill" style={percent === null ? undefined : { width: `${percent}%` }} />
                  </span>
                  {percent !== null && <span className="animate-progress-figure">{percent}%</span>}
                </div>
              )}
              {video.warnings.length > 0 && (
                <ul className="animate-warnings" aria-label="Notes about this trailer">
                  {video.warnings.map((w, i) => (
                    <li key={`${i}:${w}`}>{w}</li>
                  ))}
                </ul>
              )}

              {finished && <VideoActions videoId={video.id} shareable={video.status === 'done' && video.videoUrl !== null} onRemoved={removed} />}
            </>
          )}

          {notice && (
            <p className="notice animate-notice" role="status">
              {notice}
            </p>
          )}

          {(!showCards || finished) && loaded !== 'loading' && (
            <div className="animate-start">
              <button
                ref={animateRef}
                type="button"
                className={showCards ? 'btn btn-secondary' : 'btn btn-stamp'}
                disabled={animateShut}
                aria-describedby={animateShut && animateWhy ? 'animate-why' : undefined}
                title={animateWhy ?? undefined}
                onClick={() => void ask()}
              >
                {phase === 'asking' ? 'Working out the estimate…' : animateLabel}
              </button>
              {animateShut && animateWhy && (
                <p id="animate-why" className="animate-why spend-note" role="status">
                  {animateWhy}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}
