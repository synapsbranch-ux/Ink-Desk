'use client'

// The studio: the rail plus whichever station is open. React holds a copy of
// the chapter for rendering; `data/chapter.json` is the truth, reached only
// through the route handlers. See `devpost/spec.md > Data Model`.
import { useCallback, useEffect, useRef, useState } from 'react'
import { StationRail, type SaveState } from '@/components/StationRail'
import { StoryStation } from '@/components/StoryStation'
import { gates } from '@/lib/gates'
import { applyPatch, mergePatch, type ChapterPatch } from '@/lib/patch'
import type { Chapter, Station } from '@/lib/types'

const SAVE_DELAY_MS = 600

async function postJson<T>(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { ok: res.ok, status: res.status, data: (await res.json()) as T }
}

export default function Studio() {
  const [chapter, setChapter] = useState<Chapter | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  // Edits still waiting to be saved, merged across keystrokes.
  const queued = useRef<ChapterPatch>({})
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    fetch('/api/chapter')
      .then((r) => r.json())
      .then((c: Chapter) => setChapter(c))
      .catch(() => setNotice('The desk couldn’t be opened. Is the dev server running?'))
  }, [])

  const send = useCallback(async (patch: ChapterPatch) => {
    setSaveState('saving')
    try {
      const { ok, data } = await postJson<Chapter | { error: string }>('/api/chapter', patch)
      if (!ok || !('version' in data)) throw new Error('error' in data ? data.error : 'save failed')
      // Whatever was typed while this was in flight stays on top of the saved copy.
      setChapter(applyPatch(data, queued.current))
      setSaveState('saved')
    } catch {
      setSaveState('error')
    }
  }, [])

  /** Typing: apply locally now, save after a pause. The label says
   *  "Saving…" from the first keystroke, so it never claims a save that
   *  hasn't happened yet. */
  const edit = useCallback(
    (patch: ChapterPatch) => {
      setChapter((c) => (c ? applyPatch(c, patch) : c))
      setSaveState('saving')
      queued.current = mergePatch(queued.current, patch)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        timer.current = null
        const p = queued.current
        queued.current = {}
        void send(p)
      }, SAVE_DELAY_MS)
    },
    [send]
  )

  /** Clicks: flush anything queued and save now. */
  const commit = useCallback(
    (patch: ChapterPatch) => {
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = null
      }
      const p = mergePatch(queued.current, patch)
      queued.current = {}
      setChapter((c) => (c ? applyPatch(c, patch) : c))
      void send(p)
    },
    [send]
  )

  const goTo = useCallback((station: Station) => commit({ station }), [commit])

  const pitch = useCallback(async () => {
    if (!chapter) return
    setPending(true)
    setNotice(null)
    try {
      const { ok, data } = await postJson<Chapter | { error: string }>('/api/synopsis', {
        pitch: chapter.pitch.text,
        genre: chapter.pitch.genre,
        tone: chapter.pitch.tone,
      })
      if (!ok || !('version' in data)) {
        setNotice('error' in data ? data.error : 'The studio couldn’t write a synopsis just now.')
        return
      }
      setChapter(data)
      setSaveState('saved')
    } catch {
      setNotice('The studio couldn’t be reached. Is the dev server running?')
    } finally {
      setPending(false)
    }
  }, [chapter])

  if (!chapter) {
    return (
      <div className="studio">
        <div className="studio-opening">{notice ?? 'Opening the desk…'}</div>
      </div>
    )
  }

  const g = gates(chapter)

  return (
    <div className="studio">
      <StationRail chapter={chapter} gates={g} saveState={saveState} onGo={goTo} />
      {chapter.station === 'story' ? (
        <StoryStation
          chapter={chapter}
          pending={pending}
          notice={notice}
          onEdit={edit}
          onCommit={commit}
          onPitch={pitch}
          onGoCast={() => goTo('cast')}
        />
      ) : (
        <ComingNext station={chapter.station} />
      )}
    </div>
  )
}

/** Stations not built yet. Replaced slice by slice. */
function ComingNext({ station }: { station: Station }) {
  const copy: Record<Exclude<Station, 'story'>, [string, string, string]> = {
    cast: ['Station 2 · Model sheets', 'The cast', 'Two characters, two locked sheets. Built next.'],
    storyboard: ['Station 3 · The main studio', 'The storyboard', 'Four panels against the locks. Built after Cast.'],
    reader: ['Station 4 · The reader', 'Ink & Publish', 'The finished page. Built last.'],
  }
  const [eyebrow, title, lede] = copy[station as Exclude<Station, 'story'>]
  return (
    <main className="station">
      <div className="station-inner">
        <div className="station-head">
          <div className="eyebrow">{eyebrow}</div>
          <h1 className="station-title">{title}</h1>
          <p className="station-lede">{lede}</p>
        </div>
      </div>
    </main>
  )
}
