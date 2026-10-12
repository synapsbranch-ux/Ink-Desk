'use client'

// Station 3 — the main studio. The page script is written on arrival, once;
// the four blank panels are queued; and the page inks in out of order while
// the studio polls the desk. Implements `devpost/prd.md > Storyboard — The
// Main Studio` and `> Page Script`; see `devpost/spec.md > Components >
// Storyboard Station and Panel`.
import { useEffect, useRef } from 'react'
import { PageScript } from '@/components/PageScript'
import { Panel } from '@/components/Panel'
import type { Gates } from '@/lib/gates'
import { PANEL_LAYOUT } from '@/lib/prompts'
import type { Chapter } from '@/lib/types'

type Props = {
  chapter: Chapter
  gates: Gates
  scripting: boolean
  scriptNotice: string | null
  onWriteScript: () => void
  onStartPanels: () => void
  onGoReader: () => void
}

export function StoryboardStation({
  chapter,
  gates,
  scripting,
  scriptNotice,
  onWriteScript,
  onStartPanels,
  onGoReader,
}: Props) {
  const script = chapter.script
  const blank = script?.some((p) => p.status === 'empty') ?? false

  // Storyboard opens with no script exactly once per chapter: ask Claude on
  // arrival. A failure shows a sentence and a button rather than asking
  // again on its own, so a missing key can't loop.
  const asked = useRef(false)
  useEffect(() => {
    if (!script && !scripting && !scriptNotice && !asked.current) {
      asked.current = true
      onWriteScript()
    }
  }, [script, scripting, scriptNotice, onWriteScript])

  // Then queue whatever is blank. The server skips a panel already queued,
  // so arriving here again mid-page — after a reload — is safe.
  const started = useRef(false)
  useEffect(() => {
    if (script && blank && !started.current) {
      started.current = true
      onStartPanels()
    }
  }, [script, blank, onStartPanels])

  const reader = gates.reader
  const inked = script?.filter((p) => p.versions.length > 0).length ?? 0

  return (
    <main className="station">
      <div className="station-inner is-wide">
        <div className="station-head station-head-row">
          <div className="station-head-text">
            <div className="eyebrow">Station 3 · The main studio</div>
            <h1 className="station-title">The storyboard</h1>
            <p className="station-lede">
              Claude writes the page from the locked cast, then each panel is drawn against one locked sheet and its
              DNA — nothing else. As the panels ink in, compare every face to its sheet.
            </p>
          </div>
          <div className="station-next">
            <button
              type="button"
              className="btn btn-primary btn-lg"
              onClick={onGoReader}
              disabled={!reader.open}
              title={reader.open ? undefined : (reader.hint ?? undefined)}
            >
              Next: Ink &amp; Publish →
            </button>
            <span className="helper">
              {reader.open
                ? 'All four panels have art.'
                : script
                  ? `${inked} of 4 inked. ${reader.hint ?? ''}`
                  : (reader.hint ?? '')}
            </span>
          </div>
        </div>

        <div className="board">
          <section className="page" aria-label="The page">
            {PANEL_LAYOUT.map((slot) => {
              const panel = script?.[slot.index] ?? null
              const character = panel
                ? (chapter.cast.find((c) => c.id === panel.characterId) ?? null)
                : (chapter.cast[slot.cast] ?? null)
              return <Panel key={slot.index} slot={slot} panel={panel} character={character} />
            })}
          </section>
          <PageScript chapter={chapter} writing={scripting} notice={scriptNotice} onRetry={onWriteScript} />
        </div>
      </div>
    </main>
  )
}
