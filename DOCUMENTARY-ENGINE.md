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

## Evidence-linked story architecture (v1)

```bash
PROJECT_ID=<project-id> npm run documentary:script-plan
```

Builds `SCRIPT-ARCHITECTURE.json` from the project's research ledger. It groups eligible claims into a seven-part documentary arc: cold open, system, hidden engine, strategic bet, turning point, economic consequences, and conclusion. Each scene contains candidate claim IDs and mandatory editorial checks.

This is an outline/architecture generator, **not a prose scriptwriter**. It deliberately blocks when no eligible researched claims exist. Keyword grouping is a drafting aid and requires editorial review; it does not understand claim meaning or establish relevance. Every eventual narration sentence must be mapped to claim IDs and checked against the original source passages before voice production.

## Evidence-linked script draft assembly (v1)

```bash
PROJECT_ID=<project-id> npm run documentary:write-script
```

Requires `SCRIPT-ARCHITECTURE.json` and the project's research ledger. Writes `SCRIPT-DRAFT.json` and `SCRIPT-DRAFT.md`. It assembles eligible claim text into the seven-scene structure, preserves each claim's classification and source references, adds editorial transitions and qualification language, and marks every block as requiring passage review.

This is deliberately **not** a polished generative scriptwriter. It does not invent connective facts, quotations, statistics, or scenes. It cannot confirm that a source supports the claim; exact passage and page/table references remain unverified unless a human records and checks them. It blocks voice generation in its output until passage-level fact checking and human approval are complete. A human editor must rewrite for natural narration, check counter-evidence, and approve before TTS.

## Visual direction and asset acquisition plan (v1)

```bash
PROJECT_ID=<project-id> npm run documentary:visual-plan
```

Requires `SCRIPT-DRAFT.json`. Produces `VISUAL-DIRECTION.json`, `VISUAL-DIRECTION.md`, and `visual-assets/ASSET-REGISTER.json`. It creates a scene-by-scene shot plan, restrained visual language, chart/document/map/archival-footage briefs, edit and audio notes, and a rights/provenance register.

This stage does **not** download, license, or clear any media. Every asset begins as `not_acquired`; no suggested stock footage may be represented as real evidence. Before use, record the original URL, creator, exact license and evidence, territory, expiry, and attribution requirements. Match products, people, places, and dates to the story. Chart figures must come from verified claim records and show units, period, source, and methodology.


## Approved script handoff to the renderer

The renderer consumes `production/projects/<project-id>/script.json`, while the evidence-linked writer emits `SCRIPT-DRAFT.json`. Do not rename or hand-edit the draft into a render script. Use the explicit approval handoff:

1. A human editor rewrites each narration block and checks it against the original source.
2. Set each approved block's `editorialStatus` to `approved`, `factCheck.exactPassageConfirmed` to `true`, and record a precise `passageReference` for every source reference.
3. Compute the SHA-256 hash of the exact current `SCRIPT-DRAFT.json` bytes.
4. Create `SCRIPT-APPROVAL.json` in the project folder:

```json
{
  "projectId": "the-exact-project-id",
  "status": "approved_for_recording",
  "approvedBy": "Human editor name",
  "approvedAt": "2026-11-08T18:00:00.000Z",
  "draftSha256": "64-character SHA-256 of SCRIPT-DRAFT.json"
}
```

5. Run `PROJECT_ID=<project-id> npm run documentary:prepare-render`. The adapter validates the approval identity, timestamp, exact draft hash, scene/block completeness, eligible claim classifications, source references, precise passage references, and passage-review flags. If any check fails, it exits without creating `script.json`.
6. Only after it succeeds, run the existing manual render workflow.

The adapter maps approved narration blocks to the renderer's expected `title`, `subtitle`, `narration`, `visual_query`, and `visual` scene fields. It does not acquire footage, create polished visual assets, independently verify claims, or grant legal clearance. The SHA-256 value binds approval to one exact draft; any subsequent edit requires a new review and approval.


## Rights-cleared still images and video per scene (v1)

The renderer no longer performs broad Pexels searches or silently treats generic stock footage as story evidence. Instead, supply assets deliberately in the project folder and bind each approved asset to a scene.

1. Place image/video files under `production/projects/<project-id>/visual-assets/`.
2. Create `visual-assets/approved-assets.json` with this structure:

```json
{
  "projectId": "the-exact-project-id",
  "status": "approved",
  "assets": [
    {
      "id": "ASSET-001",
      "sceneId": "S01",
      "mediaType": "image",
      "filePath": "visual-assets/company-archive-photo.jpg",
      "sourceUrl": "https://example.org/original-item",
      "creator": "Photographer or rights holder",
      "license": "Exact license name and version",
      "licenseEvidence": "URL or repository record proving the grant",
      "territory": "Worldwide",
      "expiry": null,
      "attribution": "Exact required credit",
      "rightsStatus": "cleared",
      "editorialVerification": "approved"
    }
  ]
}
```

3. Run `PROJECT_ID=<project-id> npm run documentary:validate-visuals`. It checks manifest/project status, required rights and provenance fields, expiry, safe project-relative paths, file existence, and media streams/resolution with ffprobe. It writes `VISUAL-ASSETS-READY.json`. A failed validation blocks handoff.
4. Run the approved script handoff. Its generated `script.json` binds each matching scene to its validated asset. The renderer creates a restrained motion treatment for still images and loops/crops video to the narration duration, with the channel's title and evidence overlays.
5. Review `visual-credits.json` and `CREDITS.md` before publication.

Images and videos are not downloaded automatically: a URL is provenance, not permission to download or use. Acquire files only through a source and license that permit the intended use. For documentary evidence, prefer original company archives, regulator filings, court records, official datasets, and licensed editorial archives. For illustrative b-roll, label it as illustrative in the edit and do not imply it depicts the actual company, person, product, place, or event.

If no approved asset is assigned to a scene, the renderer falls back to an original branded motion graphic. This v1 does not yet automate archive discovery, image/video licensing, face/object matching, visual-content verification, or word-level shot synchronization. It uses scene-level assignment and narration-duration conformance.
