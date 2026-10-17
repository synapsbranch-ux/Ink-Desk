'use client'

// One trailer on the desk (v3, slice 21): its poster, how long it runs, where
// it stands, when it was made and — for one still being made — a progress bar.
// Implements `devpost/prd.md > Dashboard (v3)`. Slice 22 fills the store it is
// read from and gives the poster a route; a trailer without a poster yet (one
// still being made) shows the pencil placeholder the project cards use.
//
// The card opens the project the trailer was made from (the page it animates
// lives there). A finished trailer also has a Play button beside that link, which
// opens the player in a dialog — Share and Remove are in the dialog with it. The
// button sits next to the link, not inside it: a button inside a link is neither
// valid nor reachable by keyboard. Status is always WORDS as well as a tint, a
// bar that does not know its progress says "Being made" rather than pretending a
// number, and a failed one says so calmly and where to go ("Open the project to
// try it again"). The date is formatted in UTC with a fixed locale so the
// server's and the browser's markup agree (no hydration mismatch). `page` is the
// zero-based index the project's pages use (the studio calls index 0 "Page 1").
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/components/api-fetch'
import { VideoActions, VideoDialog, VideoPlayer } from '@/components/VideoPlayer'
import type { VideoSummary } from '@/lib/share/types'
import type { VideoView } from '@/lib/video/types'

const STATUS_WORDS: Record<VideoSummary['status'], string> = {
  queued: 'Waiting its turn',
  making: 'Being made',
  done: 'Ready',
  failed: 'Didn’t finish',
}

/** 24 → "0:24", 90 → "1:30"; a length not yet known (a trailer still queued) reads as nothing. */
export function lengthOf(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  const whole = Math.round(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

export function dateOf(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : DATE.format(d)
}

export function VideoCard({ video, projectTitle }: { video: VideoSummary; projectTitle: string | null }) {
  const router = useRouter()
  const [playing, setPlaying] = useState(false)
  const length = lengthOf(video.seconds)
  const date = dateOf(video.createdAt)
  const running = video.status === 'queued' || video.status === 'making'
  const percent = video.progress === null ? null : Math.round(Math.min(1, Math.max(0, video.progress)) * 100)
  const from = `Page ${video.page + 1}${projectTitle ? ` of ${projectTitle}` : ''}`
  // A finished trailer plays from the desk.
  const playable = video.status === 'done'
  return (
    <li className="project-card video-card card">
      <Link
        href={`/p/${video.projectId}`}
        className="project-link"
        aria-label={`Open ${projectTitle ?? 'the project'}, where this trailer was made`}
      >
        <div className={`project-thumb video-poster${video.posterUrl ? '' : ' is-pencil'}`}>
          {video.posterUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- the poster, served by a route of its own
            <img src={video.posterUrl} alt="" />
          ) : (
            <span className="project-thumb-label">No poster yet</span>
          )}
          {length && <span className="video-length">{length}</span>}
        </div>
        <div className="project-body">
          <div className="project-title">{from}</div>
          <div className="project-style">
            <span className={`tag ${video.status === 'done' ? 'tag-neutral' : 'tag-outline'} video-status is-${video.status}`}>
              {STATUS_WORDS[video.status]}
            </span>
          </div>
          {running && (
            <div
              className={`video-progress${percent === null ? ' is-unknown' : ''}`}
              role="progressbar"
              aria-label={`Trailer from ${from}: ${STATUS_WORDS[video.status].toLowerCase()}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent ?? undefined}
              aria-valuetext={percent === null ? STATUS_WORDS[video.status] : `${percent}%`}
            >
              <span className="ink-bar" aria-hidden="true">
                <span className="ink-bar-fill" style={percent === null ? undefined : { width: `${percent}%` }} />
              </span>
              {percent !== null && <span className="video-progress-figure">{percent}%</span>}
            </div>
          )}
          {video.status === 'failed' && (
            <p className="video-note">This trailer didn’t finish. Open the project to try it again.</p>
          )}
          <div className="project-meta">
            {length && <span>{length} long</span>}
            {date && (
              <span>
                <time dateTime={video.createdAt}>{date}</time>
              </span>
            )}
          </div>
        </div>
      </Link>
      {playable && (
        <div className="video-card-actions">
          <button type="button" className="btn btn-primary" aria-haspopup="dialog" onClick={() => setPlaying(true)}>
            Play<span className="sr-only"> the trailer of {from}</span>
          </button>
        </div>
      )}
      {playing && (
        <VideoDialog title={from} onClose={() => setPlaying(false)}>
          <Playing
            video={video}
            from={from}
            onRemoved={() => {
              setPlaying(false)
              router.refresh()
            }}
          />
        </VideoDialog>
      )}
    </li>
  )
}

/** The dialog's body: asks for the trailer's own addresses (its captions may not exist) and then plays it. */
function Playing({ video, from, onRemoved }: { video: VideoSummary; from: string; onRemoved: () => void }) {
  const [view, setView] = useState<VideoView | null | 'failed'>(null)
  useEffect(() => {
    let alive = true
    apiFetch(`/api/videos/${encodeURIComponent(video.id)}`, { cache: 'no-store' })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as { video?: VideoView } | null
        if (alive) setView(res.ok && body?.video?.videoUrl ? body.video : 'failed')
      })
      .catch(() => {
        if (alive) setView('failed')
      })
    return () => {
      alive = false
    }
  }, [video.id])

  if (view === null) {
    return (
      <p className="video-note-line" role="status">
        Opening the trailer…
      </p>
    )
  }
  if (view === 'failed' || !view.videoUrl) {
    return (
      <p className="notice" role="alert">
        The trailer can’t be opened just now. Try again in a moment.
      </p>
    )
  }
  return (
    <>
      <VideoPlayer src={view.videoUrl} poster={view.posterUrl} captions={view.captionsUrl} title={`Trailer of ${from}`} />
      <VideoActions videoId={video.id} shareable onRemoved={onRemoved} />
    </>
  )
}
