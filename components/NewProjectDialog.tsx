'use client'

// New project: a title and a style preset, nothing else. The style is locked
// with the project — a second style is a second project — so the choice is
// made here, once, with the presets' own words. One quiet line under the
// style says what a default chapter costs in images (slice 11) — the full
// estimate comes from the Director, before anything is drawn. Implements
// `devpost/prd.md > New Project and Style Presets`.
//
// Slice 20: the estimate also says what the chapter takes of today's images
// ("Uses 13 of your 20 images today"), and Create is shut — with the reason and
// the reset time in the dialog — when today's projects are used up or drawing
// is paused. A project the server refuses anyway shows its sentence.
//
// Slice 21: `defaultStyle` (Settings › Defaults) is the preset the dialog opens
// with chosen; it is only a starting point — the person may pick any other, and
// an id this build does not know falls back to the studio's own default.
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/components/api-fetch'
import { SpendNote } from '@/components/SpendNote'
import { chapterImages, estimateChapterUsd, usd } from '@/lib/cost'
import { asRefusal, refusalSentence, usesLine } from '@/lib/limits/button'
import { useUsage, useSpend } from '@/lib/limits/use-usage'
import { PAGE_COUNT_DEFAULT } from '@/lib/schemas'
import { DEFAULT_STYLE_PRESET_ID, STYLE_PRESETS, STYLE_PRESET_IDS, isStylePresetId, type StylePresetId } from '@/lib/styles'
import type { Chapter } from '@/lib/types'

type Props = {
  panelQuality: string
  onClose: () => void
  /** The preset to open on; none (or an unknown one) means the studio's own default. */
  defaultStyle?: StylePresetId | null
}

export function NewProjectDialog({ panelQuality, onClose, defaultStyle = null }: Props) {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [preset, setPreset] = useState<StylePresetId>(defaultStyle && isStylePresetId(defaultStyle) ? defaultStyle : DEFAULT_STYLE_PRESET_ID)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const spend = useSpend({ project: true })
  const { usage } = useUsage()
  useEffect(() => titleRef.current?.focus(), [])

  const create = async () => {
    const trimmed = title.trim()
    if (!trimmed) {
      setNotice('Give the project a title first.')
      titleRef.current?.focus()
      return
    }
    setBusy(true)
    setNotice(null)
    try {
      const res = await apiFetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed, stylePresetId: preset }),
      })
      const data = (await res.json()) as Chapter | { error: string }
      if (!res.ok || !('version' in data)) {
        const refusal = asRefusal(data)
        setNotice(refusal ? refusalSentence(refusal) : 'The desk couldn’t start the new project.')
        setBusy(false)
        return
      }
      router.push(`/p/${data.address.projectId}`)
    } catch {
      setNotice('The studio couldn’t be reached. Is the dev server running?')
      setBusy(false)
    }
  }

  return (
    <div
      className="confirm-overlay"
      role="presentation"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !busy) onClose()
      }}
    >
      <form
        className="confirm-card new-project"
        role="dialog"
        aria-modal="true"
        aria-label="New project"
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
      >
        <h2 className="confirm-title">New project</h2>
        <p className="confirm-body">A title, and the style every page will be drawn in. The style is locked with the project.</p>

        <label className="field">
          <span className="field-label">Title</span>
          <input
            ref={titleRef}
            className="input"
            value={title}
            maxLength={120}
            placeholder="The Unwritten Letter"
            disabled={busy}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>

        <fieldset className="preset-list" disabled={busy}>
          <legend className="field-label">Style</legend>
          {STYLE_PRESET_IDS.map((id) => {
            const p = STYLE_PRESETS[id]
            const selected = preset === id
            return (
              <label key={id} className={`preset-option${selected ? ' is-selected' : ''}`}>
                <input type="radio" name="preset" value={id} checked={selected} onChange={() => setPreset(id)} />
                <span className="preset-text">
                  <span className="preset-label">{p.label}</span>
                  <span className="preset-blurb">{p.blurb}</span>
                </span>
              </label>
            )
          })}
        </fieldset>

        <p className="new-project-estimate">
          A {PAGE_COUNT_DEFAULT}-page chapter and its cover ≈ {usd(estimateChapterUsd(PAGE_COUNT_DEFAULT, panelQuality))} in
          images at {panelQuality} — the Director shows the full estimate before anything is drawn.{' '}
          {usesLine(usage, chapterImages(PAGE_COUNT_DEFAULT))}
        </p>

        <SpendNote spend={spend} id="create-reason" />
        {notice && <p className="notice">{notice}</p>}

        <div className="confirm-actions">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-stamp"
            disabled={busy || spend.blocked}
            aria-describedby={spend.blocked ? 'create-reason' : undefined}
            title={spend.blocked ? (spend.reason ?? undefined) : undefined}
          >
            {busy ? 'Opening the desk…' : 'Create project'}
          </button>
        </div>
      </form>
    </div>
  )
}
