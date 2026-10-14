// Lets the checks load server modules. Every module that reads a secret
// imports `server-only` (SEC-15), whose package throws unless it is resolved
// under React's server condition — which is what Next does for route
// handlers, pages and `instrumentation.ts`, and what a plain tsx run does not.
// This resolves that one package the way Next's server does and leaves every
// other import alone, so React and the rest load as they always have.
//
// Import it first, before any dynamic import of `lib/`: a static import graph
// is resolved before this module runs.
import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier !== 'server-only') return nextResolve(specifier, context)
    return nextResolve(specifier, { ...context, conditions: [...context.conditions, 'react-server'] })
  },
})
