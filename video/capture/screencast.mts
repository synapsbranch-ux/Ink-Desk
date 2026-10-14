// The recorder: a CDP screencast piped into one ffmpeg at a constant frame
// rate, on our own clock. Playwright's recordVideo was replaced because it
// does not keep real time — it writes each screencast frame
// `max(1, round(25 × gap))` times, so a burst of frames costs whole frames and
// the webm ran ≈ 29 s longer than a four-minute session — and because its VP8
// at ≈ 0.8 Mb/s made the app's text soft.
//
// Here the file's time is wall time by construction. t0 is the first frame's
// own timestamp (seconds since the epoch, the same clock as Date.now()). A
// frame stamped ts is shown from output frame round((ts − t0) × fps) on: the
// frame before it is repeated until the file reaches that count, and frames
// that arrive faster than the output rate simply replace the pending one. A
// still screen sends nothing, so the last frame is padded forward — by a
// ticker while recording, and up to the stop time at the end.
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import type { BrowserContext, Page } from 'playwright'

export type Recording = {
  /**
   * Seconds into the footage that show the screen as it is now (≥ 0). Before
   * the first frame has arrived it waits for it, since there is no t0 yet.
   */
  at(): Promise<number>
  /**
   * Wait until a frame stamped at or after `wallMs` (Date.now()) has arrived,
   * or `ms` if none comes — a still screen sends none. What the page paints
   * reaches the recorder a frame or two later; a mark taken after its frame
   * lands on it rather than just before it.
   */
  frameSince(wallMs: number, ms: number): Promise<void>
  /** Pad to now, finish the file and wait for ffmpeg. Safe to call more than once. */
  stop(): Promise<RecordingResult>
  /** Set once ffmpeg has failed: why, as a clause that reads after a colon. */
  readonly failure: string | null
  /** The first frame's timestamp, seconds since the epoch: footage time 0. Null until it arrives. */
  readonly t0: number | null
}

export type RecordingResult = {
  /** Frames in the file, by our count. */
  frames: number
  /** Distinct screencast frames received. */
  received: number
  /** The most frames ever waiting for ffmpeg, a measure of how hard it was pressed. */
  maxBacklog: number
  failure: string | null
}

export type RecordOptions = {
  fps: number
  width: number
  height: number
  /** Called once if ffmpeg stops before the recording does, with why (a clause, as `failure`). */
  onFailure?: (sentence: string) => void
}

/**
 * How far behind now the ticker pads a still screen. A frame reaches us a few
 * milliseconds after it is stamped; padding right up to now could write past a
 * frame still in flight, which would then show late.
 */
const PAD_LAG_S = 0.5
const TICK_MS = 200
const FIRST_FRAME_MS = 30_000

export async function startRecording(context: BrowserContext, page: Page, file: string, opts: RecordOptions): Promise<Recording> {
  const { fps, width, height } = opts
  const ffmpeg = spawn(
    'ffmpeg',
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(fps), '-i', '-',
      // Chromium's JPEGs are full-range BT.601. Only the range is converted —
      // swscale's matrix change to BT.709 tinted the paper green by 3–4 levels —
      // and the file says it is BT.601, so a decoder doesn't assume 709 for HD.
      '-vf', `scale=${width}:${height}:flags=lanczos:in_range=pc:out_range=tv,format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16',
      // A keyframe every two seconds: Remotion seeks into the footage at every
      // cut and time-lapse, and a short GOP keeps each seek cheap.
      '-g', String(fps * 2),
      '-colorspace', 'smpte170m', '-color_primaries', 'smpte170m', '-color_trc', 'smpte170m', '-color_range', 'tv',
      '-movflags', '+faststart',
      file,
    ],
    // Its own process group: a Ctrl+C in the terminal must reach only us, so
    // the footage so far is finished in order rather than cut off mid-write.
    // If we are killed, ffmpeg sees its input close and still finishes the file.
    { stdio: ['pipe', 'ignore', 'pipe'], detached: true }
  )

  let stderrTail = ''
  ffmpeg.stderr.setEncoding('utf8')
  ffmpeg.stderr.on('data', (s: string) => {
    stderrTail = (stderrTail + s).slice(-2000)
  })

  let failure: string | null = null
  let stopping = false
  const exited = new Promise<number | null>((done) => {
    ffmpeg.on('error', (err) => {
      fail(`ffmpeg couldn't be started (${err.message}); it must be on the PATH`)
      done(null)
    })
    ffmpeg.on('exit', (code, signal) => {
      if (!stopping || code !== 0) {
        const last = stderrTail.trim().split('\n').at(-1)?.trim()
        const how = signal ? `killed by ${signal}` : `exit code ${code}`
        fail(`ffmpeg stopped before the recording ended (${how})${last ? `: ${last.replace(/\.$/, '')}` : ''}`)
      }
      done(code)
    })
  })
  // A write after ffmpeg is gone is EPIPE; the exit handler already says why.
  ffmpeg.stdin.on('error', () => {})

  function fail(sentence: string): void {
    if (failure) return
    failure = sentence
    opts.onFailure?.(sentence)
  }

  // ---- the output clock --------------------------------------------------
  let t0: number | null = null
  let firstFrame!: () => void
  const started = new Promise<void>((r) => (firstFrame = r))
  let pending: Buffer | null = null // the frame on screen now, not yet written for its whole stay
  let written = 0 // frames handed to the writer, by our count
  let received = 0
  let lastTs = -Infinity
  let waiters: { since: number; done: () => void }[] = []
  const slot = (ts: number) => Math.round((ts - t0!) * fps)

  // Writes are queued as (frame, times) and drained in order, awaiting ffmpeg
  // when the pipe is full: the bookkeeping above stays synchronous, so a
  // frame's place in the file never depends on how busy ffmpeg is.
  const queue: { buf: Buffer; n: number }[] = []
  let backlog = 0
  let maxBacklog = 0
  let draining: Promise<void> | null = null
  const enqueue = (buf: Buffer, n: number) => {
    if (n <= 0) return
    queue.push({ buf, n })
    backlog += n
    maxBacklog = Math.max(maxBacklog, backlog)
    draining ??= drain()
      .catch(() => {})
      .finally(() => (draining = null))
  }
  async function drain(): Promise<void> {
    while (queue.length > 0 && !failure) {
      const job = queue[0]
      while (job.n > 0 && !failure) {
        job.n--
        backlog--
        if (!ffmpeg.stdin.write(job.buf)) {
          // An EPIPE rejects the wait; the exit handler is what reports it.
          await Promise.race([once(ffmpeg.stdin, 'drain').catch(() => {}), exited])
        }
      }
      queue.shift()
    }
  }
  /** Write the pending frame until the file holds `count` frames. */
  const padTo = (count: number) => {
    if (pending && count > written) {
      enqueue(pending, count - written)
      written = count
    }
  }

  const onFrame = (ts: number, buf: Buffer) => {
    if (stopping) return
    received++
    lastTs = Math.max(lastTs, ts)
    waiters = waiters.filter((w) => (ts >= w.since ? (w.done(), false) : true))
    if (t0 === null) {
      t0 = ts
      pending = buf
      firstFrame()
      return
    }
    padTo(slot(ts))
    pending = buf // shown from frame `written` on; a faster frame replaces it before it costs one
  }

  const cdp = await context.newCDPSession(page)
  cdp.on('Page.screencastFrame', (e) => {
    // Acked at once: Chromium holds back new frames while too many are unacked,
    // and could drop the last change before a still screen.
    cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {})
    onFrame(e.metadata.timestamp ?? Date.now() / 1000, Buffer.from(e.data, 'base64'))
  })
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: width, maxHeight: height, everyNthFrame: 1 })

  const ticker = setInterval(() => {
    if (t0 !== null) padTo(slot(Date.now() / 1000 - PAD_LAG_S))
  }, TICK_MS)

  let result: Promise<RecordingResult> | null = null
  return {
    get failure() {
      return failure
    },
    get t0() {
      return t0
    },
    async at() {
      const now = Date.now() / 1000
      if (t0 === null) {
        // A page on screen always paints, so a long silence means the screencast is broken, not idle.
        let timer: NodeJS.Timeout | undefined
        const silent = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('the screencast sent no frame in 30 s')), FIRST_FRAME_MS)
        })
        await Promise.race([started, silent]).finally(() => clearTimeout(timer))
      }
      return Math.max(0, Math.round((now - t0!) * 100) / 100)
    },
    frameSince(wallMs, ms) {
      const since = wallMs / 1000
      if (lastTs >= since) return Promise.resolve()
      return new Promise<void>((done) => {
        const timer = setTimeout(done, ms)
        waiters.push({ since, done: () => (clearTimeout(timer), done()) })
      })
    },
    stop() {
      result ??= (async () => {
        const end = Date.now() / 1000
        stopping = true
        clearInterval(ticker)
        await cdp.send('Page.stopScreencast').catch(() => {}) // the page may already be closed
        await cdp.detach().catch(() => {})
        // The last frame stays on screen until the stop; at least once.
        if (t0 !== null) padTo(Math.max(written + 1, slot(end)))
        while (draining) await draining
        ffmpeg.stdin.end()
        const code = await exited
        if (t0 === null && !failure) failure = 'the screencast never sent a frame, so there is no footage'
        return { frames: written, received, maxBacklog, failure: failure ?? (code === 0 ? null : 'ffmpeg did not finish the file') }
      })()
      return result
    },
  }
}

/**
 * Footage seconds at which the page's DOM, as it is now, is on screen. Two
 * things lie between the two: Playwright sees an element as soon as it is in
 * the DOM, but a busy page can take a while to paint it (a studio opening once
 * sat on "Opening the desk…" for a second after its heading was found); and a
 * painted frame reaches the recorder a frame or two later, stamped then. So
 * wait for the paint (two animation frames), then for a frame stamped after
 * it — or 120 ms, when the screen is still and sends none (a painted frame
 * reaches us well within that; the clock check measures it).
 */
export async function onScreen(page: Page, rec: Recording): Promise<{ t: number; late: number }> {
  const found = Date.now()
  const painted = await page
    .evaluate(
      () =>
        new Promise<number>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done(Date.now())))
        )
    )
    .catch(() => Date.now()) // a page navigating away has nothing to wait for
  await rec.frameSince(painted, 120)
  return { t: await rec.at(), late: (painted - found) / 1000 }
}
