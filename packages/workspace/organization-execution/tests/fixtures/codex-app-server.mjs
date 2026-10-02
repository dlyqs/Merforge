/** Offline native executor fixture; only the subprocess/model peer is scripted. */
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
const root = process.env.MERFORGE_CODEX_FIXTURE
const historyPath = join(root, 'native-history.json')
const threads = existsSync(historyPath) ? JSON.parse(readFileSync(historyPath, 'utf8')) : {}
const save = () => writeFileSync(historyPath, JSON.stringify(threads))
const write = frame => process.stdout.write(`${JSON.stringify(frame)}\n`)
let active
let approvalId
createInterface({ input: process.stdin }).on('line', line => {
  const { id, method, params } = JSON.parse(line)
  if (!method || id === undefined) {
    if (id === approvalId && active && JSON.parse(line).result?.decision === 'accept') {
      writeFileSync(join(active.thread.cwd, 'approved.txt'), 'approved native command')
      active.turn.status = 'completed'; save()
      write({ method: 'turn/completed', params: { threadId: active.thread.id, turn: active.turn } })
    }
    return
  }
  let result
  switch (method) {
    case 'initialize': result = { userAgent: 'codex-cli 0.153.4', platformFamily: 'unix', platformOs: 'fixture', codexHome: root }; break
    case 'account/read': result = { account: { type: 'chatgpt', email: 'NATIVE_PRIVATE_EMAIL', accessToken: 'NATIVE_PRIVATE_TOKEN' }, requiresOpenaiAuth: true }; break
    case 'model/list': result = { data: [{ id: 'scripted-csv', model: 'scripted-csv', displayName: 'Offline native', isDefault: true, hidden: false,
      defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }] }], nextCursor: null }; break
    case 'thread/start': {
      const thread = { id: randomUUID(), cwd: params.cwd, model: params.model, cliVersion: '0.153.4', ephemeral: false, historyMode: 'legacy', turns: [] }
      threads[thread.id] = thread; save(); result = { thread }; break
    }
    case 'thread/read': case 'thread/resume': result = { thread: threads[params.threadId] }; break
    case 'turn/start': {
      const thread = threads[params.threadId], turn = { id: randomUUID(), status: 'inProgress', items: [{ id: randomUUID(), type: 'userMessage', clientId: params.clientUserMessageId, content: params.input }] }
      thread.turns.push(turn); save(); active = { thread, turn }
      const script = JSON.parse(readFileSync(join(root, 'script.json'), 'utf8'))
      if (script[0] === 'lose-acceptance') { turn.status = 'completed'; save(); process.exit(0) }
      write({ id, result: { turn } })
      if (script[0] === 'hang') return
      if (script[0]?.name === 'request_human' || script[0] === 'approval') {
        const approval = script[0] === 'approval'
        approvalId = randomUUID()
        write({ id: approvalId, method: approval ? 'item/commandExecution/requestApproval' : 'item/tool/call', params: {
          threadId: thread.id, turnId: turn.id, ...(approval ? { itemId: randomUUID(), command: 'fixture command', cwd: thread.cwd, startedAtMs: Date.now() }
            : { tool: 'organization_request_human', callId: randomUUID(), arguments: script[0].args }),
        } })
        return
      }
      for (const entry of script) {
        if (entry.name === 'write_file') {
          writeFileSync(join(thread.cwd, entry.args.path), entry.args.content)
          turn.items.push({ id: randomUUID(), type: 'fileChange', status: 'completed', changes: [{ path: entry.args.path }] })
        } else if (entry.name === 'read_file') {
          turn.items.push({ id: randomUUID(), type: 'commandExecution', command: `read ${entry.args.path}`, aggregatedOutput: readFileSync(join(thread.cwd, entry.args.path), 'utf8'), exitCode: 0 })
        } else if (typeof entry === 'string') turn.items.push({ id: randomUUID(), type: 'agentMessage', phase: 'final_answer', text: entry })
      }
      turn.status = 'completed'; save()
      if (script[0] === 'lose-terminal') process.exit(0)
      write({ method: 'turn/completed', params: { threadId: thread.id, turn } })
      return
    }
    case 'turn/interrupt':
      if (active) {
        active.turn.status = 'interrupted'; save()
        write({ method: 'turn/completed', params: { threadId: active.thread.id, turn: active.turn } })
      }
      result = {}; break
    default: write({ id, error: { code: -32601, message: 'fixture method unavailable' } }); return
  }
  write({ id, result })
})
