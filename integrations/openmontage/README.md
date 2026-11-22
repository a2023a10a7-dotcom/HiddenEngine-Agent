# OpenMontage editing-engine evaluation

This integration evaluates the upstream [OpenMontage](https://github.com/OpenMontageInc/OpenMontage) project as a documentary editing/composition engine for HiddenEngine.

## Why this project

OpenMontage has a dedicated `documentary-montage` pipeline. Its documented workflow separates scene planning, footage retrieval, edit decisions, composition, color treatment, music mixing, and post-render review. Its editing guidance explicitly rejects slideshow-like pacing, uniform holds, and decorative transitions. It can retrieve real motion footage from open archives and free stock sources, rather than relying only on animated stills.

Evaluated upstream revision: `OpenMontageInc/OpenMontage@2e003e65fa99a0f329478a2c1cdcf26bc481933a` (pinned in CI).

## Integration strategy

- Keep HiddenEngine's research, evidence audit, script, narration, and current production records as the source of truth.
- Evaluate OpenMontage as a separate editorial/composition layer; do not replace the current renderer until a real pilot passes review.
- Pin the upstream checkout used by CI to a known commit so the evaluation is reproducible.
- Do not copy or vendor the upstream project into this repository. CI checks it out temporarily.
- Do not require paid video-generation APIs for the first smoke test.
- Do not publish or upload videos automatically.

## What the automated check proves

The `OpenMontage editor validation` workflow checks out the pinned upstream revision, installs its dependencies, runs its contract tests, renders a zero-key Remotion composition, and verifies the resulting MP4 with ffprobe.

This is an installation/composition smoke test. It does **not** claim that the full agent-led documentary pipeline has run, or that the China documentary has been re-edited by OpenMontage.

## China documentary pilot

See [CHINA-PILOT.md](CHINA-PILOT.md) for the editorial brief and acceptance criteria. The pilot must use the existing English narration and factual script, build a shot-level timeline, favor real motion footage where it materially improves the story, and retain HiddenEngine's dark/charcoal/copper visual identity.

## License and operational note

The upstream project declares GNU AGPL-3.0. This evaluation checks out and runs the upstream project as a separate tool; it does not copy its source into HiddenEngine. Any future distribution, hosted service, or source-level modification must be reviewed for AGPL obligations before release.
