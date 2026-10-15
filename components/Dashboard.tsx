'use client'

// The desk's front door (v2): project cards, New project, the library shelf
// (empty until slice 10), and the budget readout. Implements
// `devpost/prd.md > Dashboard`. Since slice 19 everything here is the signed-in
// person's own — the page lists only their projects — and every picture is
// asked for under its project's address. Since slice 20 the header carries the
// quota meter and a link to the Usage page, and New project is shut — with the
// reason and the reset time beside it — when today's projects are used up or
// generation is paused (`devpost/prd.md > Limits and Usage (v3)`).
import Image from 'next/image'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { NewProjectDialog } from '@/components/NewProjectDialog'
import { QuotaMeter, USAGE_PATH } from '@/components/QuotaMeter'
import { SpendNote, spendTitle } from '@/components/SpendNote'
import { imageUrl } from '@/lib/image-url'
import { useSpend } from '@/lib/limits/use-usage'
import { stylePreset } from '@/lib/styles'
import type { ProjectSummary, Station } from '@/lib/types'

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
}

export function Dashboard({ projects, notice = null, panelQuality, account = null }: Props) {
  // `/?new=1` opens the dialog straight away — the reader's "New project…" door.
  const search = useSearchParams()
  const [creating, setCreating] = useState(search.get('new') === '1')
  const spend = useSpend({ project: true })

  const library = projects.flatMap((project) => project.characters.map((character) => ({ character, project })))
  const images = projects.reduce((n, p) => n + p.images, 0)
  const cost = projects.reduce((n, p) => n + p.costUsd, 0)

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
          <span className="chapter-title-text">
            {projects.length === 0 ? 'No projects yet' : `${projects.length} project${projects.length === 1 ? '' : 's'}`}
          </span>
        </div>
        <div className="header-spacer" />
        <div className="header-meta">
          <QuotaMeter />
          <Link className="header-link" href={USAGE_PATH}>
            Usage
          </Link>
          <span className="image-counter" title="Every image generated across the desk, and what the providers reported it cost">
            Images: {images} · ≈ {usd(cost)}
          </span>
          <button
            type="button"
            className="btn btn-stamp"
            disabled={spend.blocked}
            aria-describedby={spend.blocked ? 'new-project-reason' : undefined}
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
                <p>Start a project: give it a title, pick the style it will be drawn in, and pitch its story.</p>
                <button
                  type="button"
                  className="btn btn-stamp btn-lg"
                  disabled={spend.blocked}
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
                      <Link href={`/p/${p.id}`} className="project-link" aria-label={`Open ${p.title}`}>
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
        </div>
      </main>

      {creating && <NewProjectDialog panelQuality={panelQuality} onClose={() => setCreating(false)} />}
    </div>
  )
}
