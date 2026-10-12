'use client'

// The studio: the rail plus whichever station is open. React holds a copy of
// the chapter for rendering; `data/chapter.json` is the truth, reached only
// through the route handlers. See `devpost/spec.md > Data Model`.
import { useCallback, useEffect, useRef, useState } from 'react'
import { CastStation } from '@/components/CastStation'
import { IDLE_CARD, type CardState } from '@/components/CharacterCard'
import { StationRail, type SaveState } from '@/components/StationRail'
import { StoryStation } from '@/components/StoryStation'
import { gates } from '@/lib/gates'
import { applyPatch, mergePatch, type ChapterPatch, type CharacterEdit } from '@/lib/patch'
import type { Chapter, Station } from '@/lib/types'

const SAVE_DELAY_MS = 600
const UNREACHABLE = 'The studio couldn’t be reached. Is the dev server running?'

type Reply = Chapter | { error: string }

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: Reply }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { ok: res.ok, status: res.status, data: (await res.json()) as Reply }
}

export default function Studio() {
  const [chapter, setChapter] = useState<Chapter | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  // Cast: the first proposal in flight, and per-card activity — a reroll or
  // a draw running, and the last sentence the server sent back for that card.
  const [proposing, setProposing] = useState(false)
  const [proposeNotice, setProposeNotice] = useState<string | null>(null)
  const [cards, setCards] = useState<Record<string, CardState>>({})

  // Edits still waiting to be saved, merged across keystrokes.
  const queued = useRef<ChapterPatch>({})
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    fetch('/api/chapter')
      .then((r) => r.json())
      .then((c: Chapter) => setChapter(c))
      .catch(() => setNotice('The desk couldn’t be opened. Is the dev server running?'))
  }, [])

  /** The desk's copy, with whatever is still being typed kept on top. */
  const accept = useCallback((saved: Chapter) => {
    setChapter(applyPatch(saved, queued.current))
    setSaveState('saved')
  }, [])

  /** After a refused save, the browser's optimistic copy is wrong: re-read. */
  const refresh = useCallback(async () => {
    const res = await fetch('/api/chapter')
    if (res.ok) setChapter(applyPatch((await res.json()) as Chapter, queued.current))
  }, [])

  const send = useCallback(
    async (patch: ChapterPatch) => {
      setSaveState('saving')
      try {
        const { ok, data } = await postJson('/api/chapter', patch)
        if (!ok || !('version' in data)) throw new Error('error' in data ? data.error : 'save failed')
        // Whatever was typed while this was in flight stays on top of the saved copy.
        accept(data)
      } catch {
        setSaveState('error')
        void refresh().catch(() => {})
      }
    },
    [accept, refresh]
  )

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
      const { ok, data } = await postJson('/api/synopsis', {
        pitch: chapter.pitch.text,
        genre: chapter.pitch.genre,
        tone: chapter.pitch.tone,
      })
      if (!ok || !('version' in data)) {
        setNotice('error' in data ? data.error : 'The studio couldn’t write a synopsis just now.')
        return
      }
      accept(data)
    } catch {
      setNotice(UNREACHABLE)
    } finally {
      setPending(false)
    }
  }, [chapter, accept])

  // --- Cast ---------------------------------------------------------------

  const propose = useCallback(async () => {
    setProposing(true)
    setProposeNotice(null)
    try {
      const { ok, data } = await postJson('/api/cast', {})
      if (!ok || !('version' in data)) {
        setProposeNotice('error' in data ? data.error : 'The studio couldn’t propose a cast just now.')
        return
      }
      accept(data)
    } catch {
      setProposeNotice(UNREACHABLE)
    } finally {
      setProposing(false)
    }
  }, [accept])

  const setCard = useCallback((id: string, patch: Partial<CardState>) => {
    setCards((prev) => ({ ...prev, [id]: { ...(prev[id] ?? IDLE_CARD), ...patch } }))
  }, [])

  /** One generation request for one card: a reroll or a draw. */
  const cardRequest = useCallback(
    async (id: string, busy: CardState['busy'], url: string, body: unknown, fallback: string) => {
      setCard(id, { busy, notice: null })
      try {
        const { ok, data } = await postJson(url, body)
        if (!ok || !('version' in data)) {
          setCard(id, { notice: 'error' in data ? data.error : fallback })
          return
        }
        accept(data)
      } catch {
        setCard(id, { notice: UNREACHABLE })
      } finally {
        setCard(id, { busy: null })
      }
    },
    [accept, setCard]
  )

  const reroll = useCallback(
    (id: string) =>
      cardRequest(id, 'rerolling', '/api/cast/reroll', { id }, 'The studio couldn’t reroll that character just now.'),
    [cardRequest]
  )
  const draw = useCallback(
    (id: string, reuseDna: boolean) =>
      cardRequest(id, 'drawing', '/api/sheet', { id, reuseDna }, 'The sheet didn’t come back, the studio is busy.'),
    [cardRequest]
  )
  const editCard = useCallback((id: string, e: CharacterEdit) => edit({ cast: { [id]: e } }), [edit])
  const commitCard = useCallback((id: string, e: CharacterEdit) => commit({ cast: { [id]: e } }), [commit])
  const lock = useCallback((id: string) => commit({ cast: { [id]: { locked: true } } }), [commit])

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
      ) : chapter.station === 'cast' ? (
        <CastStation
          chapter={chapter}
          gates={g}
          proposing={proposing}
          proposeNotice={proposeNotice}
          cards={cards}
          onPropose={propose}
          onEdit={editCard}
          onCommit={commitCard}
          onReroll={reroll}
          onDraw={draw}
          onLock={lock}
          onGoStoryboard={() => goTo('storyboard')}
        />
      ) : (
        <ComingNext station={chapter.station} />
      )}
    </div>
  )
}

/** Stations not built yet. Replaced slice by slice. */
function ComingNext({ station }: { station: Station }) {
  const copy: Record<Exclude<Station, 'story' | 'cast'>, [string, string, string]> = {
    storyboard: ['Station 3 · The main studio', 'The storyboard', 'Four panels against the locks. Built next.'],
    reader: ['Station 4 · The reader', 'Ink & Publish', 'The finished page. Built last.'],
  }
  const [eyebrow, title, lede] = copy[station as Exclude<Station, 'story' | 'cast'>]
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
