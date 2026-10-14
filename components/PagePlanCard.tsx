'use client'

// One page of the chapter plan in the Director (slice 11): "Page n", its
// status, a pencil mini-page in the four-shot layout (wide / square / square /
// wide — the art itself once the page has inked), and per slot who is in it,
// the slot's shot, and the four lines — action, camera, background, dialogue —
// editable until the page is written. A blank line says what it needs before
// anything is drawn. A written page shows its lines read-only with "Open page
// n"; an unwritten one offers "Generate page n" with its own estimate.
// Implements `devpost/prd.md > The Director — Chapter Plan and Cover`.
import { pageStatus } from '@/components/PageSwitcher'
import { pageJobCount } from '@/lib/activity'
import { estimatePageUsd, usd } from '@/lib/cost'
import { assertPageDrawable, type PlanLineEdit } from '@/lib/plan'
import { PANEL_LAYOUT, type PanelSlot } from '@/lib/prompts'
import type { Activity } from '@/lib/queue/jobs'
import { currentImageId } from '@/lib/script'
import type { Character, PageSummary, Panel, PlanPage } from '@/lib/types'

type Field = keyof PlanLineEdit

const FIELDS: readonly { field: Field; label: string; needs: string; rows?: number }[] = [
  { field: 'action', label: 'Action', needs: 'needs an action', rows: 2 },
  { field: 'camera', label: 'Camera', needs: 'needs a camera' },
  { field: 'background', label: 'Background', needs: 'needs a background' },
  { field: 'dialogue', label: 'Dialogue', needs: 'needs a line of dialogue' },
]

type Props = {
  index: number
  page: PlanPage
  summary: PageSummary | undefined
  cast: Character[]
  panelQuality: string
  /** What the queue is doing, for the page's status (slice 18). */
  activity: Activity | undefined
  /** This page's panels, when it is the open page — the real art for the mini-page. */
  openPanels: Panel[] | null
  /** Generate page n is on the wire for this page. */
  starting: boolean
  /** Another generation request is on the wire. */
  locked: boolean
  onLine: (page: number, panel: number, edit: PlanLineEdit) => void
  onGenerate: (page: number) => void
  onOpen: (page: number) => void
}

export function PagePlanCard({
  index,
  page,
  summary,
  cast,
  panelQuality,
  activity,
  openPanels,
  starting,
  locked,
  onLine,
  onGenerate,
  onOpen,
}: Props) {
  const n = index + 1
  const written = summary?.written === true
  const status = pageStatus(summary, pageJobCount(activity, index))
  const blank = written ? null : assertPageDrawable(page, index)
  // Once written, the panels are the truth; the open page shows them, the others the plan's lines.
  const lines = written && openPanels ? openPanels : page.panels

  return (
    <article className={`card plan-page is-${status.tone}`} data-plan-page={index}>
      <header className="plan-page-head">
        <h3 className="plan-page-title">Page {n}</h3>
        <span className={`plan-page-status is-${status.tone}`}>{status.label}</span>
        <span className="header-spacer" />
        {written ? (
          <button type="button" className="btn btn-secondary" onClick={() => onOpen(index)}>
            Open page {n} →
          </button>
        ) : (
          <>
            <span className="plan-page-estimate" title="Four panels at the configured quality — an estimate">
              ≈ {usd(estimatePageUsd(panelQuality))} · 4 images
            </span>
            <button
              type="button"
              className="btn btn-primary"
              disabled={blank !== null || starting || locked}
              title={blank ?? 'Writes this page’s four panels from the plan and starts inking them, two at a time.'}
              onClick={() => onGenerate(index)}
            >
              {starting ? 'Starting…' : `Generate page ${n}`}
            </button>
          </>
        )}
      </header>
      {blank && <p className="plan-page-blank">{blank}</p>}

      <div className="plan-page-body">
        <MiniPage summary={summary} openPanels={openPanels} cast={cast} lines={page.panels} />

        <div className="plan-slots">
          {PANEL_LAYOUT.map((slot) => {
            const line = lines[slot.index]
            if (!line) return null
            const who = cast.find((c) => c.id === line.characterId)
            return (
              <section key={slot.index} className="plan-slot" aria-label={`Page ${n}, panel ${slot.index + 1}`}>
                <div className="eyebrow eyebrow-sm plan-slot-head">
                  Panel {slot.index + 1} · {who?.name ?? 'Unknown'} · {slot.shot}
                </div>
                {written ? (
                  <>
                    <p className="script-action">{line.action}</p>
                    <p className="script-line">Camera: {line.camera}</p>
                    <p className="script-line">Background: {line.background}</p>
                    <p className="script-dialogue">“{line.dialogue}”</p>
                  </>
                ) : (
                  FIELDS.map(({ field, label, needs, rows }) => {
                    const value = line[field]
                    const empty = value.trim() === ''
                    const common = {
                      className: `plan-input${field === 'dialogue' ? ' is-dialogue' : ''}${empty ? ' is-blank' : ''}`,
                      value,
                      placeholder: needs,
                      'aria-label': `Page ${n}, panel ${slot.index + 1}: ${label}`,
                      onChange: (e: { target: { value: string } }) =>
                        onLine(index, slot.index, { [field]: e.target.value }),
                    }
                    return (
                      <label key={field} className="plan-field">
                        <span className="plan-field-label">{label}</span>
                        {rows ? <textarea rows={rows} {...common} /> : <input {...common} />}
                      </label>
                    )
                  })
                )}
              </section>
            )
          })}
        </div>
      </div>
    </article>
  )
}

/** The four-shot page in miniature: pencil for every slot, art where it exists. */
function MiniPage({
  summary,
  openPanels,
  cast,
  lines,
}: {
  summary: PageSummary | undefined
  openPanels: Panel[] | null
  cast: Character[]
  lines: PlanPage['panels']
}) {
  const art = (slot: PanelSlot): string | null => {
    const panel = openPanels?.[slot.index]
    if (panel) return currentImageId(panel)
    // Away from the open page, the page summary carries each slot's current art.
    return summary?.panelImageIds[slot.index] ?? null
  }
  return (
    <div className="mini-page" aria-hidden="true">
      {PANEL_LAYOUT.map((slot) => {
        const imageId = art(slot)
        const who = cast.find((c) => c.id === lines[slot.index]?.characterId)
        return (
          <div key={slot.index} className={`mini-panel panel-${slot.shape}${imageId ? ' is-inked' : ''}`}>
            {imageId ? (
              // eslint-disable-next-line @next/next/no-img-element -- generated art, served by id
              <img src={`/api/image/${imageId}`} alt="" />
            ) : (
              <svg className={`pencil-figure is-${slot.stance}`} viewBox="0 0 100 100" preserveAspectRatio="xMidYMax meet">
                <circle cx="50" cy="24" r="15" />
                <path d="M12 100 C12 70 28 56 50 56 C72 56 88 70 88 100" />
              </svg>
            )}
            <span className="mini-num">{slot.index + 1}</span>
            {!imageId && who && <span className="mini-who">{who.name.split(' ')[0]}</span>}
          </div>
        )
      })}
    </div>
  )
}
