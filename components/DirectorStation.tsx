'use client'

// Station 3 — the Director (slice 11). Before a plan: what the Director will
// plan from (the saved scenario — its length, whether it will be summarized,
// the ticked references — or the accepted synopsis), the two locked
// characters, a page-count stepper and the estimate for the whole chapter,
// shown before anything is generated; then "Write the chapter plan", one text
// call. With a plan: the count stepper and the live estimate, Generate all,
// Ask the Director again (only while no page is written), the cover card, and
// one card per page with every line editable until that page is written.
// Implements `devpost/prd.md > The Director — Chapter Plan and Cover`; see
// `devpost/spec.md > The Director (v2)`.
import { useState } from 'react'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { CoverCard } from '@/components/CoverCard'
import { GenerationStatus } from '@/components/GenerationStatus'
import { PagePlanCard } from '@/components/PagePlanCard'
import { StationFooter } from '@/components/StationFooter'
import { estimateLine } from '@/lib/cost'
import type { Gates } from '@/lib/gates'
import type { ChapterPatch } from '@/lib/patch'
import { pagesComplete, type PlanLineEdit } from '@/lib/plan'
import { PAGE_COUNT_DEFAULT, PAGE_COUNT_MAX, PAGE_COUNT_MIN } from '@/lib/schemas'
import { textStages } from '@/lib/stages'
import { needsSummary } from '@/lib/story'
import type { Chapter } from '@/lib/types'

/** Which generation request is on the wire: one page, or all of them. */
export type Starting = number | 'all' | null

type Props = {
  chapter: Chapter
  gates: Gates
  planning: boolean
  planNotice: string | null
  starting: Starting
  startNotice: string | null
  coverBusy: boolean
  coverNotice: string | null
  onEdit: (patch: ChapterPatch) => void
  onCommit: (patch: ChapterPatch) => void
  onWritePlan: (pageCount: number, replace: boolean) => void
  onStartPage: (page: number) => void
  onStartAll: () => void
  onGenerateCover: () => void
  onGoPage: () => void
}

export function DirectorStation(props: Props) {
  const { chapter, gates, planning, planNotice } = props
  const plan = chapter.plan
  const legacy = !plan && chapter.pages.some((p) => p.written)

  return (
    <main className="station">
      <div className="station-inner is-wide">
        <div className="station-head">
          <div className="eyebrow">Station 3 · The chapter plan</div>
          <h1 className="station-title">The Director</h1>
          <p className="station-lede">
            {plan
              ? 'Every page of the chapter, four shots each, and its cover. Edit any line before its page is drawn; nothing is generated until you say so.'
              : 'The Director reads the story, the locked cast and the style, and plans the chapter: every page’s four shots and a cover brief. One text call — no image is drawn until you generate a page.'}
          </p>
        </div>

        {legacy ? (
          <p className="notice">
            This project’s page was scripted before the Director existed, so it has no chapter plan. A chapter plan
            needs a new project — this one stays as it is, and its page is still on the Page station.
          </p>
        ) : planning ? (
          <div className="sketch director-loading" aria-busy="true">
            <GenerationStatus
              stages={textStages(
                chapter.storyMode === 'scenario' && needsSummary(chapter.scenario?.text ?? '')
                  ? 'The Director is summarizing the scenario first…'
                  : 'The Director is reading the story…'
              )}
            />
          </div>
        ) : plan ? (
          <PlanDesk {...props} />
        ) : (
          <BeforePlan chapter={chapter} notice={planNotice} onWritePlan={props.onWritePlan} />
        )}

        <StationFooter
          gate={gates.storyboard}
          label="Next: Page"
          ready="The plan is written — the page station is open."
          progress={plan ? `${pagesComplete(chapter)} of ${chapter.pages.length} pages complete` : undefined}
          onGo={props.onGoPage}
        />
      </div>
    </main>
  )
}

/** What the Director will read, who it will cast, and what the chapter will cost — before anything is spent. */
function BeforePlan({
  chapter,
  notice,
  onWritePlan,
}: {
  chapter: Chapter
  notice: string | null
  onWritePlan: (pageCount: number, replace: boolean) => void
}) {
  const [pageCount, setPageCount] = useState(PAGE_COUNT_DEFAULT)
  const scenario = chapter.storyMode === 'scenario' ? chapter.scenario : null
  const refs = scenario
    ? chapter.assets.filter((a) => scenario.referenceAssetIds.includes(a.id)).map((a) => a.name)
    : []
  const length = scenario?.text.trim().length ?? 0

  return (
    <>
      <div className="plan-from">
        <section className="card plan-source">
          <div className="eyebrow eyebrow-sm">The Director plans from</div>
          {scenario ? (
            <>
              <h2 className="plan-source-title">Your scenario</h2>
              <p className="plan-source-text">{scenario.text.trim().slice(0, 280)}{length > 280 ? '…' : ''}</p>
              <p className="helper">
                {length.toLocaleString('en-US')} characters ·{' '}
                {needsSummary(scenario.text)
                  ? 'long, so the Director summarizes it first and plans from the summary'
                  : 'read whole'}
                {scenario.notes.trim() ? ' · with your notes' : ''}
              </p>
              <p className="helper">
                {refs.length === 0 ? 'No references ticked.' : `References: ${refs.join(', ')}.`}
              </p>
            </>
          ) : (
            <>
              <h2 className="plan-source-title">{chapter.synopsis?.title ?? 'The synopsis'}</h2>
              <p className="plan-source-text">{chapter.synopsis?.body}</p>
              <p className="helper">The accepted synopsis.</p>
            </>
          )}
        </section>

        <section className="card plan-cast">
          <div className="eyebrow eyebrow-sm">The locked cast · one per shot, alternating</div>
          <div className="plan-cast-row">
            {chapter.cast.map((c) => (
              <figure key={c.id} className="plan-cast-member">
                {c.sheetImageId && (
                  // eslint-disable-next-line @next/next/no-img-element -- the locked sheet, served by id
                  <img src={`/api/image/${c.sheetImageId}`} alt={`${c.name}’s locked sheet`} />
                )}
                <figcaption>
                  <span className="library-name">{c.name}</span>
                  <span className="library-role">{c.role}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      </div>

      <div className="plan-bar card">
        <PageCountStepper value={pageCount} onChange={setPageCount} />
        <p className="estimate">{estimateLine(pageCount, chapter.panelQuality)}</p>
        <button type="button" className="btn btn-primary btn-lg" onClick={() => onWritePlan(pageCount, false)}>
          Write the chapter plan
        </button>
      </div>

      {notice && (
        <div className="notice cast-notice" role="alert">
          <span>{notice}</span>
          <button type="button" className="btn btn-secondary" onClick={() => onWritePlan(pageCount, false)}>
            Try again
          </button>
        </div>
      )}
    </>
  )
}

/** The written plan: its bar, the cover, and one card per page. */
function PlanDesk({
  chapter,
  planNotice,
  starting,
  startNotice,
  coverBusy,
  coverNotice,
  onEdit,
  onCommit,
  onWritePlan,
  onStartPage,
  onStartAll,
  onGenerateCover,
}: Props) {
  const plan = chapter.plan!
  const [confirming, setConfirming] = useState(false)
  const anyWritten = chapter.pages.some((p) => p.written)
  const count = plan.pages.length
  // The last page can be dropped only while it isn't on the board.
  const lastWritten = chapter.pages[count - 1]?.written === true
  // Nothing left for Generate all: every page written and every panel inked or on its way.
  const nothingLeft = chapter.pages.every((p) => p.written && p.blank === 0)
  const busy = starting !== null
  const openPanels = chapter.script

  const onLine = (page: number, panel: number, e: PlanLineEdit) =>
    onEdit({ plan: { pages: { [page]: { [panel]: e } } } })

  return (
    <>
      <div className="plan-bar card">
        <PageCountStepper
          value={count}
          onChange={(n) => onCommit({ plan: { pageCount: n } })}
          minusBlocked={lastWritten ? `Page ${count} is already on the board, so the plan can’t drop it.` : null}
        />
        <p className="estimate">{estimateLine(count, chapter.panelQuality)}</p>
        <div className="plan-bar-actions">
          {!anyWritten && (
            <button type="button" className="btn btn-secondary" onClick={() => setConfirming(true)}>
              Ask the Director again…
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary btn-lg"
            disabled={busy || nothingLeft}
            title={
              nothingLeft
                ? 'Every page is written and every panel is inked or on its way.'
                : 'Writes every page not yet on the board from the plan, then inks every blank panel, page by page.'
            }
            onClick={onStartAll}
          >
            {starting === 'all' ? 'Starting…' : 'Generate all'}
          </button>
        </div>
      </div>

      {plan.summarized && (
        <p className="helper plan-summarized">
          The scenario was long, so the Director planned from a summary of it.
        </p>
      )}
      {planNotice && (
        <p className="notice" role="alert">
          {planNotice}
        </p>
      )}
      {startNotice && (
        <p className="notice" role="alert">
          {startNotice}
        </p>
      )}

      <div className="director-grid">
        <div className="plan-pages">
          {plan.pages.map((page, p) => (
            <PagePlanCard
              key={p}
              index={p}
              page={page}
              summary={chapter.pages.find((s) => s.index === p)}
              cast={chapter.cast}
              panelQuality={chapter.panelQuality}
              openPanels={p === chapter.address.pageIndex ? openPanels : null}
              starting={starting === p}
              locked={busy}
              onLine={onLine}
              onGenerate={onStartPage}
              onOpen={(n) => onCommit({ page: n, station: 'storyboard' })}
            />
          ))}
        </div>
        <aside className="director-cover">
          {chapter.cover && (
            <CoverCard
              cover={chapter.cover}
              panelQuality={chapter.panelQuality}
              busy={coverBusy}
              notice={coverNotice}
              onEdit={onEdit}
              onCommit={onCommit}
              onGenerate={onGenerateCover}
            />
          )}
        </aside>
      </div>

      {confirming && (
        <ConfirmDialog
          title="Ask the Director again?"
          body="The Director writes a new plan from the same story and cast. Every line on every page and the cover brief are replaced — your edits to them too. The cover’s title and any cover art stay."
          confirmLabel="Write a new plan"
          cancelLabel="Keep this plan"
          onConfirm={() => {
            setConfirming(false)
            onWritePlan(count, true)
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  )
}

/** "Pages: ‹ 3 ›" — within the allowed range, every step a labelled button. */
function PageCountStepper({
  value,
  onChange,
  minusBlocked = null,
}: {
  value: number
  onChange: (n: number) => void
  minusBlocked?: string | null
}) {
  const atMin = value <= PAGE_COUNT_MIN
  const atMax = value >= PAGE_COUNT_MAX
  return (
    <div className="count-stepper" role="group" aria-label="Pages in the chapter">
      <span className="field-label">Pages</span>
      <button
        type="button"
        className="stepper-btn"
        disabled={atMin || minusBlocked !== null}
        title={atMin ? `A chapter has at least ${PAGE_COUNT_MIN} pages.` : (minusBlocked ?? 'One page fewer')}
        aria-label="One page fewer"
        onClick={() => onChange(value - 1)}
      >
        −
      </button>
      <span className="count-stepper-value">{value}</span>
      <button
        type="button"
        className="stepper-btn"
        disabled={atMax}
        title={atMax ? `A chapter has at most ${PAGE_COUNT_MAX} pages.` : 'One page more — it arrives blank for you to write'}
        aria-label="One page more"
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </div>
  )
}
