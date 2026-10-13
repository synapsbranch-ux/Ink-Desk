// Claude's four-panel breakdown, as a visible step beside the page rather
// than its own station: per panel, who, the action, the camera, the
// background and the line. Display only — dialogue editing is deferred.
// Since slice 11 a page not yet generated shows the chapter plan's lines for
// it, read-only here (they are edited in the Director), with "Generate page
// n", its estimate, and the sentence for a line that still needs words.
// Implements `devpost/prd.md > Page Script` and `> Pages — Generation,
// Lettering, Repair`.
import { GenerationStatus } from '@/components/GenerationStatus'
import { estimatePageUsd, usd } from '@/lib/cost'
import { assertPageDrawable } from '@/lib/plan'
import { PANEL_LAYOUT } from '@/lib/prompts'
import { textStages } from '@/lib/stages'
import type { Chapter, PanelStatus } from '@/lib/types'

const STATUS: Record<PanelStatus, string> = {
  empty: 'Pencilling',
  inking: 'Inking…',
  done: 'Inked',
  failed: 'Didn’t come back',
  refused: 'Couldn’t be drawn',
}

type Props = {
  chapter: Chapter
  writing: boolean
  notice: string | null
  onRetry: () => void
  /** Generate page n is on the wire. */
  starting: boolean
  startNotice: string | null
  onGeneratePage: () => void
}

export function PageScript({ chapter, writing, notice, onRetry, starting, startNotice, onGeneratePage }: Props) {
  const script = chapter.script
  const n = chapter.address.pageIndex + 1
  const planned = !script ? chapter.plan?.pages[chapter.address.pageIndex] : undefined

  if (planned) {
    const blank = assertPageDrawable(planned, chapter.address.pageIndex)
    return (
      <aside className="script" aria-label="Page plan">
        <div className="eyebrow eyebrow-sm">Page {n} · from the chapter plan — not generated yet</div>
        <div className="script-generate">
          <button
            type="button"
            className="btn btn-primary btn-lg"
            disabled={blank !== null || starting}
            title={blank ?? 'Writes the four panels from these lines and starts inking them, two at a time.'}
            onClick={onGeneratePage}
          >
            {starting ? 'Starting…' : `Generate page ${n}`}
          </button>
          <span className="helper">
            Estimate: ≈ {usd(estimatePageUsd(chapter.panelQuality))} · 4 images at {chapter.panelQuality}
          </span>
        </div>
        {blank && <p className="plan-page-blank">{blank} Write it in the Director.</p>}
        {startNotice && (
          <p className="notice" role="alert">
            {startNotice}
          </p>
        )}
        {planned.panels.map((line, i) => {
          const who = chapter.cast.find((c) => c.id === line.characterId)
          return (
            <article key={i} className="script-panel is-planned">
              <div className="script-panel-head">
                <span className="eyebrow eyebrow-sm">
                  Panel {i + 1} · {who?.name ?? 'Unknown'} · {PANEL_LAYOUT[i].shot}
                </span>
                <span className="script-status">Planned</span>
              </div>
              <p className="script-action">{line.action || '—'}</p>
              <p className="script-line">Camera: {line.camera || '—'}</p>
              <p className="script-line">Background: {line.background || '—'}</p>
              <p className="script-dialogue">{line.dialogue ? `“${line.dialogue}”` : '—'}</p>
            </article>
          )
        })}
      </aside>
    )
  }

  return (
    <aside className="script" aria-label="Page script">
      <div className="eyebrow eyebrow-sm">
        {chapter.plan ? `Page ${n} · written from the chapter plan` : 'Page script · written by Claude from the locked cast'}
      </div>

      {writing ? (
        <div className="sketch script-loading" aria-busy="true">
          <GenerationStatus stages={textStages('Claude is writing the page…')} />
        </div>
      ) : !script ? (
        <div className="notice cast-notice" role="alert">
          <span>{notice ?? 'No page script yet.'}</span>
          <button type="button" className="btn btn-secondary" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : (
        script.map((p) => {
          const who = chapter.cast.find((c) => c.id === p.characterId)
          const slot = PANEL_LAYOUT[p.index]
          return (
            <article key={p.index} className={`script-panel is-${p.status}`} data-script-panel={p.index}>
              <div className="script-panel-head">
                <span className="eyebrow eyebrow-sm">
                  Panel {p.index + 1} · {who?.name ?? 'Unknown'} · {slot.shot}
                </span>
                <span className={`script-status is-${p.status}`}>{STATUS[p.status]}</span>
              </div>
              <p className="script-action">{p.action}</p>
              <p className="script-line">Camera: {p.camera}</p>
              <p className="script-line">Background: {p.background}</p>
              <p className="script-dialogue">“{p.dialogue}”</p>
            </article>
          )
        })
      )}
    </aside>
  )
}
