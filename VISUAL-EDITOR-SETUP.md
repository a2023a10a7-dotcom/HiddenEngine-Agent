# Owner-controlled visual selection

## What it does

Open the deployed service at `/visuals.html`. Enter a project folder ID, load its scenes, paste one or more direct HTTPS image URLs into every scene, optionally add creator/license details, and save. The editor writes `visual-links.json` to that project on the `main` branch. A push then starts the render workflow, which imports the saved URLs and uses them as the visual assets.

## Required hosting environment variables

Configure these on the Render web service (never commit their values):

- `GITHUB_TOKEN`: a fine-grained GitHub token with Contents read/write permission for this repository.
- `GITHUB_REPOSITORY`: `a2023a10a7-dotcom/HiddenEngine-Agent` (optional; this is the default).
- `GITHUB_BRANCH`: `main` (optional; this is the default).
- `EDITOR_PASSWORD`: a long, unique password for the visual editor.

After saving the variables, redeploy/restart the Render service.

## Link requirements

Use direct HTTPS image-file URLs, not a page URL such as a photo gallery or search result. The renderer checks that the URL returns an image MIME type. Each image should be publicly downloadable by GitHub Actions. Add the creator and exact license details where known; a URL alone does not establish permission to reuse an image.

All scenes must have at least one image URL. Several URLs per scene are supported. The renderer does not automatically replace owner-selected links with AI-selected stock images.

## Render result

A save creates a Git commit and triggers the GitHub Actions workflow `HiddenEngine Cinematic Documentary Render`. When it completes, download the MP4 and QA/credits files from that workflow run's Artifacts section. The workflow still applies the existing technical duration and scene QA gates.
