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

## Topic-driven research lead discovery (v1)

```bash
PROJECT_ID=<project-id> npm run documentary:research
```

Runs five topic-specific Google News RSS searches (topic, business model, financial results, strategy/competition, and primary-source leads). Saves `research/discovery-leads.json` and appends the leads to `research.sources` in the project.

**Important:** these are unverified discovery leads, not facts or independent corroboration. This module does not scrape publisher pages, extract filing tables, authenticate documents, adjudicate contradictions, or verify claims. Search URLs may be redirects. A human or a later source-ingestion stage must resolve canonical publisher URLs and add primary documents. Failures are recorded per query; partial discovery is retained.

## Evidence ledger audit (v1)

```bash
PROJECT_ID=<project-id> npm run documentary:evidence-audit
```

Writes `EVIDENCE-AUDIT.json` with source metadata checks, claim-to-source traceability, primary-source linkage counts, unresolved contradiction flags, and missing attribution/caveat/reasoning warnings. It blocks malformed references but does **not** verify factual truth, authenticate source content, or decide whether evidence is sufficient. A claim marked `verified` without a linked primary-source type is flagged for review, not automatically downgraded.

Source records should use stable IDs and a source type such as `primary_filing`, `annual_report`, `regulatory_filing`, `court_record`, `official_dataset`, `company_statement`, `technical_paper`, `original_interview`, or `secondary_lead`.

Claim records should include:
- `id`, `text`, `classification`, and `sourceIds`
- `attribution` for attributed statements
- `caveat` and methodology for estimates
- `reasoning` for analysis
- `confidence` as an editorial assessment, never a substitute for evidence

## Public source ingestion (v1)

```bash
PROJECT_ID=<project-id> npm run documentary:ingest
```

Fetches publicly accessible HTTP(S) source URLs already present in the project's source ledger. It follows ordinary redirects, records the final URL, HTTP status, content type, retrieval time, and a SHA-256 hash of extracted HTML text. For HTML pages it attempts lightweight metadata and article/main text extraction into `research/source-snapshots/`; it writes `research/ingestion-report.json`.

PDFs are detected but not parsed in this version. Unsupported content types are recorded without downloading binary files. The fetcher applies a timeout and response-size limit, rejects obvious localhost/private-network URLs, and does not log in, bypass paywalls, execute page scripts, or download arbitrary assets.

**Critical limitation:** extracted text is not fact-checked and may omit tables, footnotes, charts, or dynamic content. A successful fetch does not prove that a source supports a claim. Researchers must inspect the original document and link exact passages/page numbers to claims before narration.
