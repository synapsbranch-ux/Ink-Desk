'use client'

// The quota meter in the header of the dashboard and the studio (v3, slice
// 20): today's images used against the limit as a thin ink-bar and the number,
// calm until 80% (`WARN_AT`), then a warning tone and words, and "used up" at
// 100%. Tapping it opens the day's four meters and the reset time — a tap, not
// a hover, so a phone gets the same — with the way to the Usage page.
//
// It shows what the server counted (`useUsage`, one store shared with every
// button), hides entirely on a desk where limits are off (`metering: false`),
// holds its size while loading (a skeleton, no jump) and, if the read fails,
// says so quietly rather than showing an error. When generation is paused for
// everyone it says that instead, with the one message.
// Implements `devpost/prd.md > Limits and Usage (v3)`.
import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'
import { useUsage } from '@/lib/limits/use-usage'
import { clockOf, resetClause } from '@/lib/limits/button'
import { meterFraction, meterWarns, type Meter, type UsageView } from '@/lib/limits/view'

export const USAGE_PATH = '/settings/usage'

type Tone = 'calm' | 'warn' | 'full' | 'paused'

/** The person's own dollar limit is what shuts the pictures: the server says so, and the image meter may still have room. */
const spendCapped = (usage: UsageView) => usage.blocked?.code === 'spend'

function toneOf(usage: UsageView): Tone {
  if (usage.paused) return 'paused'
  if (spendCapped(usage)) return 'full'
  if (meterFraction(usage.images) >= 1 && usage.images.limit > 0) return 'full'
  if (meterWarns(usage.images)) return 'warn'
  return 'calm'
}

/** The bar: a track and a fill, `role="meter"`-free decoration — the number beside it is the information. */
export function InkBar({ meter, tone }: { meter: Meter; tone?: 'calm' | 'warn' | 'full' }) {
  const t = tone ?? (meter.limit > 0 && meterFraction(meter) >= 1 ? 'full' : meterWarns(meter) ? 'warn' : 'calm')
  return (
    <span className={`ink-bar is-${t}`} aria-hidden="true">
      <span className="ink-bar-fill" style={{ width: `${Math.round(meterFraction(meter) * 100)}%` }} />
    </span>
  )
}

/** The four meters, as the popover and the Usage page list them. */
export const METER_ROWS: readonly {
  key: 'images' | 'projects' | 'videoSeconds' | 'audioChars'
  label: string
  unit: (n: number) => string
}[] = [
  { key: 'images', label: 'Images', unit: (n) => (n === 1 ? 'image' : 'images') },
  { key: 'projects', label: 'New projects', unit: (n) => (n === 1 ? 'project' : 'projects') },
  { key: 'videoSeconds', label: 'Video', unit: (n) => (n === 1 ? 'second' : 'seconds') },
  { key: 'audioChars', label: 'Voice', unit: (n) => (n === 1 ? 'character' : 'characters') },
]

export function QuotaMeter() {
  const { usage, status, refresh } = useUsage()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const popId = useId()

  // Closes on a tap outside and on Escape (focus goes back to the meter).
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        trigger.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // A desk where nothing is limited has nothing to show.
  if (usage && !usage.metering) return null

  if (!usage && status === 'loading') {
    return (
      <div className="quota" aria-busy="true">
        <span className="quota-trigger is-skeleton" aria-label="Loading today’s usage">
          <span className="quota-skeleton-bar" />
        </span>
      </div>
    )
  }

  // The read failed and nothing has been read yet: quiet, with a way to look again.
  if (!usage) {
    return (
      <div className="quota" ref={root}>
        <button
          ref={trigger}
          type="button"
          className="quota-trigger is-quiet"
          aria-expanded={open}
          aria-controls={popId}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="quota-label">Usage</span>
          <span className="quota-num">—</span>
        </button>
        {open && (
          <div className="quota-pop" id={popId} role="region" aria-label="Today’s usage">
            <p className="quota-pop-lede">Today’s usage couldn’t be shown just now.</p>
            <div className="quota-pop-foot">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void refresh()}>
                Try again
              </button>
              <Link className="quota-link" href={USAGE_PATH}>
                Usage page →
              </Link>
            </div>
          </div>
        )}
      </div>
    )
  }

  const tone = toneOf(usage)
  const images = usage.images
  const otherWarns = tone === 'calm' && usage.warn
  const dollars = tone === 'full' && spendCapped(usage) && meterFraction(images) < 1
  const word =
    tone === 'paused' ? 'Paused' : dollars ? 'Spending limit' : tone === 'full' ? 'Used up' : tone === 'warn' ? 'Running low' : otherWarns ? 'Check limits' : null
  const until = clockOf(usage.paused?.resetsAt ?? usage.resetsAt)
  const title =
    tone === 'paused'
      ? 'Drawing is paused for everyone right now.'
      : dollars
        ? (usage.blocked?.message ?? 'You’ve reached today’s spending limit.')
        : tone === 'full'
          ? `You’ve used all of today’s images.${until ? ` They come back at ${until}.` : ''}`
          : `${images.used} of ${images.limit} images used today.`

  return (
    <div className="quota" ref={root}>
      <button
        ref={trigger}
        type="button"
        className={`quota-trigger is-${tone}${otherWarns ? ' is-other-warn' : ''}`}
        aria-expanded={open}
        aria-controls={popId}
        title={title}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="quota-label">Images today</span>
        <InkBar meter={images} tone={tone === 'paused' ? 'full' : tone} />
        <span className="quota-num">
          {images.used}
          <span className="quota-of"> / {images.limit}</span>
        </span>
        {word && <span className="quota-word">{word}</span>}
      </button>

      {open && (
        <div className="quota-pop" id={popId} role="region" aria-label="Today’s limits">
          <div className="quota-pop-head">
            <span className="eyebrow eyebrow-sm">Today’s limits</span>
            <span className="quota-plan">{usage.plan === 'allowlisted' ? 'Allowlisted' : 'Free'} plan</span>
          </div>
          {usage.paused && <p className="quota-pop-pause">{usage.paused.message}</p>}
          {dollars && usage.blocked && <p className="quota-pop-pause">{usage.blocked.message}</p>}
          <ul className="quota-rows">
            {METER_ROWS.map(({ key, label, unit }) => {
              const m = usage[key]
              const state = m.limit <= 0 ? 'none' : meterFraction(m) >= 1 ? 'full' : meterWarns(m) ? 'warn' : 'calm'
              return (
                <li key={key} className={`quota-row is-${state}`}>
                  <span className="quota-row-label">{label}</span>
                  <span className="quota-row-num">
                    {m.limit <= 0 ? (
                      'Not on this plan'
                    ) : (
                      <>
                        {m.used.toLocaleString('en-US')} of {m.limit.toLocaleString('en-US')} {unit(m.limit)}
                      </>
                    )}
                  </span>
                  {m.limit > 0 && <InkBar meter={m} />}
                </li>
              )
            })}
          </ul>
          <p className="quota-reset">{resetClause(usage.resetsAt).trim() || 'It resets every day at midnight UTC.'}</p>
          <div className="quota-pop-foot">
            <Link className="quota-link" href={USAGE_PATH}>
              Usage and spend →
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
