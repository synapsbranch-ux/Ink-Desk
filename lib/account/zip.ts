// A zip written to a temp file, one entry at a time (v3, slice 21) — the small
// wrapper the export is built on, so the export itself reads as a list of what
// goes in. `yazl` writes the archive; this file keeps three promises the export
// needs:
//
//   • bounded memory: a picture is a stream that is read to its end before the
//     next one is opened, so a desk of a thousand pictures is never held whole;
//   • a ceiling: every byte that goes in is counted, and the entry that would pass
//     the cap stops the build with `TooLarge` (the caller turns it into a sentence);
//   • a clean exit either way: `finish` resolves when the file is complete and
//     closed, `abort` destroys the half-written archive and its streams, and
//     neither leaves an unhandled 'error' event behind.
import 'server-only'
import { createWriteStream } from 'node:fs'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { ZipFile } from 'yazl'

/** The archive would pass its cap. */
export class TooLarge extends Error {
  constructor() {
    super('the export is larger than the cap')
    this.name = 'TooLarge'
  }
}

export class ZipBuilder {
  private readonly zip = new ZipFile()
  private readonly written: Promise<void>
  private failure: Error | null = null
  private total = 0
  private ended = false

  constructor(
    path: string,
    private readonly capBytes: number,
    private readonly mtime: Date
  ) {
    // An 'error' event with no listener would end the process: keep the first and let `finish` throw it.
    this.zip.on('error', (err: Error) => {
      this.failure ??= err
    })
    this.written = pipeline(this.zip.outputStream, createWriteStream(path))
    this.written.catch((err: unknown) => {
      this.failure ??= err instanceof Error ? err : new Error(String(err))
    })
  }

  /** Bytes put in so far (before compression). */
  get bytes(): number {
    return this.total
  }

  /** A small file, held whole: JSON. Throws `TooLarge` rather than pass the cap. */
  addBuffer(name: string, data: Buffer): void {
    this.reserve(data.byteLength)
    this.zip.addBuffer(data, name, { mtime: this.mtime })
  }

  /**
   * A picture, as a stream. Resolves when its last byte has been taken, and not before — so the caller opens the
   * next one only then. Pictures are already compressed, so they are stored, not deflated.
   */
  async addStream(name: string, body: ReadableStream<Uint8Array>, expectedBytes: number | null): Promise<number> {
    if (expectedBytes !== null) this.reserve(expectedBytes)
    const budget = this.capBytes - this.total + (expectedBytes ?? 0)
    let seen = 0
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        seen += chunk.byteLength
        if (seen > budget) return done(new TooLarge())
        done(null, chunk)
      },
    })
    const source = Readable.fromWeb(body as unknown as WebReadableStream<Uint8Array>)
    const taken = new Promise<void>((resolve, reject) => {
      counter.once('end', resolve)
      counter.once('error', reject)
      source.once('error', reject)
    })
    taken.catch(() => {})
    pipeline(source, counter).catch(() => {}) // both sides' errors are the promise above's to report
    this.zip.addReadStream(counter, name, { mtime: this.mtime, compress: false })
    try {
      await taken
    } catch (err) {
      source.destroy()
      counter.destroy()
      throw err
    }
    if (expectedBytes === null) this.reserve(seen)
    return seen
  }

  /** Seal the archive and wait for the file to be complete on disk. */
  async finish(): Promise<void> {
    if (!this.ended) {
      this.ended = true
      this.zip.end()
    }
    await this.written.catch(() => {})
    if (this.failure) throw this.failure
  }

  /** Drop a half-built archive: nothing more is written and nothing is left open. */
  abort(): void {
    this.ended = true
    const out = this.zip.outputStream as Readable // yazl hands out a PassThrough
    out.destroy()
  }

  private reserve(bytes: number): void {
    if (this.total + bytes > this.capBytes) throw new TooLarge()
    this.total += bytes
  }
}
