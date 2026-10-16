'use client'

// A polite poll for the slow things Settings starts (v3, slice 21): an export
// being packed, an account being deleted. One request at a time (the next is
// scheduled only after the last answered), a delay that grows while nothing
// changes (1.5 s, then ×1.5 up to 10 s) and grows faster after a failed request
// (×2 up to 30 s), and a hidden tab asks for nothing at all — it picks up again,
// straight away, when the tab is shown. `tick` says whether to go on; it is read
// through a ref, so a new closure each render never restarts the poll.
import { useEffect, useRef } from 'react'

export type PollResult = 'again' | 'stop' | 'error'

const FIRST_MS = 1500
const QUIET_MAX_MS = 10_000
const ERROR_MAX_MS = 30_000

export function useBackoffPoll(tick: () => Promise<PollResult>, enabled: boolean): void {
  const latest = useRef(tick)
  useEffect(() => {
    latest.current = tick
  })

  useEffect(() => {
    if (!enabled) return
    let stopped = false
    let paused = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let delay = FIRST_MS

    const run = async () => {
      if (stopped) return
      if (document.hidden) {
        paused = true // nothing is asked of the studio while nobody is looking
        return
      }
      let result: PollResult
      try {
        result = await latest.current()
      } catch {
        result = 'error'
      }
      if (stopped || result === 'stop') return
      delay = result === 'error' ? Math.min(delay * 2, ERROR_MAX_MS) : Math.min(Math.round(delay * 1.5), QUIET_MAX_MS)
      timer = setTimeout(() => void run(), delay)
    }

    const onVisible = () => {
      if (document.hidden || !paused || stopped) return
      paused = false
      delay = FIRST_MS
      void run()
    }

    document.addEventListener('visibilitychange', onVisible)
    timer = setTimeout(() => void run(), delay)
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled])
}
