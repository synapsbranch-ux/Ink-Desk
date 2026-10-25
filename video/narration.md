# Ink Desk — narration script

<!--
  The words spoken over the demo, and the burned-in English captions (the same
  words, so they never disagree). They are YOURS: the hackathon's shipping skill
  says the narration is the learner's own, so this file holds no drafted lines —
  one bracketed placeholder per beat, for you to replace with what you want to
  say. Then run `npm run video:narrate` — only the sections whose words changed
  are recorded again.

  One `## <id>` section per beat of the edit that has words (src/cut.ts);
  keep the ids. The outro is a silent title card and has no section. A section
  left as a [bracketed placeholder] is a draft: it is captioned as written so
  you can judge the timing, and never sent to the voice. Comments like this one
  are never spoken.

  The word budget is what fits the beat at a calm pace (≈ 2.2 words a second,
  src/script.ts wordBudget): the voice starts 0.4 s into its beat and must end
  before the beat does. Stay at or under it — shorter is safer than longer.
  `npm run video:narrate` measures the real audio and says if a beat runs long.
  Rules from the hackathon: no third-party trademarks, under three minutes,
  English. Applied here: name no provider or brand ("the AI", "an image model",
  "the hackathon's Learn Skill Pack"), and claim only what the app does.
-->

## intro
<!-- Problem and audience · 14 s · about 28 words -->
[Your words: the problem, and who it is for.]

## signin
<!-- Sign in to the studio · 10 s · about 19 words -->
[Your words over the sign-in and the desk appearing.]

## project
<!-- The desk, and a project · 10 s · about 19 words -->
[Your words over the desk and the project opening.]

## library
<!-- The scenario, the library and the locked cast · 20 s · about 41 words -->
[Your words over the scenario, the library and the locked cast with its DNA.]

## director
<!-- The Director's plan and its estimate · 16 s · about 33 words -->
[Your words over the Director's plan and the estimate.]

## pages
<!-- Pages ink in, a bubble edit · 22 s · about 46 words -->
[Your words over the pages inking in and the bubble edit.]

## moneyshot
<!-- The money shot · 12 s · about 24 words -->
[Your words over the sheet beside its panels.]

## reader
<!-- The reader and the PDF export · 12 s · about 24 words -->
[Your words over the reader and the export.]

## share
<!-- A public link, opened signed out · 10 s · about 19 words -->
[Your words over the share link and the public page.]

## method
<!-- How it was built: the Learn Skill Pack, step by step · 22 s · about 46 words -->
[Your words on how it was built with the hackathon's Learn Skill Pack.]

## learned
<!-- What I learned, and how the skill helped · 15 s · about 30 words -->
[Your words: what you learned, and how the skill helped. The last words of the film.]
