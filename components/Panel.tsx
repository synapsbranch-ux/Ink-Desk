'use client'

// One panel of the page: the pencil placeholder, the art inking in the
// moment it lands, the editable speech bubble over it — and, since slice 6,
// the repairs: Redraw panel on inked art (the current art stays visible
// under an "Inking…" indicator), Try again on a failure, the ‹ 2 / 2 ›
// version stepper once a panel has two versions. Each panel owns its own
// status, so one landing or failing never touches another.
// Since slice 18 a panel is waiting or inking when it says `inking` OR a job
// on the queue targets it; a blank panel nothing is drawing shows as blank,
// with a Draw panel button, instead of "Pencilling…" for ever (CR-9).
// Implements `devpost/prd.md > Storyboard — The Main Studio`; see
// `devpost/spec.md > Components > Storyboard Station and Panel`.
import { useState } from 'react'
import { GenerationStatus } from '@/components/GenerationStatus'
import { useImageUrl } from '@/components/project-image'
import { PencilPlaceholder } from '@/components/PencilPlaceholder'
import { SpeechBubble } from '@/components/SpeechBubble'
import { inFlight, isIdleBlank } from '@/lib/activity'
import type { PanelEdit } from '@/lib/patch'
import type { PanelSlot } from '@/lib/prompts'
import type { JobView } from '@/lib/queue/jobs'
import { currentImageId, panelLabel } from '@/lib/script'
import { PANEL_STAGES } from '@/lib/stages'
import type { Character, Panel as PanelData } from '@/lib/types'

type Props = {
  slot: PanelSlot
  /** Null until the page script is written. */
  panel: PanelData | null
  character: Character | null
  /** What an unwritten slot says — the page script is coming, or the page isn't generated yet. */
  emptyLabel?: string
  /** A repair request for this panel is on the wire. */
  busy: 'redraw' | 'rewrite' | null
  /** The active queue job drawing this panel, if any — waiting or running. */
  job: JobView | null
  /** The blank panels are being queued right now: not idle, not yet a job. */
  starting?: boolean
  /** For a blank panel whose job failed before the desk could say so: the server's sentence. */
  lostNote?: string | null
  /** A bubble placed or a line retyped — saved to the desk at once. */
  onPanelEdit: (index: number, edit: PanelEdit) => void
  /** Redraw panel and Try again: the same request, the same locked sheet. */
  onRedraw: (index: number) => void
  /** Rewrite panel, after a refusal: Claude rephrases only the visuals. */
  onRewrite: (index: number) => void
}

export function Panel({
  slot,
  panel,
  character,
  emptyLabel,
  busy,
  job,
  starting = false,
  lostNote = null,
  onPanelEdit,
  onRedraw,
  onRewrite,
}: Props) {
  const imageId = panel ? currentImageId(panel) : null
  const imageSrc = useImageUrl()

  // Ids whose art has been on screen before — present at mount, stepped back
  // to, or already revealed. Only a never-seen id plays the ink-in, so the
  // version stepper never replays the reveal. (The set is a stable store,
  // mutated on purpose; it never drives a render by itself.)
  const [seen] = useState(() => new Set(panel?.versions.map((v) => v.imageId) ?? []))
  const [loaded, setLoaded] = useState<string | null>(null) // the id whose bytes are on screen
  const [inkedId, setInkedId] = useState<string | null>(null) // the id whose reveal has finished

  const isNew = imageId !== null && !seen.has(imageId)
  const showArt = imageId !== null && loaded === imageId
  const revealing = showArt && isNew && inkedId !== imageId
  // The pencil stays under the art until the ink wipe is done.
  const pencilUnder = !showArt || revealing

  const hasArt = (panel?.versions.length ?? 0) > 0
  // In flight: the desk says inking, or a job targets the panel (a redraw
  // sits in the queue, over finished art, before the worker marks it inking).
  const inking = panel !== null && inFlight(panel.status, job)
  const idle = panel ? isIdleBlank(panel.status, job) && !starting : false
  const failed = (panel?.status === 'failed' || panel?.status === 'refused') && !inking
  // Speed lines and stage line only once the worker has it.
  const drawing = inking && (panel?.status === 'inking' || job?.status === 'running')
  const redrawing = drawing && hasArt
  // A redraw over finished art whose job is only waiting for a free worker: say so, with no stage line or clock.
  const waitingRedraw = inking && hasArt && !drawing
  const still = !panel || idle || (failed && !hasArt)

  const onLoad = () => setLoaded(imageId)
  // A cached image can be complete before `load` fires.
  const bind = (el: HTMLImageElement | null) => {
    if (el?.complete && el.naturalWidth > 0) setLoaded(imageId)
  }

  const n = slot.index + 1
  const label = !panel
    ? (emptyLabel ?? 'Waiting for the page script…')
    : idle
      ? (lostNote ?? `Panel ${n} isn’t drawn yet.`)
      : inking && panel.status !== 'inking' && panel.status !== 'empty' && !hasArt
        ? `Pencilling panel ${n}…` // a Try again waiting its turn
        : panelLabel(panel)
  const versions = panel?.versions ?? []
  const cv = panel?.currentVersion ?? 0

  return (
    <figure
      className={`panel panel-${slot.shape}`}
      data-panel={slot.index}
      data-status={panel?.status ?? 'none'}
      data-inked={showArt && !revealing ? 'true' : undefined}
      aria-busy={inking || undefined}
    >
      {pencilUnder && (
        <PencilPlaceholder
          slot={slot}
          label={label}
          still={still}
          failed={failed || (idle && lostNote !== null)}
          generating={drawing && !hasArt}
          startedAt={panel?.startedAt}
        />
      )}
      {imageId && (
        // eslint-disable-next-line @next/next/no-img-element -- served by our own route as final bytes; this is the art the lock is judged on
        <img
          key={imageId}
          ref={bind}
          className={`panel-art${showArt ? '' : ' is-loading'}${revealing ? ' is-inking' : ''}`}
          src={imageSrc(imageId)}
          alt={character ? `${character.name}, ${slot.shot}` : `Panel ${n}`}
          onLoad={onLoad}
          onAnimationEnd={() => {
            seen.add(imageId)
            setInkedId(imageId)
          }}
        />
      )}
      {panel && (
        <SpeechBubble
          panel={panel}
          faint={pencilUnder}
          onLayout={(bubble) => onPanelEdit(panel.index, { bubble })}
          onDialogue={(dialogue) => onPanelEdit(panel.index, { dialogue })}
        />
      )}

      {/* A redraw in progress: the current art stays, the indicator says so. */}
      {redrawing && (
        <div className="redraw-indicator" aria-hidden="true">
          <GenerationStatus stages={PANEL_STAGES} startedAt={panel?.startedAt} />
        </div>
      )}
      {waitingRedraw && (
        <div className="redraw-indicator" role="status">
          <div className="gen-status">
            <span className="gen-stage">Waiting its turn…</span>
          </div>
        </div>
      )}

      {/* The repair bar: failure sentence, version stepper, repair actions —
          visible and labelled, never hover-only (the 5b rule). */}
      {panel && (hasArt || failed || idle) && (
        <div className="panel-bar">
          {failed && hasArt && <span className="panel-bar-note">{label}</span>}
          <div className="panel-bar-actions">
            {versions.length >= 2 && (
              <div className="stepper" role="group" aria-label={`Panel ${n} versions`}>
                <button
                  type="button"
                  className="stepper-btn"
                  disabled={cv === 0}
                  title={cv === 0 ? 'This is the oldest version the desk kept.' : 'Show the previous version'}
                  onClick={() => onPanelEdit(panel.index, { version: cv - 1 })}
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
                  onClick={() => onPanelEdit(panel.index, { version: cv + 1 })}
                >
                  ›
                </button>
              </div>
            )}
            {idle ? (
              <button
                type="button"
                className="btn btn-panel"
                disabled={busy !== null}
                title="Draw this panel from the same locked sheet."
                onClick={() => onRedraw(panel.index)}
              >
                {busy === 'redraw' ? 'Queuing…' : 'Draw panel'}
              </button>
            ) : panel.status === 'refused' && !inking ? (
              <button
                type="button"
                className="btn btn-panel"
                disabled={busy !== null}
                title="Claude rephrases only this panel’s action, camera and background — never the dialogue, never the DNA — then redraws."
                onClick={() => onRewrite(panel.index)}
              >
                {busy === 'rewrite' ? 'Rewriting…' : 'Rewrite panel'}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-panel"
                disabled={inking || busy !== null}
                title={
                  inking
                    ? 'This panel is inking right now.'
                    : failed
                      ? 'Rerun the same request — same locked sheet, same DNA.'
                      : 'Draw this panel again from the same locked sheet. The current art stays until the new one lands.'
                }
                onClick={() => onRedraw(panel.index)}
              >
                {busy === 'redraw' ? 'Queuing…' : failed ? 'Try again' : 'Redraw panel'}
              </button>
            )}
          </div>
        </div>
      )}

      <span className="panel-num" aria-hidden="true">
        {n}
      </span>
      <figcaption className="sr-only">
        Panel {n}
        {character ? `, ${character.name}` : ''}, {slot.shot}. {panel ? label || 'Inked.' : label}
      </figcaption>
    </figure>
  )
}
