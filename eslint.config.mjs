import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Not app code: the pre-existing mockup, generated art, planning docs,
    // and the two copies of the hackathon skills.
    'reference/**',
    'data/**',
    'devpost/**',
    '.agents/**',
    'agent/**',
  ]),
])

export default eslintConfig
