// Live-stack check for Run → Mind: a real stagehand agents worker (Ollama
// gpt-oss + the Qwen distill) voicing Trabolta on a fresh server project,
// watched from the editor's Mind page. Opt-in like the co-author spec —
// needs the event server on :7000, its database, Ollama with both models,
// and `uv` for stagehand. Skips itself otherwise.
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, request as pwRequest } from '@playwright/test'

const BASE = 'http://localhost:5173'
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const EXAMPLE = join(REPO, 'core/examples/trapped-in-the-internet')
const SHOTS = process.env.MIND_SHOTS ?? join(REPO, 'editor/test-results/mind')

function loomFiles(dir: string, root = dir): Array<{ path: string; content: string }> {
  const out: Array<{ path: string; content: string }> = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...loomFiles(full, root))
    else if (name.endsWith('.loom')) out.push({ path: relative(root, full), content: readFileSync(full, 'utf8') })
  }
  return out
}

test('the Mind page shows a real worker thinking, and the panel steers it', async ({ browser }) => {
  test.setTimeout(420_000)
  const probe = await pwRequest.newContext({ baseURL: BASE })
  const health = await probe.get('/api/projects').catch(() => null)
  test.skip(health === null || health.status() === 503 || health.status() >= 500, 'event server + database not running')
  const ollama = await probe.get('http://localhost:11434/api/tags').catch(() => null)
  test.skip(ollama === null || !ollama.ok(), 'ollama not running')

  const stamp = Date.now()
  const api = await pwRequest.newContext({ baseURL: BASE })
  const email = `mind-${stamp}@example.test`
  const password = `pw-${stamp}-${Math.random().toString(36).slice(2)}`
  let r = await api.post('/api/auth/sign-up/email', { data: { name: 'Jo Mind', email, password } })
  expect(r.ok(), await r.text()).toBeTruthy()
  r = await api.post('/api/projects', { data: { name: `mind-${stamp}` } })
  expect(r.ok(), await r.text()).toBeTruthy()
  const project = (await r.json()) as { id?: string; project?: { id: string } }
  const pid = project.id ?? project.project!.id
  for (const f of loomFiles(EXAMPLE)) {
    r = await api.put(`/api/projects/${pid}/files`, { data: { path: f.path, content: f.content } })
    expect(r.ok(), `${f.path}: ${await r.text()}`).toBeTruthy()
  }
  r = await api.post(`/api/projects/${pid}/event`, { data: { mode: 'preview' } })
  expect(r.ok(), await r.text()).toBeTruthy()
  const event = (await r.json()).event as { id: string; codes: Record<string, string> }

  // The worker: a scratch config pointing at this event.
  mkdirSync(SHOTS, { recursive: true })
  const yaml = join(SHOTS, `laptop-${stamp}.yaml`)
  writeFileSync(
    yaml,
    `server:
  url: http://127.0.0.1:7000
  event: ${event.id}
  mod_passcode: "${event.codes.mod}"
agents:
  name: smoke-laptop
  llm:
    endpoint: http://localhost:11434/v1
    model: gpt-oss:20b
    reasoning_effort: low
    max_tokens: 1000
    timeout_s: 120
    api: ollama
    keep_alive: 60m
  orchestrator:
    enabled: true
    llm:
      model: tobestyledintro/qwen3.8-9b-distill:q8_0
      temperature: 0.4
      max_tokens: 1200
      api: ollama
      extra: { think: false }
      keep_alive: 60m
    quiet_s: 1.0
    survey_every_s: 0
  state_dir: ${join(SHOTS, `minds-${stamp}`)}
  characters:
    - ${join(EXAMPLE, 'trabolta.persona.md')}
`,
  )
  let worker: ChildProcess | null = spawn('uv', ['run', 'stagehand', 'run', '--config', yaml, '--only', 'agents'], { cwd: join(REPO, 'stagehand'), stdio: ['ignore', 'pipe', 'pipe'] })
  const log: string[] = []
  worker.stdout?.on('data', (d: Buffer) => log.push(d.toString()))
  worker.stderr?.on('data', (d: Buffer) => log.push(d.toString()))
  const stop = () => {
    if (worker !== null) {
      worker.kill('SIGTERM')
      worker = null
    }
  }
  try {
    // Trabolta only talks to programs after the glitch: open the gate.
    r = await api.post(`/e/${event.id}/api/mod/var`, { data: { path: 'Trabolta.glitched', value: 'true' } })
    expect(r.ok(), await r.text()).toBeTruthy()

    const ctx = await browser.newContext({ storageState: await api.storageState(), viewport: { width: 1600, height: 1000 } })
    const page = await ctx.newPage()
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`${BASE}/?project=${pid}`)
    await expect(page.getByTestId('mode-bar')).toBeVisible({ timeout: 30_000 })
    await page.getByTestId('mode-run').click()
    await expect(page.getByTestId('run-stage-status')).toHaveText(/shared rehearsal/, { timeout: 30_000 })
    await page.getByRole('tab', { name: 'Mind' }).click()

    // The worker's first look at the house (a Qwen survey) lands as a brief.
    await expect(page.getByTestId('mind-tab')).toBeVisible({ timeout: 60_000 })
    await expect(page.getByTestId('mind-character')).toHaveText('Trabolta')
    await expect(page.getByTestId('mind-thought-survey').first()).toBeVisible({ timeout: 120_000 })
    await expect(page.getByTestId('mind-arc')).toContainText('lonely grandeur')
    await expect(page.getByTestId('mind-drives')).toContainText('hunger')
    await expect(page.getByTestId('mind-brief')).not.toContainText('None yet', { timeout: 30_000 })
    await page.screenshot({ path: join(SHOTS, '1-after-survey.png'), fullPage: false })

    // A program speaks to him: the voice (gpt-oss) answers; its thought shows up.
    r = await api.post(`/e/${event.id}/api/mod/persona`, { data: { name: 'Ada' } })
    expect(r.ok(), await r.text()).toBeTruthy()
    const ada = ((await r.json()).guest as { id: string }).id
    r = await api.post(`/e/${event.id}/api/mod/say`, { data: { as: ada, channel: 'dm:Trabolta', text: 'Trabolta, I was a nurse before you uploaded me. What is a body for?' } })
    expect(r.ok(), await r.text()).toBeTruthy()
    const voice = page.getByTestId('mind-thought-voice').first()
    await expect(voice).toBeVisible({ timeout: 120_000 })
    await expect(voice).toContainText('with Ada')
    await voice.click()
    await expect(page.getByTestId('mind-thought-detail')).toBeVisible()
    await expect(page.getByTestId('mind-thought-detail')).toContainText('gpt-oss:20b')
    // gpt-oss at effort low still exposes its reasoning through Ollama.
    await expect(page.getByTestId('mind-detail-thinking')).toBeEnabled()
    await page.screenshot({ path: join(SHOTS, '2-voice-reasoning.png') })
    await page.getByTestId('mind-detail-input').click()
    await page.getByRole('button', { name: 'expand' }).click() // the long system prompt folds
    await expect(page.getByTestId('mind-thought-detail')).toContainText('YOUR MIND TONIGHT')
    await page.screenshot({ path: join(SHOTS, '3-voice-input.png') })
    await page.getByRole('button', { name: '← trace' }).click()

    // The reflection follows, with the diff it made and a file on Ada.
    const reflect = page.getByTestId('mind-thought-reflect').first()
    await expect(reflect).toBeVisible({ timeout: 180_000 })
    await expect(page.getByTestId('mind-people')).toContainText('Ada', { timeout: 30_000 })
    await reflect.click()
    await page.getByTestId('mind-detail-diff').click()
    await expect(page.getByTestId('mind-thought-detail')).toContainText('Ada')
    await page.screenshot({ path: join(SHOTS, '4-reflect-diff.png') })
    await page.getByRole('button', { name: '← trace' }).click()

    // The control panel: a nudge reaches the worker and is recorded.
    await page.getByTestId('mind-nudge').fill('Be shaken: you just felt a key turn.')
    await page.getByTestId('mind-nudge').press('Enter')
    await expect(page.getByTestId('mind-thought-control').first()).toContainText('nudge', { timeout: 30_000 })
    await expect(page.getByTestId('mind-whispers')).toContainText('key turn', { timeout: 30_000 })
    await page.screenshot({ path: join(SHOTS, '5-nudge.png') })
    // …and the survey it queued consumes the whisper.
    await expect(page.getByTestId('mind-whispers')).toHaveCount(0, { timeout: 180_000 })

    // The story's own restart resets the mind through the same control path.
    r = await api.post(`/e/${event.id}/api/mod/reset`, { data: {} })
    expect(r.ok()).toBeTruthy()
    await expect(page.getByTestId('mind-thought-reset').first()).toBeVisible({ timeout: 30_000 })
    await page.screenshot({ path: join(SHOTS, '6-after-restart.png') })
    expect(errors, errors.join('\n')).toEqual([])
    await ctx.close()
  } finally {
    stop()
    writeFileSync(join(SHOTS, `worker-${stamp}.log`), log.join(''))
    await api.post(`/api/projects/${pid}/event/end`, { data: {} }).catch(() => null)
  }
})
