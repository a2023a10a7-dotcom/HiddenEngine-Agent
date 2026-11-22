# OpenMontage editing-engine evaluation

This integration evaluates the upstream [OpenMontage](https://github.com/OpenMontageInc/OpenMontage) project as an editorial/composition engine for HiddenEngine.

## Important pipeline selection

OpenMontage's pipeline named `documentary-montage` is **not** the right pipeline for this project: its own executive-producer brief defines it for short, non-narrative 30–180 second tone poems and explicitly says it is not for narrated explainers. Do not route the China documentary through it unchanged.

For HiddenEngine's existing narrated, source-led documentary, use OpenMontage's `hybrid` pipeline as the starting point: it explicitly supports source footage plus diagrams/overlays, and has a narration/dialogue plan. Borrow the edit discipline from `documentary-montage` (variable holds, purposeful cuts, limited transitions, music sync) without adopting its no-narration restriction. Use the `cinematic` pipeline only for source-led sequences where a more mood-led treatment is justified.

## Why this project

OpenMontage separates scene planning, footage selection, edit decisions, composition, color treatment, music mixing, and post-render review. Its source catalogue includes Pexels, Archive.org, NASA, Wikimedia Commons and other providers. The hybrid pipeline can balance real footage with restrained explanatory graphics.

## Integration strategy

- Keep HiddenEngine's research, evidence audit, script, narration, and production records as the source of truth.
- Evaluate OpenMontage as a separate editorial/composition layer; do not replace the current renderer until a real narrated pilot passes review.
- Pin the upstream checkout used by CI to a known commit so the evaluation is reproducible.
- Do not copy or vendor the upstream project into this repository. CI checks it out temporarily.
- Do not require paid video-generation APIs for the first smoke test.
- Do not publish or upload videos automatically.

## What the automated check proves

The `OpenMontage editor validation` workflow checks out the pinned upstream revision, installs its dependencies, runs its contract tests, renders a zero-key Remotion composition, and verifies the resulting MP4 with ffprobe.

The smoke test passed: H.264, 1920×1080, 30 fps, 23.06 seconds. It proves installation and composition work. It does **not** prove that the hybrid agent-led pipeline has edited the China film or that the sample itself is a documentary montage.

## China documentary pilot

See [CHINA-PILOT.md](CHINA-PILOT.md) for the editorial brief and acceptance criteria. The pilot uses the `hybrid` pipeline with the existing English narration and script, real motion footage as the anchor layer, and selective maps/charts as support.

## License and operational note

The upstream project declares GNU AGPL-3.0. This evaluation checks out and runs the upstream project as a separate tool; it does not copy its source into HiddenEngine. Any future distribution, hosted service, or source-level modification must be reviewed for AGPL obligations before release.
