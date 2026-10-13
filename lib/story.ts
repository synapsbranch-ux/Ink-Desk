// The story a project is built from, in either mode (v2, slice 11): an
// accepted synopsis (Pitch, v1) or a saved scenario (Scenario). Every text
// call downstream — the cast, a reroll, the DNA, the plan — reads it through
// `storyBrief`, so the two modes cannot drift apart. Pure and shared with the
// browser. See `devpost/prd.md > Scenario Mode and References`.
import type { Desk } from './types'

/**
 * Up to this many characters, the Director reads a scenario whole; past it,
 * one `summarize` call condenses it to its beats first and the plan says so
 * (`spec.md > The Director (v2)`). Cast and DNA prompts read at most this much.
 */
export const SCENARIO_WHOLE_CHARS = 12_000

/** At most this many ticked references travel to the Director as pictures. */
export const MAX_PLAN_REFERENCES = 4

export type StoryBrief = { title: string; body: string }

/** The story is settled: a synopsis accepted, or a scenario saved with words in it. */
export function storyReady(d: Pick<Desk, 'storyMode' | 'synopsis' | 'scenario'>): boolean {
  if (d.storyMode === 'scenario') return d.scenario?.saved === true && d.scenario.text.trim().length > 0
  return d.synopsis?.accepted === true
}

/**
 * What the cast, reroll and DNA prompts read as "the story". A scenario is
 * clipped to the planner's comfortable size — the cast needs who and where,
 * not every scene — and carries its notes. Null until the story is settled.
 */
export function storyBrief(d: Pick<Desk, 'storyMode' | 'synopsis' | 'scenario' | 'title'>): StoryBrief | null {
  if (!storyReady(d)) return null
  if (d.storyMode === 'scenario' && d.scenario) {
    const text = d.scenario.text.trim()
    const clipped = text.length > SCENARIO_WHOLE_CHARS ? `${text.slice(0, SCENARIO_WHOLE_CHARS)} […]` : text
    const notes = d.scenario.notes.trim()
    return { title: d.title.trim() || 'Untitled chapter', body: notes ? `${clipped}\n\nThe storyteller’s notes: ${notes}` : clipped }
  }
  return d.synopsis ? { title: d.synopsis.title, body: d.synopsis.body } : null
}

/** The scenario is long enough that the Director plans from a summary of it. */
export function needsSummary(text: string): boolean {
  return text.trim().length > SCENARIO_WHOLE_CHARS
}

/** The cover's title until the storyteller retypes it: the project's, else the synopsis's. */
export function defaultCoverTitle(d: Pick<Desk, 'title' | 'synopsis'>): string {
  return (d.title.trim() || d.synopsis?.title.trim() || 'Chapter 1').slice(0, 120)
}

/** "Try the sample scenario". Original text, written for Ink Desk; two principal characters, three scenes. */
export const SAMPLE_SCENARIO = [
  'THE LAST DELIVERY BEFORE DAWN',
  '',
  'Future Osaka, a city of stacked rooftops and humming cable lines. Kaito Ren is a rooftop courier: eighteen, quick, a little reckless, he runs letters across the roofs because the streets below are too slow. Tonight his satchel holds one envelope that makes no sense — it is addressed in his own handwriting, to a woman he has never met, and it is dated three days from now.',
  '',
  'Scene one — the roof of the old post tower, just after midnight. Kaito lands hard on the gravel, catches his breath and turns the envelope over under a flickering sign. The wax seal is still warm. He has delivered strange mail before, but never his own. He decides the only way to understand it is to deliver it.',
  '',
  'Scene two — the Night Archive, a library built inside a disused water tank, its shelves climbing in a spiral. Mio Asakura, the archivist, works alone among the letters the city forgot to send. She is precise, dry and not easily surprised. When Kaito holds out the envelope she reads the address, then the date, and goes very still: the letter is for her, and she recognises the seal — it belongs to the Archive itself, which only seals letters that have not been written yet.',
  '',
  'Scene three — the Archive’s rooftop observatory, under the slow turn of the cable cars. Mio explains the rule she has kept for years: a letter from the future can be read, but whoever delivers it becomes its author. If Kaito hands it over, he will write it, three days from now, whatever it says. Kaito laughs, then stops laughing. He looks at the skyline, at the first grey edge of dawn, and gives her the letter anyway. Mio opens it. We never see the words — only her face as she reads, and the small, surprised smile she tries to hide. Kaito asks what it says. She folds it away and tells him he will find out on Thursday.',
].join('\n')

export const SAMPLE_SCENARIO_NOTES =
  'Keep it quiet and a little magical rather than action-heavy. The letter’s contents stay secret to the end.'
