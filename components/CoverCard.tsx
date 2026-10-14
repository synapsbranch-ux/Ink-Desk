'use client'

// The chapter's cover (slice 11): one image drawn from the brief, the lead's
// locked sheet and the project's style — and the title, which the app letters
// over the art in Cormorant Garamond. The title is never sent to the model,
// so it is an HTML overlay here and composited by the export later, exactly
// like a speech bubble. The brief and the title are editable; Generate cover,
// Redraw cover and Try again are the one request; up to three versions are
// kept, stepped with ‹ v / N ›. While inking, the pencil placeholder carries
// the panel stage lines on the server's clock. Since slice 18 the cover is
// inking when the desk says so OR a cover job is waiting or drawing.
// Implements `devpost/prd.md > The Director — Chapter Plan and Cover`.
import { useState } from 'react'
import { GenerationStatus } from '@/components/GenerationStatus'
import { inFlight } from '@/lib/activity'
import { perImage, usd } from '@/lib/cost'
import type { ChapterPatch } from '@/lib/patch'
import { currentCoverImageId } from '@/lib/plan'
import type { JobView } from '@/lib/queue/jobs'
import { PANEL_STAGES } from '@/lib/stages'
import type { CoverState } from '@/lib/types'

type Props = {
  cover: CoverState
  panelQuality: string
  /** The cover request is on the wire. */
  busy: boolean
  /** The active queue job drawing the cover, if any — waiting or running. */
  job: JobView | null
  notice: string | null
  onEdit: (patch: ChapterPatch) => void
  onCommit: (patch: ChapterPatch) => void
  onGenerate: () => void
}

const FAILED: Partial<Record<CoverState['status'], string>> = {
  failed: 'The cover didn’t come back, the studio is busy. Try again in a moment.',
  refused: 'The cover couldn’t be drawn from this brief. Soften the brief and try again.',
}

export function CoverCard({ cover, panelQuality, busy, job, notice, onEdit, onCommit, onGenerate }: Props) {
  const imageId = currentCoverImageId(cover)
  const versions = cover.versions
  const cv = cover.currentVersion
  const inking = inFlight(cover.status, job)
  // Stage line and clock only once the worker has it; a job still waiting for a free worker says so.
  const drawing = inking && (cover.status === 'inking' || job?.status === 'running')
  const failed = inking ? null : (FAILED[cover.status] ?? null)

  // The art fades in once its bytes are here; the pencil stays under it until then.
  const [loaded, setLoaded] = useState<string | null>(null)
  const showArt = imageId !== null && loaded === imageId
  const bind = (el: HTMLImageElement | null) => {
    if (el?.complete && el.naturalWidth > 0) setLoaded(imageId)
  }

  const label = failed ? 'Try again' : versions.length > 0 ? 'Redraw cover' : 'Generate cover'
  const blankBrief = cover.brief.trim() === ''

  return (
    <article className="card cover-card" aria-label="The cover">
      <div className="eyebrow eyebrow-sm cover-kicker">The cover · one image, the title lettered by the app</div>

      <div className={`cover-frame${showArt ? ' is-inked' : ''}`} aria-busy={inking || undefined}>
        {!showArt && (
          <div className={`cover-pencil sketch${inking ? ' is-drawing' : ' is-still'}${failed ? ' is-failed' : ''}`}>
            {drawing && !imageId && <div className="speedlines" />}
            {drawing && !imageId ? (
              <GenerationStatus stages={PANEL_STAGES} startedAt={cover.startedAt} />
            ) : inking && !imageId ? (
              <span className="pencil-label">Waiting its turn…</span>
            ) : (
              <span className="pencil-label">{failed ?? (imageId ? 'Loading the cover…' : 'No cover yet')}</span>
            )}
          </div>
        )}
        {imageId && (
          // eslint-disable-next-line @next/next/no-img-element -- generated art, served by id
          <img
            key={imageId}
            ref={bind}
            className={`cover-art${showArt ? '' : ' is-loading'}`}
            src={`/api/image/${imageId}`}
            alt="The chapter’s cover art"
            onLoad={() => setLoaded(imageId)}
          />
        )}
        {cover.title.trim() && <h2 className="cover-title">{cover.title}</h2>}
        {drawing && imageId && (
          <div className="redraw-indicator" aria-hidden="true">
            <GenerationStatus stages={PANEL_STAGES} startedAt={cover.startedAt} />
          </div>
        )}
        {inking && !drawing && imageId && (
          <div className="redraw-indicator" role="status">
            <div className="gen-status">
            <span className="gen-stage">Waiting its turn…</span>
          </div>
          </div>
        )}
        {versions.length >= 2 && (
          <div className="panel-bar">
            <div className="stepper" role="group" aria-label="Cover versions">
              <button
                type="button"
                className="stepper-btn"
                disabled={cv === 0}
                title={cv === 0 ? 'This is the oldest version the desk kept.' : 'Show the previous version'}
                onClick={() => onCommit({ cover: { version: cv - 1 } })}
              >
                ‹
              </button>
              <span className="stepper-count">
                {cv + 1} / {versions.length}
              </span>
              <button
                type="button"
                className="stepper-btn"
                disabled={cv === versions.length - 1}
                title={cv === versions.length - 1 ? 'This is the newest version.' : 'Show the next version'}
                onClick={() => onCommit({ cover: { version: cv + 1 } })}
              >
                ›
              </button>
            </div>
          </div>
        )}
      </div>

      <label className="plan-field">
        <span className="plan-field-label">Title · lettered over the art, never drawn</span>
        <input
          className="plan-input cover-title-input"
          value={cover.title}
          maxLength={120}
          onChange={(e) => onEdit({ cover: { title: e.target.value } })}
        />
      </label>
      <label className="plan-field">
        <span className="plan-field-label">Cover brief</span>
        <textarea
          className={`plan-input${blankBrief ? ' is-blank' : ''}`}
          rows={4}
          value={cover.brief}
          placeholder="needs a brief — who is on the cover, doing what, where"
          onChange={(e) => onEdit({ plan: { coverBrief: e.target.value } })}
        />
      </label>

      <div className="cover-actions">
        <button
          type="button"
          className={versions.length > 0 && !failed ? 'btn btn-secondary' : 'btn btn-primary'}
          disabled={inking || busy || blankBrief}
          title={
            blankBrief
              ? 'Write the cover brief first.'
              : 'One image from the brief, the lead’s locked sheet and the project’s style. The current cover stays until the new one lands.'
          }
          onClick={onGenerate}
        >
          {busy ? 'Queuing…' : inking ? 'Inking…' : label}
        </button>
        <span className="plan-page-estimate">≈ {usd(perImage(panelQuality).usd)} · 1 image</span>
      </div>
      {failed && imageId && <p className="plan-page-blank">{failed} The cover above is the last one that landed.</p>}
      {notice && (
        <p className="notice" role="alert">
          {notice}
        </p>
      )}
    </article>
  )
}
