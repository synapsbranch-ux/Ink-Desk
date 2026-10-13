'use client'

// Station 4 — the page (v2): the v1 storyboard, one page of the chapter at a
// time, with the page switcher above it. A page generated from the plan has
// its four panels; its blank ones are queued on arrival (idempotent, so a
// reload resumes) and ink in out of order while the studio polls the desk.
// A page not yet generated shows its four pencil placeholders, the plan's
// lines beside them and "Generate page n". Only a legacy desk with neither a
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
import type { Gates } from '@/lib/gates'
import type { PanelEdit } from '@/lib/patch'
import { pagesComplete } from '@/lib/plan'
import { PANEL_LAYOUT } from '@/lib/prompts'
import type { Chapter } from '@/lib/types'

type Props = {
  chapter: Chapter
  gates: Gates
  scripting: boolean
  scriptNotice: string | null
  onWriteScript: () => void
  onStartPanels: () => void
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
  onWriteScript,
  onStartPanels,
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
  const blank = script?.some((p) => p.status === 'empty') ?? false
  const n = chapter.address.pageIndex + 1

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

  // Then queue whatever is blank. The server skips a panel already queued,
  // so arriving here again mid-page — after a reload — is safe.
  const started = useRef(false)
  useEffect(() => {
    if (script && blank && !started.current) {
      started.current = true
      onStartPanels()
    }
  }, [script, blank, onStartPanels])

  const inked = script?.filter((p) => p.versions.length > 0).length ?? 0
  const inkingNow = script?.filter((p) => p.status === 'inking').length ?? 0
  const chapterLine = plan ? ` · ${pagesComplete(chapter)} of ${chapter.pages.length} pages complete` : ''
  const progressLine = !script
    ? `Page ${n} · ${plan ? 'not generated yet' : 'waiting for the script'}${chapterLine}`
    : `Page ${n} · ${inked} of 4 panels inked${inkingNow > 0 ? ` · ${inkingNow} inking now` : ''}${chapterLine}`

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

        {chapter.pages.length > 1 && <PageSwitcher pages={chapter.pages} open={chapter.openPage} onPick={onPickPage} />}

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
