'use client'

// The Usage page's body (v3, slice 20): for today, the images, new projects,
// video seconds and voice characters used against the limit, with bars and
// the reset time; what has been spent today and this month, from the
// providers' real costs; the plan (free or allowlisted) and each limit; and,
// when generation is paused for everyone, the one message. Everything comes
// from the shared usage store — the numbers the server enforces — and the
// panel refreshes with the meter in the header. Loading is a skeleton, a
// failed read is a sentence and a button, and a desk where limits are off
// says so. Implements `devpost/prd.md > Limits and Usage (v3)` (Usage in
// Settings); see `devpost/spec.md > Limits, Quotas and the Kill Switch (v3)`.
import { InkBar, METER_ROWS } from '@/components/QuotaMeter'
import { usd } from '@/lib/cost'
import { mentionsReset, resetClause } from '@/lib/limits/button'
import { useUsage } from '@/lib/limits/use-usage'
import { meterFraction, meterWarns, type UsageView } from '@/lib/limits/view'

const PLAN_LABEL: Record<UsageView['plan'], string> = { free: 'Free', allowlisted: 'Allowlisted' }
const PLAN_BLURB: Record<UsageView['plan'], string> = {
  free: 'A small daily allowance to try the studio. It resets every day.',
  allowlisted: 'A larger daily allowance, because this account is on the studio’s list. It resets every day.',
}

/** What a plan's limit means per day, in words: "20 images a day", "Not included". */
function limitWords(key: (typeof METER_ROWS)[number]['key'], limit: number): string {
  if (limit <= 0) return 'Not included'
  const n = limit.toLocaleString('en-US')
  switch (key) {
    case 'images':
      return `${n} ${limit === 1 ? 'image' : 'images'} a day`
    case 'projects':
      return `${n} new ${limit === 1 ? 'project' : 'projects'} a day`
    case 'videoSeconds':
      return `${n} ${limit === 1 ? 'second' : 'seconds'} of video a day`
    case 'audioChars':
      return `${n} ${limit === 1 ? 'character' : 'characters'} of voice a day`
  }
}

export function UsagePanel() {
  const { usage, status, refresh } = useUsage()

  if (!usage && status === 'loading') {
    return (
      <div className="usage" aria-busy="true" aria-label="Loading your usage">
        <div className="card usage-card">
          <span className="usage-skeleton is-title" />
          <span className="usage-skeleton" />
          <span className="usage-skeleton" />
          <span className="usage-skeleton" />
          <span className="usage-skeleton" />
        </div>
        <div className="card usage-card">
          <span className="usage-skeleton is-title" />
          <span className="usage-skeleton" />
        </div>
      </div>
    )
  }

  if (!usage) {
    return (
      <div className="notice cast-notice" role="alert">
        <span>Your usage couldn’t be loaded just now. Try again in a moment.</span>
        <button type="button" className="btn btn-secondary" onClick={() => void refresh()}>
          Try again
        </button>
      </div>
    )
  }

  if (!usage.metering) {
    return (
      <div className="card usage-card">
        <h2 className="usage-card-title">No limits on this desk</h2>
        <p className="usage-note">
          Nothing is counted against a daily allowance here, so there is no meter to show. Your projects and their
          costs are on the desk.
        </p>
      </div>
    )
  }

  const { spend } = usage
  const spendFraction = spend.todayLimitUsd > 0 ? Math.min(1, spend.todayUsd / spend.todayLimitUsd) : 0

  return (
    <div className="usage">
      {usage.paused && (
        <div className="notice usage-pause" role="status">
          <strong>Drawing is paused for everyone.</strong> {usage.paused.message}
          {usage.paused.resetsAt && !mentionsReset(usage.paused.message) ? resetClause(usage.paused.resetsAt) : ''}
          <span className="usage-pause-aside"> Reading, the reader, exports and shares keep working.</span>
        </div>
      )}

      <section className="card usage-card" aria-labelledby="usage-today">
        <div className="usage-card-head">
          <h2 className="usage-card-title" id="usage-today">
            Today
          </h2>
          <span className="usage-reset">{resetClause(usage.resetsAt).trim() || 'Resets every day at midnight UTC.'}</span>
        </div>
        <ul className="usage-rows">
          {METER_ROWS.map(({ key, label, unit }) => {
            const m = usage[key]
            const state = m.limit <= 0 ? 'none' : meterFraction(m) >= 1 ? 'full' : meterWarns(m) ? 'warn' : 'calm'
            return (
              <li key={key} className={`usage-row is-${state}`}>
                <div className="usage-row-top">
                  <span className="usage-row-label">{label}</span>
                  <span className="usage-row-num">
                    {m.limit <= 0 ? (
                      'Not included on this plan'
                    ) : (
                      <>
                        <strong>{m.used.toLocaleString('en-US')}</strong> of {m.limit.toLocaleString('en-US')}{' '}
                        {unit(m.limit)}
                      </>
                    )}
                  </span>
                </div>
                {m.limit > 0 && <InkBar meter={m} />}
                {state === 'warn' && <span className="usage-row-flag">Running low — {(m.limit - m.used).toLocaleString('en-US')} left.</span>}
                {state === 'full' && <span className="usage-row-flag">Used up for today.</span>}
              </li>
            )
          })}
        </ul>
      </section>

      <section className="card usage-card" aria-labelledby="usage-spend">
        <div className="usage-card-head">
          <h2 className="usage-card-title" id="usage-spend">
            Spend
          </h2>
          <span className="usage-reset">What the providers report it cost, settled as each picture lands.</span>
        </div>
        <dl className="usage-figures">
          <div className="usage-figure">
            <dt>Today</dt>
            <dd>{usd(spend.todayUsd)}</dd>
            {spend.todayLimitUsd > 0 && (
              <dd className="usage-figure-aside">
                of {usd(spend.todayLimitUsd)} a day
                <InkBar meter={{ used: Math.round(spendFraction * 1000), limit: 1000 }} />
              </dd>
            )}
          </div>
          <div className="usage-figure">
            <dt>This month</dt>
            <dd>{usd(spend.monthUsd)}</dd>
          </div>
        </dl>
        {usage.blocked?.code === 'spend' && (
          <p className="usage-row-flag" role="status">
            {usage.blocked.message} Pictures wait until then.
          </p>
        )}
      </section>

      <section className="card usage-card" aria-labelledby="usage-plan">
        <div className="usage-card-head">
          <h2 className="usage-card-title" id="usage-plan">
            Your plan
          </h2>
          <span className="tag tag-neutral usage-plan-tag">{PLAN_LABEL[usage.plan]}</span>
        </div>
        <p className="usage-note">{PLAN_BLURB[usage.plan]}</p>
        <ul className="usage-limits">
          {METER_ROWS.map(({ key, label }) => (
            <li key={key}>
              <span>{label}</span>
              <span>{limitWords(key, usage[key].limit)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
