'use client'

// Station 4 — the page (v2): the v1 storyboard, one page of the chapter at a
// time, with the page switcher above it. A page generated from the plan has
// its four panels; its blank ones are queued on arrival (idempotent, so a
// reload resumes) and ink in out of order while the studio polls the desk.
// A page not yet generated shows its four pencil placeholders, the plan's
// lines beside them and "Generate page n". Since slice 18 a panel is waiting
// or inking only when the desk says `inking` or a queue job targets it; a
// blank panel nothing is drawing shows as blank with its own Draw panel button
// (CR-9), and is started on arrival at most once per visit. Only a legacy desk with neither a
// plan nor a script asks Claude for a page script on arrival, as v1 did.
// The station is keyed by the open page, so every once-guard resets on a
// switch. Implements `devpost/prd.md > Storyboard — The Main Studio`,
// `> Page Script` and `> Pages — Generation, Lettering, Repair`; see
// `devpost/spec.md > Components > Storyboard Station and Panel`.
import { useEffect, useRef } from 'react'
import { PageScript } from '@/components/PageScript'
import { PageSwitcher } from '@/components/PageSwitcher'
import { Panel } from '@/components/Panel'
import { StationFooter } from '@/components/StationFooter'
import { failedPanelSentence, inFlight, isIdleBlank, panelJob } from '@/lib/activity'
import type { Gates } from '@/lib/gates'
import type { PanelEdit } from '@/lib/patch'
import { pagesComplete } from '@/lib/plan'
import { PANEL_LAYOUT } from '@/lib/prompts'
import type { Activity } from '@/lib/queue/jobs'
import type { Chapter } from '@/lib/types'

type Props = {
  chapter: Chapter
  gates: Gates
  scripting: boolean
  scriptNotice: string | null
  /** What the queue is doing (slice 18); undefined until a reply has said. */
  activity: Activity | undefined
  onWriteScript: () => void
  onStartPanels: () => void
  /** The blank panels are being queued right now. */
  panelsStarting: boolean
  /** The server's sentence for a panel request it refused. */
  panelNotice: string | null
  onPanelEdit: (index: number, edit: PanelEdit) => void
  /** A repair on the wire, keyed by panel index. */
  panelBusy: Record<number, 'redraw' | 'rewrite' | null>
  onRedraw: (index: number) => void
  onRewrite: (index: number) => void
  /** The page switcher. */
  onPickPage: (page: number) => void
  /** Generate page n, for an open page not yet written from the plan. */
  onGeneratePage: () => void
  starting: boolean
  startNotice: string | null
  onGoReader: () => void
}

export function StoryboardStation({
  chapter,
  gates,
  scripting,
  scriptNotice,
  activity,
  onWriteScript,
  onStartPanels,
  panelsStarting,
  panelNotice,
  onPanelEdit,
  panelBusy,
  onRedraw,
  onRewrite,
  onPickPage,
  onGeneratePage,
  starting,
  startNotice,
  onGoReader,
}: Props) {
  const script = chapter.script
  const plan = chapter.plan
  const pageIndex = chapter.address.pageIndex
  // The desk shows one chapter, so a job's page and slot are enough to find its panel.
  const jobOf = (index: number) => panelJob(activity, pageIndex, index)
  // Blank AND nothing drawing it: a blank panel with a job is on its way.
  const blank = script?.some((p) => isIdleBlank(p.status, jobOf(p.index))) ?? false
  const n = pageIndex + 1

  // A legacy desk — no plan and no script — asks Claude for the page script
  // once on arrival, as v1 did (the gate keeps this from happening now). A
  // failure shows a sentence and a button rather than asking again on its
  // own, so a missing key can't loop. With a plan, a page is only ever
  // written by Generate page.
  const asked = useRef(false)
  useEffect(() => {
    if (!plan && !script && !scripting && !scriptNotice && !asked.current) {
      asked.current = true
      onWriteScript()
    }
  }, [plan, script, scripting, scriptNotice, onWriteScript])

  // Then queue whatever is blank and idle. The server skips a panel already
  // queued, so arriving here again mid-page — after a reload — is safe. Once
  // per visit to the page (the station is keyed by it): if the server refuses,
  // or a job fails, the blank panels keep their Draw panel button rather than
  // being asked for again on their own, so a busy studio can't loop.
  const started = useRef(false)
  useEffect(() => {
    if (script && blank && !started.current) {
      started.current = true
      onStartPanels()
    }
  }, [script, blank, onStartPanels])

  const inked = script?.filter((p) => p.versions.length > 0).length ?? 0
  const inkingNow = script?.filter((p) => p.status === 'inking' || jobOf(p.index)?.status === 'running').length ?? 0
  const waiting = script?.filter((p) => inFlight(p.status, jobOf(p.index))).length ?? 0
  const waitingNow = Math.max(0, waiting - inkingNow)
  const chapterLine = plan ? ` · ${pagesComplete(chapter)} of ${chapter.pages.length} pages complete` : ''
  const progressLine = !script
    ? `Page ${n} · ${plan ? 'not generated yet' : 'waiting for the script'}${chapterLine}`
    : `Page ${n} · ${inked} of 4 panels inked${inkingNow > 0 ? ` · ${inkingNow} inking now` : ''}${waitingNow > 0 ? ` · ${waitingNow} waiting` : ''}${chapterLine}`

  return (
    <main className="station">
      <div className="station-inner is-wide">
        <div className="station-head">
          <div className="eyebrow">Station 4 · One page at a time</div>
          <h1 className="station-title">The page</h1>
          <p className="station-lede">
            Each panel is drawn against one locked sheet and its DNA — nothing else. As the panels ink in, compare
            every face to its sheet; letter, redraw or rewrite any panel right here.
          </p>
        </div>

        {chapter.pages.length > 1 && <PageSwitcher pages={chapter.pages} activity={activity} open={chapter.openPage} onPick={onPickPage} />}

        {panelNotice && (
          <p className="notice" role="alert">
            {panelNotice}
          </p>
        )}

        <div className="board">
          <div className="page-wrap">
            <div className="eyebrow eyebrow-sm page-progress" aria-live="polite">
              {progressLine}
            </div>
            <section className="page" aria-label="The page">
              {PANEL_LAYOUT.map((slot) => {
                const panel = script?.[slot.index] ?? null
                const character = panel
                  ? (chapter.cast.find((c) => c.id === panel.characterId) ?? null)
                  : (chapter.cast[slot.cast] ?? null)
                return (
                  <Panel
                    key={slot.index}
                    slot={slot}
                    panel={panel}
                    character={character}
                    emptyLabel={plan ? `Page ${n} isn’t generated yet` : undefined}
                    busy={panelBusy[slot.index] ?? null}
                    job={jobOf(slot.index)}
                    starting={panelsStarting}
                    lostNote={failedPanelSentence(activity, pageIndex, slot.index)}
                    onPanelEdit={onPanelEdit}
                    onRedraw={onRedraw}
                    onRewrite={onRewrite}
                  />
                )
              })}
            </section>
          </div>
          <PageScript
            chapter={chapter}
            activity={activity}
            writing={scripting}
            notice={scriptNotice}
            onRetry={onWriteScript}
            starting={starting}
            startNotice={startNotice}
            onGeneratePage={onGeneratePage}
          />
        </div>

        <StationFooter
          gate={gates.reader}
          label={'Next: Ink & Publish'}
          ready="A page is inked — the reader is open on every finished page."
          progress={script ? `${inked} of 4 panels inked` : undefined}
          onGo={onGoReader}
        />
      </div>
    </main>
  )
}
