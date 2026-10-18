'use client'

// One page of the chapter plan in the Director (slice 11): "Page n", its
// status, a pencil mini-page in the four-shot layout (wide / square / square /
// wide — the art itself once the page has inked), and per slot who is in it,
// the slot's shot, and the four lines — action, camera, background, dialogue —
// editable until the page is written. A blank line says what it needs before
// anything is drawn. A written page shows its lines read-only with "Open page
// n"; an unwritten one offers "Generate page n" with its own estimate.
// Slice 20: an unwritten page says what it takes of today's images ("Uses 4 of
// your 20 images today") and its button is shut — with the reason and the
// reset time under the header — when it cannot be drawn.
// Slice 23: on a phone the card is an accordion — the head, its action and
// a "Show the four shots" toggle; the mini-page and the lines open under it.
// On wider screens the body is always open and the toggle is not shown.
// Implements `devpost/prd.md > The Director — Chapter Plan and Cover`.
import { useState } from 'react'
import { pageStatus } from '@/components/PageSwitcher'
import { useImageUrl } from '@/components/project-image'
import { SpendNote } from '@/components/SpendNote'
import { pageJobCount } from '@/lib/activity'
import { estimatePageUsd, PANELS_PER_PAGE, usd } from '@/lib/cost'
import { usesLine } from '@/lib/limits/button'
import { useUsage, useSpend } from '@/lib/limits/use-usage'
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
  /** Open on a phone at first (the next page to write); elsewhere the body is always open. */
  defaultOpen?: boolean
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
  defaultOpen = false,
  onLine,
  onGenerate,
  onOpen,
}: Props) {
  const n = index + 1
  const [open, setOpen] = useState(defaultOpen)
  const bodyId = `plan-page-${index}-body`
  const written = summary?.written === true
  const spend = useSpend({ images: PANELS_PER_PAGE })
  const { usage } = useUsage()
  const status = pageStatus(summary, pageJobCount(activity, index))
  const blank = written ? null : assertPageDrawable(page, index)
  // Once written, the panels are the truth; the open page shows them, the others the plan's lines.
  const lines = written && openPanels ? openPanels : page.panels

  return (
    <article className={`card plan-page is-${status.tone}${open ? ' is-open' : ''}`} data-plan-page={index}>
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
              disabled={blank !== null || starting || locked || spend.blocked}
              aria-describedby={spend.blocked ? `page-${index}-reason` : undefined}
              title={
                blank ??
                (spend.blocked
                  ? (spend.reason ?? undefined)
                  : 'Writes this page’s four panels from the plan and starts inking them, two at a time.')
              }
              onClick={() => onGenerate(index)}
            >
              {starting ? 'Starting…' : `Generate page ${n}`}
            </button>
          </>
        )}
      </header>
      {blank && <p className="plan-page-blank">{blank}</p>}
      {!written && !blank && <SpendNote spend={spend} id={`page-${index}-reason`} />}
      {!written && !blank && !spend.blocked && usesLine(usage, PANELS_PER_PAGE) && (
        <p className="spend-line">{usesLine(usage, PANELS_PER_PAGE)}</p>
      )}

      <button
        type="button"
        className="plan-page-toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? `Hide page ${n}’s shots` : `Show page ${n}’s four shots`}
      </button>

      <div className="plan-page-body" id={bodyId}>
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
  const imageSrc = useImageUrl()
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
              <img src={imageSrc(imageId)} alt="" />
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
