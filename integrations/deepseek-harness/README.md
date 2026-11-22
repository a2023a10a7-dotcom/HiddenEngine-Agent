# DeepSeek Harness integration

This integration adds a small, guarded GitHub toolset to DeepSeek Harness. It is an orchestration layer, not a replacement renderer.

## Why this architecture

- The existing HiddenEngine repository already contains research, evidence-audit, script, visual-direction, and rendering components.
- DeepSeek Harness is in developer preview and its plugin APIs can change. Keeping it outside the production runtime avoids coupling the video renderer to a moving dependency.
- The plugin is pinned to this repository and branch. It exposes read-only discovery/status tools plus one guarded render-dispatch tool.
- YouTube publishing is intentionally not exposed.

## Requirements

- Node.js 24.22.3+ (24.x) or 26.13.1+; this follows the pinned DeepSeek Harness source runtime
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

The launcher clones the official DeepSeek Harness source at a pinned commit into a separate cache directory, installs its pinned pnpm dependencies, builds it, copies the plugin into the Harness workspace (so its Cordis imports resolve correctly), creates a temporary Cordis overlay, and starts the Web UI. The first run is a substantial install/build and may take several minutes. Harness is not added to the video renderer's runtime dependencies.

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
- The project owner must configure the model provider and, for render dispatch, a GitHub token on the machine running Harness. The launcher requires a supported Node version and internet access to clone/build the pinned Harness source.
- The plugin does not upload to YouTube, grant media rights, or guarantee that a source is accurate.
- Do not use the older `production-sequence.yml` workflow until its referenced compile/gate scripts have been implemented and validated.

## Validation

The `DeepSeek Harness Integration Validation` GitHub Actions workflow checks TypeScript and shell syntax, installs/builds the pinned official Harness source, and smoke-tests that Harness loads the HiddenEngine plugin and registers its four tools.


## Pinned upstream runtime

- Repository: https://github.com/deepseek-ai/deepseek-harness
- Branch at selection: `master`
- Commit: `4b399c39a6d1479cd84ca591b4d7c88e24d38a96`
- Root package declares pnpm `11.28.5` and Node.js `24.22.3+` in the 24.x line or `26.13.1+`.
- To upgrade, update the pinned commit in both `launch.sh` and the validation workflow, then pass the full smoke test before merging.
