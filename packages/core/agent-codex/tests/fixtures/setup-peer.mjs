/** Deterministic external Codex peer; only the test-owned directory is read. */
import { existsSync, readFileSync, writeFileSync, appendFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
const root = process.env.CODEX_HOME
const mode = JSON.parse(readFileSync(join(root, 'setup-mode.json'), 'utf8'))
const auth = join(root, 'fixture-auth.json'), command = join(root, 'fixture-command.json')
const write = frame => process.stdout.write(`${JSON.stringify(frame)}\n`)
const notify = (loginId, success) => write({ method: 'account/login/completed', params: { ...(loginId === undefined ? {} : { loginId }), success, error: 'fixture-private-error' } })
const loginId = 'current-native-login'
const model = { id: 'fixture', model: 'fixture', displayName: 'Fixture', hidden: false, isDefault: true,
  defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }] }
const authenticate = () => writeFileSync(auth, 'fixture-account', { mode: 0o600 })
if (mode.authenticated) authenticate()
createInterface({ input: process.stdin }).on('line', line => {
  const { id, method } = JSON.parse(line)
  if (id === undefined) return
  appendFileSync(join(root, 'calls.jsonl'), JSON.stringify(method) + '\n', { mode: 0o600 })
  let result
  switch (method) {
    case 'initialize': result = { userAgent: 'codex-cli 0.153.4', platformFamily: 'unix', platformOs: 'fixture', codexHome: '/fixture-private-home' }; break
    case 'account/read': result = { account: existsSync(auth) ? { type: 'chatgpt', email: 'fixture-private-email', planType: 'pro', token: 'fixture-private-token' } : null, requiresOpenaiAuth: !mode.noAuth }; break
    case 'model/list':
      if (mode.catalogFailure) { write({ id, error: { code: 5, message: 'fixture-private-error' } }); return }
      result = { data: mode.empty ? [] : [model], nextCursor: null }; break
    case 'account/login/start':
      if (mode.unknown) { process.stdout.end(); return }
      if (mode.early) { authenticate(); notify(loginId, true) }
      result = { type: 'chatgptDeviceCode', loginId, userCode: 'FIXTURE-PRIVATE-CODE', verificationUrl: mode.badUrl ? 'https://evil.test/codex/device' : 'https://auth.openai.com/codex/device' }; break
    case 'account/login/cancel':
      if (mode.cancelFailure) { write({ id, error: { code: 5, message: 'fixture-private-error' } }); return }
      result = { status: mode.notFound ? 'notFound' : 'canceled' }; break
    default: throw new Error('Unexpected execution request in setup peer')
  }
  write({ id, result })
})
setInterval(() => {
  if (!existsSync(command)) return
  const action = JSON.parse(readFileSync(command, 'utf8')); unlinkSync(command)
  if (action.auth) authenticate()
  if (action.kind === 'eof') { process.stdout.end(); return }
  notify(action.kind === 'old' ? 'old-native-login' : action.kind === 'idless' ? undefined : loginId, action.success ?? true)
}, 10)
