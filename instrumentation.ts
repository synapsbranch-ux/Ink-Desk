// Runs once when the server starts, before it takes a request. One job: cloud
// storage switched on without its settings is refused here, by name, rather
// than discovered by the first click — and the studio never quietly falls back
// to the local desk (`devpost/spec.md > Important Failure Modes (v2)`). The
// store refuses every call with the same sentence too, so a server that comes
// up anyway still cannot write anywhere it was not told to.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { missingCloudEnv, missingCloudSentence, storageMode } = await import('./lib/store/env')
  const mode = storageMode() // an unknown mode throws its own sentence
  if (mode === 'local') return
  const missing = missingCloudEnv()
  if (missing.length > 0) throw new Error(missingCloudSentence(missing))
}
