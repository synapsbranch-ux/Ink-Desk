// Claude's four-panel breakdown, as a visible step beside the page rather
// than its own station: per panel, who, the action, the camera, the
// background and the line. Display only — dialogue editing is deferred.
// Implements `devpost/prd.md > Page Script`.
import { PANEL_LAYOUT } from '@/lib/prompts'
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
}

export function PageScript({ chapter, writing, notice, onRetry }: Props) {
  const script = chapter.script

  return (
    <aside className="script" aria-label="Page script">
      <div className="eyebrow eyebrow-sm">Page script · written by Claude from the locked cast</div>

      {writing ? (
        <div className="sketch script-loading" aria-busy="true">
          <span className="sketch-label">Claude is writing the page…</span>
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
