# Ink Desk — narration script

<!--
  The words spoken over the demo, and the burned-in English captions (the same
  words, so they never disagree). This draft was written for you to change:
  rewrite any line in your own words, then run `npm run video:narrate` — only
  the sections whose words changed are recorded again.

  One `## <id>` section per beat of the edit (src/cut.ts); keep the ids.
  A section left as a [bracketed placeholder] is a draft: it is captioned as
  written so you can judge the timing, and never sent to the voice. Comments
  like this one are never spoken.

  The word budget is what fits the beat at a calm pace (≈ 2.2 words a second,
  src/script.ts wordBudget): the voice starts 0.4 s into its beat and must end
  before the beat does. Stay at or under it — shorter is safer than longer.
  `npm run narrate` measures the real audio and says if a beat runs long.
  Rules from the hackathon: no third-party trademarks, under three minutes.
  Applied here: no provider or brand is named ("the AI", "an image model",
  "the hackathon's Learn Skill Pack"), and only the character lock is claimed.
-->

## intro
<!-- Problem and audience · 19 s · about 39 words -->
I have stories, and I cannot draw. Ask an image model for my hero four times, and I get four strangers. Ink Desk keeps one face in every panel. The look freezes once. Only the action changes.

## dashboard
<!-- Dashboard, new project, style · 20 s · about 41 words -->
My desk. Every project sits here with its cover. New project asks for a title and a style preset: manga in black and white, or manhwa in colour. That style stays fixed for the project. The studio opens.

## library
<!-- Scenario and library, import and lock · 28 s · about 59 words -->
I paste the whole scenario. The Library proposes the cast from it. For the lead, I bring my own drawing. Import reference puts it on the card, and the AI reads the picture and writes its visual DNA in words beside the art. Lock freezes the picture and the words together. Both cards, locked.

## director
<!-- The Director plans the chapter · 24 s · about 50 words -->
The Director opens. It reads the scenario, the cast and the style, and plans the chapter: pages and a cover, one locked character per panel, with action, camera, background and dialogue. Every line is mine to edit. The estimate shows before anything is drawn. I press Generate all.

## pages
<!-- Pages ink in, bubble edit, redraw · 32 s · about 68 words -->
Page one inks in, panel by panel. Every panel request carries the locked sheet and the DNA word for word; the AI writes only the action, the angle, the expression. Locked appearance, free action. Bubbles are app lettering: a line is retyped, never regenerated. A panel that misses gets Redraw: the same request again, the earlier version kept. Then the rest, and the cover.

## moneyshot
<!-- The money shot · 15 s · about 30 words -->
My imported reference, and beside it what came back: pages one, two and three, and the cover. Nothing retouched. Every action is different. The face is not.

## reader
<!-- Reader and PDF export · 14 s · about 28 words -->
Ink and Publish opens on the cover, then every page in the style's reading order. Export binds the whole chapter into one PDF, lettering included.

## method
<!-- How it was made: planned before built · 15 s · about 30 words -->
Planned with the hackathon's Learn Skill Pack: scope, PRD and spec before code, then built slice by slice, each verified and committed. Version two revised the same documents.

## outro
<!-- What I learned, and the outro · 10 s · about 19 words -->
What I learned: plan first, prove the one risky idea with a kernel test, then build.
