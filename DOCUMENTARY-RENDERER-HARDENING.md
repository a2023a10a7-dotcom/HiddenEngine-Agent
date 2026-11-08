# Documentary renderer hardening

This change makes the renderer fail safe on visual evidence: it no longer automatically uses Pexels search results, because broad keyword searches can return generic footage that viewers may mistake for real company or event footage. Until a scene has a verified and explicitly supplied asset, the renderer uses the existing branded motion-graphic fallback.

The render now runs a final ffprobe gate and writes `QA-REPORT.json`. The gate verifies that the exported MP4 has a 1920x1080 video stream and an audio stream. This is technical QA only; it does not certify factual accuracy, visual relevance, subtitle synchronization, or licensing.

## Remaining production work

- Add verified, per-scene source assets with attribution and rights metadata.
- Add editorially designed charts/timelines from evidence-backed values in the dossier.
- Add word- or phrase-level caption timestamps from speech alignment rather than estimating them.
- Add a human review checklist for factual claims, pronunciation, pacing, visual match, and rights.
- Use music/SFX only when a license is documented; otherwise keep the mix clean.
- Verify the ElevenLabs plan permits the intended publication and monetization before release.
