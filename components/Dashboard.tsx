'use client'

// The desk's front door (v2): project cards, New project, the library shelf
// (empty until slice 10), and the budget readout. Implements
// `devpost/prd.md > Dashboard`. Since slice 19 everything here is the signed-in
// person's own — the page lists only their projects — and every picture is
// asked for under its project's address. Since slice 20 the header carries the
// quota meter, and New project is shut — with the reason and the reset time
// beside it — when today's projects are used up or generation is paused
// (`devpost/prd.md > Limits and Usage (v3)`).
//
// Slice 21 (`devpost/prd.md > Dashboard (v3)`): a Settings link takes the
// header's bare Usage link's place (Usage is one tab inside Settings, still at
// `/settings/usage`); a project with an active public share carries a "Shared"
// tag — only a tag, because sharing is managed in the Reader and in Settings —
// and a Videos section sits between Projects and Library, drawn only when the
// page hands it a list (video is closed unless `VIDEO_ENABLED`). A trailer
// being made refreshes the page every few seconds while the tab is visible, so
// its bar moves without a reload; since slice 22 a finished one has a Play button
// (the card opens the player in a dialog, with Share and Remove). Every new prop is optional, so an older
// caller renders the v2 desk. A brand-new account sees the one card that says
// what to do first and nothing else — no empty shelves to explain.
import Image from 'next/image'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { NewProjectDialog } from '@/components/NewProjectDialog'
import { QuotaMeter } from '@/components/QuotaMeter'
import { SpendNote, spendTitle } from '@/components/SpendNote'
import { VideoCard } from '@/components/VideoCard'
import { imageUrl } from '@/lib/image-url'
import { useSpend } from '@/lib/limits/use-usage'
import type { VideoSummary } from '@/lib/share/types'
import { stylePreset, type StylePresetId } from '@/lib/styles'
import type { ProjectSummary, Station } from '@/lib/types'
import './dashboard.css'

/** Where the header's Settings link goes; `/settings` opens its first tab. Usage stays at `/settings/usage`. */
export const SETTINGS_PATH = '/settings'

/** How often a desk with a trailer being made asks the server how it is getting on. */
const VIDEO_REFRESH_MS = 8000

const STATION_LABEL: Record<Station, string> = {
  story: 'Story',
  cast: 'Library',
  director: 'Director',
  storyboard: 'Page',
  reader: 'Ink & Publish',
}

export function usd(n: number): string {
  return n < 0.005 && n > 0 ? '< $0.01' : `$${n.toFixed(2)}`
}

type Props = {
  projects: ProjectSummary[]
  notice?: string | null
  /** The configured panel quality, for the New-project dialog's one-line estimate. */
  panelQuality: string
  /** The account menu (`components/AuthControls.tsx`), rendered on the server; nothing on a desk without accounts. */
  account?: React.ReactNode
  /** Ids of the projects that have an active public share: they carry a "Shared" tag, nothing more. */
  sharedProjectIds?: readonly string[]
  /** The person's trailers, newest first. Omit it and there is no Videos section (video is off); an empty list shows its empty state. */
  videos?: readonly VideoSummary[]
  /** The style Settings › Defaults saved: New project opens with it chosen. */
  defaultStyle?: StylePresetId | null
}

export function Dashboard({
  projects,
  notice = null,
  panelQuality,
  account = null,
  sharedProjectIds = [],
  videos,
  defaultStyle = null,
}: Props) {
  // `/?new=1` opens the dialog straight away — the reader's "New project…" door.
  const search = useSearchParams()
  const router = useRouter()
  const [creating, setCreating] = useState(search.get('new') === '1')
  const spend = useSpend({ project: true })

  // A trailer being made moves its bar without a reload: ask the server again
  // while one is live and the tab is in front. `refresh` keeps the dialog's
  // typing and the scroll where they are.
  const videoLive = (videos ?? []).some((v) => v.status === 'queued' || v.status === 'making')
  useEffect(() => {
    if (!videoLive) return
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh()
    }, VIDEO_REFRESH_MS)
    return () => window.clearInterval(id)
  }, [videoLive, router])

  const library = projects.flatMap((project) => project.characters.map((character) => ({ character, project })))
  const images = projects.reduce((n, p) => n + p.images, 0)
  const cost = projects.reduce((n, p) => n + p.costUsd, 0)
  const shared = new Set(sharedProjectIds)
  const showVideos = videos !== undefined
  const titleOf = new Map(projects.map((p) => [p.id, p.unreadable ? null : p.title]))
  // Nothing to shelve yet: a new account sees what to do first, not three empty sections.
  const bareDesk = projects.length === 0 && (videos?.length ?? 0) === 0
  const counts = [
    projects.length === 0 ? 'No projects yet' : `${projects.length} project${projects.length === 1 ? '' : 's'}`,
    ...(showVideos && videos.length > 0 ? [`${videos.length} video${videos.length === 1 ? '' : 's'}`] : []),
  ].join(' · ')

  return (
    <div className="studio desk">
      <header className="studio-header">
        <div className="brand">
          <Image className="brand-mark" src="/brand/inkdesk-mark.svg" alt="" width={30} height={30} priority />
          <span className="brand-name">Ink Desk</span>
        </div>
        <div className="header-divider" />
        <div className="chapter-title">
          <span className="eyebrow eyebrow-sm">The desk</span>
          <span className="chapter-title-text">{counts}</span>
        </div>
        <div className="header-spacer" />
        <div className="header-meta">
          <QuotaMeter />
          <Link className="header-link" href={SETTINGS_PATH}>
            Settings
          </Link>
          <span className="image-counter" title="Every image generated across the desk, and what the providers reported it cost">
            Images: {images} · ≈ {usd(cost)}
          </span>
          <button
            type="button"
            className="btn btn-stamp"
            disabled={spend.blocked}
            aria-describedby={spend.blocked && spend.reason ? 'new-project-reason' : undefined}
            title={spendTitle(spend, undefined)}
            onClick={() => setCreating(true)}
          >
            New project
          </button>
          {account}
        </div>
      </header>

      <main className="station">
        <div className="station-inner is-wide">
          <section className="desk-section">
            <div className="station-head">
              <div className="eyebrow">Projects</div>
              <h1 className="station-title">Your manga, one project each</h1>
              <p className="station-lede">
                A project is a story, a locked style, a library of characters, and a chapter of pages. Open one to
                keep working, or start another — nothing here is ever cleared without asking.
              </p>
            </div>

            {notice && (
              <p className="notice" role="status">
                {notice}
              </p>
            )}
            <SpendNote spend={spend} id="new-project-reason" />

            {projects.length === 0 ? (
              <div className="desk-empty card">
                <p className="desk-empty-title">The desk is clear.</p>
                <p>Start with New project: a title, a style, and a pitch for the story.</p>
                <button
                  type="button"
                  className="btn btn-stamp btn-lg"
                  disabled={spend.blocked}
                  aria-describedby={spend.blocked && spend.reason ? 'new-project-reason' : undefined}
                  title={spendTitle(spend, undefined)}
                  onClick={() => setCreating(true)}
                >
                  New project
                </button>
              </div>
            ) : (
              <ul className="project-grid" aria-label="Projects">
                {projects.map((p) => {
                  if (p.unreadable) {
                    // Never hidden (CR-14): opening it says what happened and leads back here.
                    return (
                      <li key={p.id} className="project-card card">
                        <Link href={`/p/${p.id}`} className="project-link" aria-label={`Project ${p.id} can’t be read`}>
                          <div className="project-thumb is-pencil">
                            <span className="project-thumb-label">Can’t be read</span>
                          </div>
                          <div className="project-body">
                            <div className="project-title">This project can’t be read</div>
                            <div className="project-meta">
                              <span>It was left exactly as it is.</span>
                              <span>{p.id}</span>
                            </div>
                          </div>
                        </Link>
                      </li>
                    )
                  }
                  const preset = stylePreset(p.stylePresetId)
                  return (
                    <li key={p.id} className="project-card card">
                      <Link href={`/p/${p.id}`} className="project-link" aria-label={`Open ${p.title}${shared.has(p.id) ? ' (shared publicly)' : ''}`}
                      >
                        <div className={`project-thumb${p.thumbnailImageId ? '' : ' is-pencil'}`}>
                          {p.thumbnailImageId ? (
                            // eslint-disable-next-line @next/next/no-img-element -- generated art, served by id
                            <img src={imageUrl(p.id, p.thumbnailImageId)} alt="" />
                          ) : (
                            <span className="project-thumb-label">No art yet</span>
                          )}
                        </div>
                        <div className="project-body">
                          <div className="project-title">{p.title}</div>
                          <div className="project-style">
                            <span className="tag tag-neutral">{preset.label}</span>
                            {shared.has(p.id) && (
                              <span className="tag tag-outline" title="Anyone with its link can read this project’s snapshot">
                                Shared
                              </span>
                            )}
                          </div>
                          <div className="project-meta">
                            <span>
                              {p.pagesInked} of {p.pageCount} page{p.pageCount === 1 ? '' : 's'} inked
                            </span>
                            <span>
                              Images: {p.images} · ≈ {usd(p.costUsd)}
                            </span>
                            <span>At {STATION_LABEL[p.station]}</span>
                          </div>
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {showVideos && !bareDesk && (
            <section className="desk-section" aria-labelledby="desk-videos">
              <div className="station-head">
                <div className="eyebrow">Videos</div>
                <h2 id="desk-videos" className="station-title is-small">
                  Trailers, one per finished page
                </h2>
                <p className="station-lede">
                  Each is made from a page that is fully inked. Play a finished one here, or open the project it came from to make it
                  again.
                </p>
              </div>
              {videos.length === 0 ? (
                <p className="asset-empty">
                  Trailers you make from a finished page appear here. Finish a page in any project, then animate it.
                </p>
              ) : (
                <ul className="project-grid" aria-label="Videos">
                  {videos.map((v) => (
                    <VideoCard key={v.id} video={v} projectTitle={titleOf.get(v.projectId) ?? null} />
                  ))}
                </ul>
              )}
            </section>
          )}

          {!bareDesk && (
            <section className="desk-section">
              <div className="station-head">
                <div className="eyebrow">Library</div>
                <h2 className="station-title is-small">Locked characters, across projects</h2>
                <p className="station-lede">
                  Every locked character on the desk, read-only, with the sheet every panel of theirs is drawn against.
                </p>
              </div>
              {library.length === 0 ? (
                <p className="asset-empty">No locked characters yet — lock a sheet in any project and it appears here.</p>
              ) : (
                <ul className="library-grid" aria-label="Locked characters">
                  {library.map(({ character: c, project }) => (
                    <li key={`${project.id}:${c.id}`} className="library-card card">
                      <Link href={`/p/${project.id}`} className="library-link" title={`Open ${project.title}`}>
                        <div className="library-sheet">
                          {/* eslint-disable-next-line @next/next/no-img-element -- the locked sheet, served by id */}
                          <img src={imageUrl(c.projectId, c.sheetImageId)} alt={`${c.name}’s locked sheet`} />
                        </div>
                        <div className="library-body">
                          <span className="library-name">{c.name}</span>
                          <span className="library-role">{c.role}</span>
                          <span className="library-meta">
                            {c.imported ? 'Imported' : 'Drawn'} · {project.title}
                          </span>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      </main>

      {creating && <NewProjectDialog panelQuality={panelQuality} defaultStyle={defaultStyle} onClose={() => setCreating(false)} />}
    </div>
  )
}

