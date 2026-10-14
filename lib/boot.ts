// The Node half of `instrumentation.ts`, in its own module so the Edge build
// never sees `process.exit` (Next compiles the hook for both runtimes).
import 'server-only'
import { ConfigError, appConfig } from './config'

export function boot() {
  try {
    const config = appConfig()
    console.log(`[config] storage: ${config.storage} · generation: ${config.generationEnabled ? 'on' : 'off'}`)
  } catch (err) {
    // Next keeps a server whose hook failed listening, answering 500 to
    // everything. In production that must be a stopped process instead, so
    // the host sees a failed deploy and keeps the last good one.
    if (err instanceof ConfigError && process.env.NODE_ENV === 'production') {
      console.error(`[config] ${err.message}`)
      process.exit(1)
    }
    throw err
  }
}
