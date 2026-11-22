# China technology documentary — OpenMontage pilot brief

## Objective

Re-edit the existing 15-minute English-language China technology documentary using OpenMontage's `documentary-montage` pipeline. This is an editorial pilot, not permission to rewrite the research or change the thesis.

## Inputs to preserve

- Project ID: `2026-11-12-chinas-technology-rise`
- Audience: Western English-speaking YouTube documentary audience
- Target duration: approximately 15 minutes
- Structure: 15 narrative scenes/chapters
- Preserve the approved narration and evidence-backed claims unless the evidence auditor flags a specific factual problem.
- Preserve the existing voice track if technically usable; do not silently replace it.
- Treat the existing visual audit and credits as source material for review, not as proof that every asset is suitable.

## Creative direction

- Analytical, restrained, investigative documentary tone.
- Near-black `#0A0A0B`, charcoal `#1A1A1C`, white/ivory typography, copper `#C86D2D` accents.
- Geometric sans-serif typography; uppercase chapter headings with restrained tracking.
- Avoid flashy transitions, template-like motion graphics, repetitive Ken Burns moves, and generic stock footage that does not illustrate the spoken sentence.
- Use real moving footage for factories, ports, rail, robotics, EV production, solar manufacturing, semiconductor fabrication, logistics, research labs, and relevant urban infrastructure whenever a credible, rights-cleared clip exists.
- Use maps, charts, timelines, and restrained data overlays only when they explain a named place, comparison, process, or sourced statistic.
- Maintain deliberate rhythm: longer holds for important reveals, shorter cutaways for detail, motivated hard cuts, occasional dissolves, and purposeful act-break fades.
- Music must remain subordinate to narration. Use restrained ambient texture and avoid distracting transition effects.

## Required OpenMontage stages

1. Audit the current script, narration timings, project scene plan, visual audit, and credits.
2. Build a scene/shot plan mapped to narration timecodes, not just chapter labels.
3. Retrieve and inspect candidate footage; record source URL, provider, license, and retrieval date for every selected clip.
4. Reject irrelevant, duplicate, low-resolution, watermarked, or rights-unclear assets.
5. Create a concrete edit-decision timeline with in/out points, variable shot durations, transition choices, and reasons for every cut.
6. Compose a 1920x1080, 25 fps master with consistent color treatment, narration-first audio mixing, subtitles only if they improve comprehension, and clean chapter cards.
7. Run post-render checks: ffprobe, frame sampling, black-frame detection, audio peak/loudness review, subtitle timing, duration, and visual relevance.

## Acceptance criteria

The pilot is not accepted merely because it renders.

- The output is a playable MP4, 1920x1080, with the approved narration intact.
- Target duration remains approximately 15 minutes (13–18 minute acceptable range).
- Every shot has a documented relationship to the narration or narrative beat.
- The timeline has varied shot lengths and avoids repetitive transitions or static-image slideshow behavior.
- No unexplained black frames, accidental freezes, broken audio, abrupt music jumps, or subtitle collisions.
- The color palette and typography remain coherent across chapters.
- Every external asset has documented provenance and a compatible license.
- A human-readable edit decision log and QA report accompany the MP4.
- Compare the pilot against the current HiddenEngine render using the same narration and editorial review criteria.

## Safety rails

- Do not overwrite the current MP4 or current production assets.
- Render to a separate pilot output path.
- Do not publish to YouTube.
- Do not incur paid provider costs. If the free/open-source route cannot meet the visual promise, stop and report the exact blocker rather than silently switching to a paid API or an image-only slideshow.
