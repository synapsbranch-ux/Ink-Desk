// One trailer on the desk (v3, slice 21): its poster, how long it runs, where
// it stands, when it was made and — for one still being made — a progress bar.
// Implements `devpost/prd.md > Dashboard (v3)`; slice 22 fills the store it is
// read from and gives the poster a route, so until then `posterUrl` is null and
// the card shows the pencil placeholder the project cards use.
//
// The whole card opens the project the trailer was made from (the page it
// animates lives there). Status is always WORDS as well as a tint, a bar that
// does not know its progress says "Being made" rather than pretending a
// number, and a failed one says so calmly and where to go. The date is
// formatted in UTC with a fixed locale so the server's and the browser's
// markup agree (no hydration mismatch). `page` is the zero-based index the
// project's pages use (the studio calls index 0 "Page 1").
import Link from 'next/link'
import type { VideoSummary } from '@/lib/share/types'

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
  const length = lengthOf(video.seconds)
  const date = dateOf(video.createdAt)
  const running = video.status === 'queued' || video.status === 'making'
  const percent = video.progress === null ? null : Math.round(Math.min(1, Math.max(0, video.progress)) * 100)
  const from = `Page ${video.page + 1}${projectTitle ? ` of ${projectTitle}` : ''}`
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
    </li>
  )
}
