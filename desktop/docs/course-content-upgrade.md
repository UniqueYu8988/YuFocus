# Course Content Upgrade

## Goal

Make each lesson useful as a compact course unit, not a thin subtitle summary.

The video transcript should define the knowledge scope and evidence boundary. The teacher may add general teaching explanations, application steps, practice tasks, and transfer questions, but must not invent video-specific facts, author opinions, data, or cases.

## Course Package Fields

`knowledge` now supports these optional enrichment fields:

- `source_scope`: what the source transcript actually covers.
- `teaching_expansion`: teacher-added explanation chain.
- `practical_steps`: how to apply the knowledge.
- `practice_tasks`: short exercises the learner can do.
- `transfer_prompts`: scenario questions for transfer.
- `enrichment_notes`: boundary notes explaining what is source-derived vs. teaching-added.

## Teaching Flow

The main workspace remains linear:

1. Teach one lesson.
2. Ask one quiz question.
3. User answers.
4. Teacher judges and gives the correct explanation.
5. Move to the next lesson, regardless of correctness.

Wrong answers should be corrected directly. They should not trigger a complex wrong-answer system or loop the user inside the same node.

## Quality Checks

Run these before shipping teaching changes:

```powershell
npm run check:course-quality
npm run check:learning-flow
npm run build:web
```

Backend syntax check:

```powershell
python -m py_compile .\src\distiller.py .\src\bilibili_api.py .\src\audio_fallback.py
```
