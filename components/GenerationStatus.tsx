'use client'

// The caption on anything that is generating: the stage line advancing over
// time and the real elapsed count, ticking once a second. Positioned by the
// parent's `--cx`/`--cy` (the speed lines' centre) or centred by default.
import { useEffect, useState } from 'react'
import { formatElapsed, stageLine, type Stages } from '@/lib/stages'

type Props = {
  stages: Stages
  /** The server's timestamp when there is one (a panel keeps its clock across
   *  a reload); otherwise timing starts when this indicator appeared. */
  startedAt?: string | null
}

export function GenerationStatus({ stages, startedAt = null }: Props) {
  const [mounted] = useState(() => Date.now())
  const start = startedAt ? Date.parse(startedAt) : mounted
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const elapsed = Math.max(0, Math.floor((now - start) / 1000))
  return (
    <span className="gen-status" role="status">
      <span className="gen-stage">{stageLine(stages, elapsed)}</span>
      <span className="gen-elapsed">{formatElapsed(elapsed)}</span>
    </span>
  )
}
