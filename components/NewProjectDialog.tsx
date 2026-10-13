'use client'

// New project: a title and a style preset, nothing else. The style is locked
// with the project — a second style is a second project — so the choice is
// made here, once, with the presets' own words. Implements
// `devpost/prd.md > New Project and Style Presets`.
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { DEFAULT_STYLE_PRESET_ID, STYLE_PRESETS, STYLE_PRESET_IDS, type StylePresetId } from '@/lib/styles'
import type { Chapter } from '@/lib/types'

export function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [preset, setPreset] = useState<StylePresetId>(DEFAULT_STYLE_PRESET_ID)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
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
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed, stylePresetId: preset }),
      })
      const data = (await res.json()) as Chapter | { error: string }
      if (!res.ok || !('version' in data)) {
        setNotice('error' in data ? data.error : 'The desk couldn’t start the new project.')
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

        {notice && <p className="notice">{notice}</p>}

        <div className="confirm-actions">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-stamp" disabled={busy}>
            {busy ? 'Opening the desk…' : 'Create project'}
          </button>
        </div>
      </form>
    </div>
  )
}
