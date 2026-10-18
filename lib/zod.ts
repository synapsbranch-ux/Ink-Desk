// zod, with its eval fast path off (slice 23). Zod 4 probes `new Function('')`
// once to decide whether it may compile parsers; under the nonce CSP that
// probe is caught but the browser still reports a violation. Every schema
// module the browser loads (schemas, settings, share/report) imports `z` from
// here, so the setting is in force before the first parse.
import { z } from 'zod'

z.config({ jitless: true })

export { z }
