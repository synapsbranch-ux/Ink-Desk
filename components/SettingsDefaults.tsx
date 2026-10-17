'use client'

// Settings › Defaults (v3, slice 21): the style New project preselects, and the
// direction the reader opens a manga in. The style list reuses the New-project
// dialog's own words and rows (`STYLE_PRESETS`, `.preset-*`), with one more row
// for "no preference" — New project then starts on the studio's own default.
// Saving is one `PUT /api/settings/defaults` with every field; the answer
// replaces what is shown, so the form always says what is really saved. The
// status line announces "Saved" (or the reason it was not) to a screen reader.
//
// Slice 22 adds the two voices a trailer speaks in: the lead character's and the
// counterpart's (`VOICES`, the premade voices `lib/video/plan.ts` names). A
// character takes the voice for its part the first time it speaks in a trailer
// and keeps it after, so changing a default never changes a trailer already
// made. "Chosen for me" means the studio picks one that suits the character's
// description. There is no preview button: a voice sample costs money, so the
// names are all there is to go on.
import { useState } from 'react'
import { apiFetch } from '@/components/api-fetch'
import { DEFAULT_STYLE_PRESET_ID, STYLE_PRESETS, STYLE_PRESET_IDS, type StylePresetId } from '@/lib/styles'
import type { SettingsView } from '@/lib/settings'
import { isVoiceName, VOICES } from '@/lib/video/plan'

type Choice = StylePresetId | 'none'
type Direction = SettingsView['readingDirection']
/** A voice, or '' for "chosen for me". */
type VoiceChoice = string
type Voices = { lead: VoiceChoice; counterpart: VoiceChoice }
/** The page hands in the settings as the server read them; the voices are the saved ones, when there are any. */
type Initial = SettingsView & { voices?: { lead?: string | null; counterpart?: string | null } }

const voicesOf = (v: Initial['voices']): Voices => ({
  lead: isVoiceName(v?.lead) ? v.lead : '',
  counterpart: isVoiceName(v?.counterpart) ? v.counterpart : '',
})

const voiceLabel = (name: string) => name.charAt(0).toUpperCase() + name.slice(1)

const DIRECTIONS: { value: Direction; label: string; blurb: string }[] = [
  { value: 'rtl', label: 'Right to left', blurb: 'The way manga is read: the first page is on the right.' },
  { value: 'ltr', label: 'Left to right', blurb: 'Like most books: the first page is on the left.' },
]

const SAVE_FAILED = 'Your defaults couldn’t be saved just now. Try again in a moment.'

export function SettingsDefaults({ initial }: { initial: Initial }) {
  const [style, setStyle] = useState<Choice>(initial.defaultStyle ?? 'none')
  const [direction, setDirection] = useState<Direction>(initial.readingDirection)
  const [voices, setVoices] = useState<Voices>(() => voicesOf(initial.voices))
  // What the server last said it holds: the form is "dirty" when it differs.
  const [saved, setSaved] = useState({ style: (initial.defaultStyle ?? 'none') as Choice, direction: initial.readingDirection, voices: voicesOf(initial.voices) })
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ kind: 'saved' | 'error'; text: string } | null>(null)

  const dirty =
    style !== saved.style || direction !== saved.direction || voices.lead !== saved.voices.lead || voices.counterpart !== saved.voices.counterpart

  const save = async () => {
    setBusy(true)
    setStatus(null)
    try {
      const res = await apiFetch('/api/settings/defaults', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          defaultStyle: style === 'none' ? null : style,
          readingDirection: direction,
          voices: { lead: voices.lead || null, counterpart: voices.counterpart || null },
        }),
      })
      const body = (await res.json().catch(() => null)) as { settings?: Initial; error?: unknown } | null
      if (!res.ok || !body?.settings) {
        const sentence = typeof body?.error === 'string' && body.error.length < 300 ? body.error : SAVE_FAILED
        setStatus({ kind: 'error', text: sentence })
        return
      }
      const now = {
        style: (body.settings.defaultStyle ?? 'none') as Choice,
        direction: body.settings.readingDirection,
        voices: voicesOf(body.settings.voices),
      }
      setStyle(now.style)
      setDirection(now.direction)
      setVoices(now.voices)
      setSaved(now)
      setStatus({ kind: 'saved', text: 'Saved' })
    } catch {
      setStatus({ kind: 'error', text: SAVE_FAILED })
    } finally {
      setBusy(false)
    }
  }

  const pickStyle = (v: Choice) => {
    setStyle(v)
    setStatus(null)
  }
  const pickDirection = (v: Direction) => {
    setDirection(v)
    setStatus(null)
  }
  const pickVoice = (part: keyof Voices, v: VoiceChoice) => {
    setVoices((all) => ({ ...all, [part]: v }))
    setStatus(null)
  }

  return (
    <form
      className="settings-form"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <section className="card settings-card" aria-labelledby="defaults-style-title">
        <h2 className="settings-card-title" id="defaults-style-title">
          Style for new projects
        </h2>
        <p className="settings-note">New project opens with this style already chosen. You can still pick another one each time.</p>
        <fieldset className="preset-list" disabled={busy}>
          <legend className="sr-only">Style for new projects</legend>
          {STYLE_PRESET_IDS.map((id) => {
            const p = STYLE_PRESETS[id]
            const selected = style === id
            return (
              <label key={id} className={`preset-option${selected ? ' is-selected' : ''}`}>
                <input type="radio" name="defaultStyle" value={id} checked={selected} onChange={() => pickStyle(id)} />
                <span className="preset-text">
                  <span className="preset-label">{p.label}</span>
                  <span className="preset-blurb">{p.blurb}</span>
                </span>
              </label>
            )
          })}
          <label className={`preset-option${style === 'none' ? ' is-selected' : ''}`}>
            <input type="radio" name="defaultStyle" value="none" checked={style === 'none'} onChange={() => pickStyle('none')} />
            <span className="preset-text">
              <span className="preset-label">No preference</span>
              <span className="preset-blurb">New project starts on {STYLE_PRESETS[DEFAULT_STYLE_PRESET_ID].label}.</span>
            </span>
          </label>
        </fieldset>
      </section>

      <section className="card settings-card" aria-labelledby="defaults-reading-title">
        <h2 className="settings-card-title" id="defaults-reading-title">
          Reading direction
        </h2>
        <p className="settings-note">
          How the reader opens a manga in the studio. You can flip it while reading. A shared page opens right to left and its readers can
          flip it too. A manhwa is one vertical scroll whichever you choose.
        </p>
        <fieldset className="preset-list" disabled={busy}>
          <legend className="sr-only">Reading direction</legend>
          {DIRECTIONS.map(({ value, label, blurb }) => {
            const selected = direction === value
            return (
              <label key={value} className={`preset-option${selected ? ' is-selected' : ''}`}>
                <input type="radio" name="readingDirection" value={value} checked={selected} onChange={() => pickDirection(value)} />
                <span className="preset-text">
                  <span className="preset-label">{label}</span>
                  <span className="preset-blurb">{blurb}</span>
                </span>
              </label>
            )
          })}
        </fieldset>
      </section>

      <section className="card settings-card" aria-labelledby="defaults-voices-title">
        <h2 className="settings-card-title" id="defaults-voices-title">
          Voices for trailers
        </h2>
        <p className="settings-note">
          When a character speaks in a trailer for the first time, it takes the voice for its part here and keeps it from then on. Trailers
          you have already made keep the voices they have. “Chosen for me” picks a voice that suits the character’s description.
        </p>
        <div className="voice-pickers">
          {(
            [
              ['lead', 'Lead character’s voice'],
              ['counterpart', 'Counterpart’s voice'],
            ] as const
          ).map(([part, label]) => (
            <label key={part} className="field voice-field">
              <span className="field-label">{label}</span>
              <select className="input voice-select" value={voices[part]} disabled={busy} onChange={(e) => pickVoice(part, e.target.value)}>
                <option value="">Chosen for me</option>
                {VOICES.map((name) => (
                  <option key={name} value={name}>
                    {voiceLabel(name)}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </section>

      <div className="settings-actions">
        <button type="submit" className="btn btn-stamp" disabled={busy || !dirty}>
          {busy ? 'Saving…' : 'Save defaults'}
        </button>
        {/* The live region only ever holds the result, so typing never announces; the aside says why Save is shut. */}
        <span className={`settings-status${status?.kind === 'error' ? ' is-error' : ''}`} role={status?.kind === 'error' ? 'alert' : 'status'}>
          {status?.text}
        </span>
        {!status && <span className="settings-status">{dirty ? 'You have changes that aren’t saved yet.' : 'Nothing to save: these are your defaults.'}</span>}
      </div>
    </form>
  )
}
