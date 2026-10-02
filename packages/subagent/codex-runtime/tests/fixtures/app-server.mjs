/** Offline protocol fixture; it never contacts a model or reads native credentials. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
const path = join(process.env.CODEX_HOME, 'fixture-history.json')
let thread = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
const write = frame => process.stdout.write(`${JSON.stringify(frame)}\n`)
const save = () => writeFileSync(path, JSON.stringify(thread), { mode: 0o600 })
const model = { id: 'fixture', model: 'fixture', displayName: 'Fixture', hidden: false, isDefault: true,
  defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Fixture' }] }
createInterface({ input: process.stdin }).on('line', line => {
  const { id, method, params } = JSON.parse(line)
  if (id === undefined) return
  let result
  switch (method) {
    case 'initialize':
      result = { userAgent: 'codex-cli 0.153.4', platformFamily: 'unix', platformOs: 'fixture', codexHome: process.env.CODEX_HOME }
      break
    case 'account/read': result = { account: null, requiresOpenaiAuth: false }; break
    case 'model/list': result = { data: [model], nextCursor: null }; break
    case 'thread/start':
      thread = { id: 'persistent-fixture', cwd: params.cwd, model: params.model, ephemeral: false,
        cliVersion: '0.153.4', historyMode: 'legacy', turns: [] }
      save(); result = { thread }; break
    case 'thread/read': case 'thread/resume': result = { thread }; break
    case 'turn/start': {
      const turn = { id: `turn-${thread.turns.length + 1}`, status: 'completed', items: [
        { id: `user-${params.clientUserMessageId}`, type: 'userMessage', clientId: params.clientUserMessageId, content: params.input },
        { id: `answer-${params.clientUserMessageId}`, type: 'agentMessage', phase: 'final_answer', text: 'offline fixture answer' },
      ] }
      thread.turns.push(turn); save()
      // Expose only booleans for ambient credential scrubbing evidence.
      writeFileSync(join(process.env.CODEX_HOME, 'fixture-env.json'), JSON.stringify({
        scrubbed: process.env.FIXTURE_SECRET_TOKEN === undefined, explicit: process.env.FIXTURE_EXPLICIT === 'retained',
      }), { mode: 0o600 })
      result = { turn: { ...turn, status: 'inProgress' } }
      write({ id, result })
      write({ method: 'turn/completed', params: { threadId: thread.id, turn } })
      return
    }
    case 'turn/interrupt': result = {}; break
    default: write({ id, error: { code: -32601, message: 'unsupported fixture method' } }); return
  }
  write({ id, result })
})
