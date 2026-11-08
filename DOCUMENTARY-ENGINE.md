# Documentary Production Engine v1

This branch introduces a structured, evidence-first project contract for The Hidden Engine. It is an incremental foundation, not a claim that autonomous documentary production is complete.

## Create a project from one topic

```bash
node src/documentary-engine.js --topic "How [Company] makes money" --language en --duration 480
```

Creates `production/projects/<date>-<topic>/project.json` and `PRODUCTION-BRIEF.md`. The topic is an input, not evidence. The project intentionally remains `topic_received` until research is completed.

## Project contract

- Research sources have stable IDs, publisher, title, URL, publication/access dates, source type, and notes.
- Claims have stable IDs, explicit classifications, source links, confidence, and caveats.
- Contradictions are recorded rather than silently reconciled.
- Every scene contains narration, claim references, visual records, and sound direction.
- Every external visual must record provenance and rights status.
- Human approvals are explicit gates. Final video approval and publication approval are separate.

Recommended source record:
```json
{"id":"SRC-001","publisher":"Company","title":"Annual Report 2025","url":"https://example.com/report.pdf","publishedAt":"2026-02-01","accessedAt":"2026-11-08","type":"primary_filing","notes":"Consolidated annual report"}
```

Recommended claim record:
```json
{"id":"CLM-001","text":"Reported revenue was ...","classification":"verified","sourceIds":["SRC-001"],"confidence":"high","caveat":"Fiscal year ended ..."}
```

Allowed classifications: `verified`, `attributed`, `estimated`, `analysis`, `disputed`, `unverified`. Do not present estimates, attributed statements, or analysis as independently verified fact.

## Quality check

```bash
PROJECT_ID=<project-id> node src/documentary-qa.js
```

The checker validates references and production metadata. A pass is structural QA only; it does not prove that sources are authentic, claims are true, narration is compelling, footage is relevant, or rights are legally sufficient.

## Planned stages

1. Topic intake and editorial framing.
2. Source discovery and primary-document retrieval.
3. Claim extraction, source mapping, contradiction review, and fact-check gate.
4. Story architecture and narration with claim-level traceability.
5. Visual research, rights/provenance register, charts, maps, diagrams, and archival selection.
6. Voice generation, edit decision list, sound design, captions, and render.
7. Structural, factual, audio, visual, rights, and human editorial QA.
8. Final owner approval. No automatic publication.

## Safety and cost boundaries

The engine does not call ElevenLabs, render video, publish, or modify repository secrets. Those actions require separate explicit authorization. Do not use generic stock footage as evidence of a specific event. Do not invent missing financial figures or source links.
