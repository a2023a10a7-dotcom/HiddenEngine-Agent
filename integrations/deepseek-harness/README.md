# DeepSeek Harness integration

This integration adds a small, guarded GitHub toolset to DeepSeek Harness. It is an orchestration layer, not a replacement renderer.

## Why this architecture

- The existing HiddenEngine repository already contains research, evidence-audit, script, visual-direction, and rendering components.
- DeepSeek Harness is in developer preview and its plugin APIs can change. Keeping it outside the production runtime avoids coupling the video renderer to a moving dependency.
- The plugin is pinned to this repository and branch. It exposes read-only discovery/status tools plus one guarded render-dispatch tool.
- YouTube publishing is intentionally not exposed.

## Requirements

- Node.js 20+
- A computer or server where DeepSeek Harness can run
- A model provider configured in Harness under **Settings → Models** (DeepSeek API or another supported provider)
- For rendering from Harness: a GitHub fine-grained personal access token supplied as `GITHUB_TOKEN` or `GH_TOKEN`, restricted to this repository, with **Contents: Read** and **Actions: Read and write**. Never commit the token.

The public repository can be inspected without a token. The token is needed only for dispatching GitHub Actions.

## Launch

From the repository root:

```bash
npm run harness
```

Or:

```bash
bash integrations/deepseek-harness/launch.sh
```

The launcher creates a temporary Cordis overlay with the absolute plugin path and starts the official Harness Web UI. It does not install Harness as a permanent dependency of the video renderer.

After the UI opens:
1. Add this repository folder as the Harness workspace.
2. Configure a model in **Settings → Models**.
3. Open `integrations/deepseek-harness/OPERATING-PLAYBOOK.md` and ask the Executive Producer agent to follow it.
4. Use `hiddenengine_list_projects` and `hiddenengine_inspect_project` to inspect the project before work.

## Available tools

| Tool | Permission | Purpose |
|---|---|---|
| `hiddenengine_list_projects` | Read-only | List project folders |
| `hiddenengine_inspect_project` | Read-only | Read scene count, narration length, and visual-link metadata |
| `hiddenengine_render_status` | Read-only | Read recent renderer runs and artifacts |
| `hiddenengine_start_render` | GitHub write | Dispatch the existing renderer after exact user approval |

To start a render, the user must explicitly approve in the current Harness session and the tool must receive `approvalPhrase: "APPROVE_RENDER"`. This is an additional guard, not a substitute for GitHub permissions.

## Important limitations

- Harness is currently in developer preview; breaking changes are possible.
- The toolset dispatches the existing renderer. It does not yet make every production stage autonomous.
- The project owner must configure the model provider and GitHub token on the machine running Harness.
- The plugin does not upload to YouTube, grant media rights, or guarantee that a source is accurate.
- Do not use the older `production-sequence.yml` workflow until its referenced compile/gate scripts have been implemented and validated.

## Validation

The `DeepSeek Harness Integration Validation` GitHub Actions workflow checks the TypeScript plugin syntax and launcher shell syntax on changes to this integration.
