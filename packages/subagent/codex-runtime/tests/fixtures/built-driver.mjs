/** Exercise published Host libraries with an offline OS-process protocol fixture. */
import { writeFileSync, copyFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
const { openCodexRuntime } = await import(process.argv[2])
const fixture = process.argv[3]
const root = process.argv[4]
const localCli = join(root, process.platform === 'win32' ? 'codex.exe' : 'codex')
copyFileSync(process.execPath, localCli)
chmodSync(localCli, 0o700)
const ctx = new Context()
await ctx.plugin(LocalSubprocessRuntime)
const children = []
try {
  const spec = { cwd: root, env: { PATH: root, HOME: root, CODEX_HOME: root, FIXTURE_EXPLICIT: 'retained' }, experimentalApi: true,
    limits: { startupTimeoutMs: 5000, rpcTimeoutMs: 1000, turnTimeoutMs: 1000, interruptTimeoutMs: 100,
      disposeGraceMs: 10, maxFrameBytes: 65536, maxEarlyEvents: 10, maxTurnBytes: 65536,
      humanTimeoutMs: 1000, modelCacheMs: 100, modelPageSize: 10, maxModelPages: 2 },
    spawn: spec => {
      const child = ctx.subprocess.spawn({ ...spec, argv: [process.execPath, fixture] })
      children.push(child)
      return child
    } }
  const runtime = await openCodexRuntime(spec)
  let id
  let completed
  try {
    id = (await runtime.startThread({ mode: 'native', model: 'fixture', effort: 'medium' })).id
    const receipt = await runtime.send({ inputId: 'built-input', texts: ['built-round'], persistIntent: async intent => {
      writeFileSync(join(root, 'intent.json'), JSON.stringify(intent), { mode: 0o600 })
    } })
    completed = (await receipt.terminal).status
  } finally { await runtime.dispose() }
  const reopened = await openCodexRuntime(spec)
  let turns
  try {
    turns = (await reopened.resumeThread(id, { mode: 'native', model: 'fixture', effort: 'medium' })).turns.length
  } finally { await reopened.dispose() }
  const exited = await Promise.all(children.map(child => child.waitForExit()))
  await Promise.all(children.map(child => child.done))
  process.stdout.write(JSON.stringify({ id, completed, turns, exited }))
} finally { await ctx.fiber.dispose() }
