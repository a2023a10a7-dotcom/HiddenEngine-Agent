import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

declare const process: { env: Record<string, string | undefined> }

const OWNER = 'a2023a10a7-dotcom'
const REPOSITORY = 'HiddenEngine-Agent'
const BRANCH = 'main'
const API = `https://api.github.com/repos/${OWNER}/${REPOSITORY}`
const PROJECT_PATTERN = /^[a-z0-9-]{3,100}$/

type GithubOptions = { method?: string; body?: unknown }

function token(): string | undefined {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN
}

async function github(path: string, options: GithubOptions = {}): Promise<any> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  const accessToken = token()
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'

  const response = await fetch(API + path, {
    method: options.method || 'GET',
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    signal: AbortSignal.timeout(30000),
  })
  const raw = await response.text()
  let payload: any = null
  try { payload = raw ? JSON.parse(raw) : null } catch { payload = { message: raw.slice(0, 500) } }
  if (!response.ok) {
    const detail = typeof payload?.message === 'string' ? payload.message : `HTTP ${response.status}`
    throw new Error(`GitHub request failed (${response.status}): ${detail}`)
  }
  return payload
}

function decodeFile(file: any): string {
  if (!file?.content || file.encoding !== 'base64') throw new Error('GitHub did not return a base64 file.')
  const binary = atob(String(file.content).replace(/\\n/g, ''))
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function renderText(_args: unknown, value: string) {
  return [{ type: 'text' as const, text: value }]
}

function register(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'hiddenengine_list_projects',
    description: 'List documentary projects in the fixed HiddenEngine-Agent GitHub repository. Read-only. Use this before choosing a project ID.',
    parameters: {},
    output: { schema: { type: 'string' }, render: renderText },
    async execute() {
      const entries = await github(`/contents/production/projects?ref=${BRANCH}`)
      const projects = (Array.isArray(entries) ? entries : [])
        .filter((entry: any) => entry.type === 'dir')
        .map((entry: any) => ({ id: entry.name, path: entry.path }))
      return JSON.stringify({ repository: `${OWNER}/${REPOSITORY}`, branch: BRANCH, projects }, null, 2)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'hiddenengine_inspect_project',
    description: 'Inspect a project script and visual-link manifest in the fixed HiddenEngine-Agent repository. Read-only; reports scene and narration counts, never treats links as rights-cleared.',
    parameters: {
      projectId: { type: 'string', required: true, description: 'Exact project folder ID returned by hiddenengine_list_projects.' },
    },
    output: { schema: { type: 'string' }, render: renderText },
    async execute(args) {
      if (!PROJECT_PATTERN.test(args.projectId)) throw new Error('Invalid project ID.')
      const scriptFile = await github(`/contents/production/projects/${args.projectId}/script.json?ref=${BRANCH}`)
      const script = JSON.parse(decodeFile(scriptFile))
      let visualManifest: any = null
      try {
        const file = await github(`/contents/production/projects/${args.projectId}/visual-links.json?ref=${BRANCH}`)
        visualManifest = JSON.parse(decodeFile(file))
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('(404)')) throw error
      }
      const scenes = Array.isArray(script.scenes) ? script.scenes : []
      const words = scenes.reduce((sum: number, scene: any) => sum + String(scene.narration || '').trim().split(/\\s+/).filter(Boolean).length, 0)
      const visualRows = Array.isArray(visualManifest?.scenes) ? visualManifest.scenes : []
      const visualCount = visualRows.reduce((sum: number, scene: any) => sum + (Array.isArray(scene.visuals) ? scene.visuals.length : 0), 0)
      return JSON.stringify({
        projectId: args.projectId,
        title: script.title || args.projectId,
        language: script.language || 'not specified',
        targetDurationMinutes: script.target_duration_minutes || null,
        sceneCount: scenes.length,
        narrationWordCount: words,
        visualLinkManifest: visualManifest ? 'present' : 'not present',
        ownerSuppliedVisualLinks: visualCount,
        rightsStatus: 'NOT VERIFIED BY THIS TOOL — check provenance and license for every asset',
      }, null, 2)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'hiddenengine_render_status',
    description: 'Read recent GitHub Actions documentary-render runs and their state. Read-only. Use after starting a render to check whether MP4 and QA artifacts have been produced.',
    parameters: {},
    output: { schema: { type: 'string' }, render: renderText },
    async execute() {
      const result = await github('/actions/runs?per_page=30')
      const runs = (result.workflow_runs || [])
        .filter((run: any) => String(run.path || '').endsWith('/render-video.yml'))
        .slice(0, 10)
        .map((run: any) => ({
          id: run.id, status: run.status, conclusion: run.conclusion,
          createdAt: run.created_at, url: run.html_url,
        }))
      const latest = runs[0]
      let artifacts: any[] = []
      if (latest?.status === 'completed' && latest?.conclusion === 'success') {
        const data = await github(`/actions/runs/${latest.id}/artifacts`)
        artifacts = (data.artifacts || []).map((item: any) => ({
          name: item.name, expired: item.expired, sizeInBytes: item.size_in_bytes,
        }))
      }
      return JSON.stringify({ runs, latestSuccessfulRunArtifacts: artifacts }, null, 2)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'hiddenengine_start_render',
    description: 'Dispatch the existing GitHub Actions renderer for a project. This is an external write action that consumes CI minutes and may download assets. Call ONLY after the user explicitly approves rendering in the current session and supplies approvalPhrase exactly as APPROVE_RENDER. Requires GITHUB_TOKEN or GH_TOKEN with Actions write and repository Contents read permissions. Never publish to YouTube.',
    parameters: {
      projectId: { type: 'string', required: true, description: 'Exact project folder ID.' },
      approvalPhrase: { type: 'string', required: true, description: 'Must be exactly APPROVE_RENDER, supplied by the user in the current session.' },
    },
    output: { schema: { type: 'string' }, render: renderText },
    async execute(args) {
      if (args.approvalPhrase !== 'APPROVE_RENDER') throw new Error('Render blocked: the user must explicitly approve with APPROVE_RENDER.')
      if (!PROJECT_PATTERN.test(args.projectId)) throw new Error('Invalid project ID.')
      if (!token()) throw new Error('Set GITHUB_TOKEN or GH_TOKEN in the Harness host environment with Actions write and repository Contents read permissions.')
      const scriptFile = await github(`/contents/production/projects/${args.projectId}/script.json?ref=${BRANCH}`)
      const script = JSON.parse(decodeFile(scriptFile))
      if (!Array.isArray(script.scenes) || script.scenes.length < 5) throw new Error('Render blocked: project script is missing or has fewer than five scenes.')
      await github('/actions/workflows/render-video.yml/dispatches', {
        method: 'POST',
        body: {
          ref: BRANCH,
          inputs: {
            project_id: args.projectId,
            voice_model: 'en_US-lessac-medium',
            speaking_rate: '1.0',
          },
        },
      })
      return JSON.stringify({
        accepted: true,
        projectId: args.projectId,
        workflow: 'HiddenEngine Cinematic Documentary Render',
        branch: BRANCH,
        nextStep: 'Call hiddenengine_render_status until the workflow completes. A successful dispatch is not proof that an MP4 exists; verify the artifact and QA report.',
        publication: 'Not performed. YouTube publishing is deliberately outside this integration.',
      }, null, 2)
    },
  }))
}

export const name = 'hiddenengine-production-tools'
export const inject = ['tools']

export function apply(ctx: Context): void {
  register(ctx)
}
