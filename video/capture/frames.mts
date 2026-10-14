// Where a moment lands in the footage. Playwright's recordVideo does not keep
// real time: for every screencast frame Chromium sends, it writes the frame
// before it `max(1, round(25 × gap))` times. When frames arrive faster than
// 25 a second (a pointer glide, the app's speedlines and ink-in animations) each
// still costs a whole frame, so the webm runs longer than the session did, by
// a different amount in every stretch. A test capture drifted 30 s over four
// minutes. A mark timed by the clock would then cut on the wrong picture.
//
// So the recorder counts the frames as Playwright writes them: this wraps the
// in-process VideoRecorder's writeFrame with the same arithmetic, building a
// map from wall-clock time to footage frame. `toFootage(ms)` answers "which
// second of the webm shows the screen as it was at this moment". The map is
// checked against the finished file's frame count; if Playwright's internals
// ever change and the two disagree, the recorder says so and keeps clock
// times.
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

/** Playwright's own constant in server/chromium/videoRecorder.js. */
export const RECORD_FPS = 25

type Segment = { at: number; start: number; n: number } // at: wall seconds the frame came on screen

type Recorder = {
  _isStopped: boolean
  _lastFrameBuffer: Buffer | null
  _lastFrameTimestamp: number
  writeFrame(frame: Buffer, timestamp: number): void
}

export type FrameMap = {
  /** False when Playwright's recorder couldn't be found — marks stay on the clock. */
  hooked: boolean
  /** Frames written so far. */
  frames(): number
  /** Footage seconds showing the screen as it was at `wallMs` (Date.now()). Null before the first frame. */
  toFootage(wallMs: number): number | null
}

export function watchFrames(): FrameMap {
  const segments: Segment[] = []
  let total = 0
  let hooked = false
  try {
    // Not in playwright-core's exports, so it is loaded by path from the same
    // install; the require cache makes it the very class the browser uses.
    const require = createRequire(import.meta.url)
    const core = dirname(require.resolve('playwright-core/package.json'))
    const { VideoRecorder } = require(join(core, 'lib', 'server', 'chromium', 'videoRecorder.js')) as {
      VideoRecorder: { prototype: Recorder }
    }
    const original = VideoRecorder.prototype.writeFrame
    if (typeof original === 'function') {
      VideoRecorder.prototype.writeFrame = function (this: Recorder, frame: Buffer, timestamp: number) {
        if (!this._isStopped && this._lastFrameBuffer) {
          // The frame on screen since the last call is written n times, starting at `total`.
          const n = Math.max(1, Math.round(RECORD_FPS * (timestamp - this._lastFrameTimestamp)))
          segments.push({ at: this._lastFrameTimestamp, start: total, n })
          total += n
        }
        return original.call(this, frame, timestamp)
      }
      hooked = true
    }
  } catch {
    hooked = false
  }

  return {
    hooked,
    frames: () => total,
    toFootage(wallMs) {
      const t = wallMs / 1000
      if (segments.length === 0 || t < segments[0].at) return null
      // The last frame that was already on screen at t.
      let lo = 0
      let hi = segments.length - 1
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (segments[mid].at <= t) lo = mid
        else hi = mid - 1
      }
      const s = segments[lo]
      const within = Math.min(s.n - 1, Math.floor((t - s.at) * RECORD_FPS))
      return Math.round(((s.start + within) / RECORD_FPS) * 100) / 100
    },
  }
}
