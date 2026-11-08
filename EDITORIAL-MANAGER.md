# Editorial Manager v1

## Purpose
Turn the weekly RSS research report into a short, channel-fit editorial shortlist for The Hidden Engine. The manager is a decision-support system, not an autonomous publisher.

## Current behavior
- Reads `reports/research.json`.
- Re-scores stories for company economics, competitive strategy, infrastructure, and consequential technology.
- Penalizes consumer reviews and how-to stories that do not expose a business mechanism.
- Produces up to five RESEARCH candidates, plus a short BACKLOG.
- Writes `reports/manager-report.md` and `reports/manager-report.json`.
- Flags thin coverage and missing primary-source leads rather than calling them verified.

## Schedule
The manager runs on manual dispatch, Sundays at 10:30 UTC, and after a successful `HiddenEngine Weekly Research` workflow. It writes reports only. It does not call ElevenLabs, render video, access YouTube, or publish.

## Human approval gates
A person must approve the story, primary-source research, script, rights, voiceover, render, and publication. Scores are heuristic and must not be presented as predicted views or objective truth.

## Known limitations
- RSS summaries are leads, not full-source research.
- Domain heuristics cannot establish source independence or source quality.
- The current manager does not crawl company filings or competitor channels; it tells the researcher what evidence is missing.
- No private channel analytics are accessed.
