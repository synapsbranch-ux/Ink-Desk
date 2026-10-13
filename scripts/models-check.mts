// The style presets, checked without a browser: the default preset's rules
// are v1's STYLE_RULES word for word (so the kernel-test prompts are still the
// app's prompts), every preset reaches a sheet and a panel prompt verbatim and
// last, the two presets differ, an unknown id falls back to the default, and
// no preset names a real work, artist or publisher. The per-model request
// registry joins this check when alternative models arrive (slice 15).
// Run with `npm run check:models`.
import assert from 'node:assert/strict'

// Loaded dynamically, like every other check — one loader path, one module
// instance for everything these modules import.
const { PANEL_LAYOUT, STYLE_RULES, panelPrompt, sheetPrompt } = await import('../lib/prompts')
const { DEFAULT_STYLE_PRESET_ID, STYLE_PRESETS, STYLE_PRESET_IDS, styleRules, stylePreset, isStylePresetId } =
  await import('../lib/styles')

// 1. The default preset is v1's frozen text, exactly.
const V1_STYLE_RULES = [
  'Black and white manga artwork, screentone shading, confident inked linework.',
  'Seinen style, detailed backgrounds, strong use of blacks.',
  'ABSOLUTELY NO TEXT, no speech bubbles, no sound effects, no signatures,',
  'no watermarks and no panel borders anywhere in the image.',
].join(' ')
assert.equal(DEFAULT_STYLE_PRESET_ID, 'manga-bw')
assert.equal(STYLE_PRESETS['manga-bw'].rules, V1_STYLE_RULES, 'the manga preset must be v1’s STYLE_RULES verbatim')
assert.equal(STYLE_RULES, V1_STYLE_RULES, 'STYLE_RULES must still be the v1 text')
console.log('  ok  the manga preset is v1’s frozen style rules, word for word')

// 2. A prompt without a preset is the v1 prompt; with the default preset, the same prompt.
const dna = 'Kaito Ren, a lean courier with a frayed red scarf and a scar through his right eyebrow.'
const line = { camera: 'eye level', action: 'leaps a gap', background: 'rooftops at dawn' }
assert.equal(sheetPrompt(dna), sheetPrompt(dna, styleRules('manga-bw')))
assert.equal(panelPrompt(dna, line, PANEL_LAYOUT[0]), panelPrompt(dna, line, PANEL_LAYOUT[0], styleRules('manga-bw')))
console.log('  ok  the default prompts are the v1 prompts')

// 3. Every preset's rules land verbatim, and last, in both prompts; the "no text" rule is in each.
for (const id of STYLE_PRESET_IDS) {
  const rules = styleRules(id)
  assert.ok(rules.length > 40, `${id}: rules too short to be real`)
  assert.ok(/ABSOLUTELY NO TEXT/.test(rules), `${id}: the lettering rule is missing`)
  const sheet = sheetPrompt(dna, rules)
  const panel = panelPrompt(dna, line, PANEL_LAYOUT[2], rules)
  assert.ok(sheet.endsWith(rules), `${id}: sheet prompt must end with the rules`)
  assert.ok(panel.endsWith(rules), `${id}: panel prompt must end with the rules`)
  assert.ok(panel.includes(dna) && sheet.includes(dna), `${id}: the DNA must still be pasted verbatim`)
  // No real work, artist or publisher: a few names that would be tempting to write.
  assert.doesNotMatch(rules, /\b(Shueisha|Kodansha|Webtoon|Naver|Tower of God|Solo Leveling|Oda|Miura|Urasawa)\b/i, `${id}: names a real work or publisher`)
}
assert.notEqual(styleRules('manga-bw'), styleRules('manhwa-colour'), 'the two presets must differ')
assert.equal(STYLE_PRESETS['manga-bw'].colour, false)
assert.equal(STYLE_PRESETS['manhwa-colour'].colour, true)
assert.equal(STYLE_PRESETS['manhwa-colour'].reading, 'vertical')
console.log('  ok  both presets reach the sheet and panel prompts verbatim, last, with the lettering rule')

// 4. An unknown id is the default, never a crash and never an empty prompt.
assert.equal(isStylePresetId('watercolour'), false)
assert.equal(stylePreset('watercolour').id, 'manga-bw')
assert.equal(styleRules('watercolour'), V1_STYLE_RULES)
console.log('  ok  an unknown preset id falls back to the default')

console.log('\n  Style preset check passed.\n')
