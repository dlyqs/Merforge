/** Owned built Host IPC driver; shutdown and cancellation wait for the child to drain. */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

export async function executionChild(executable, root, native = false) {
  const child = spawn(executable, ['--expose-internals', fileURLToPath(new URL('./organization-execution-host.mjs', import.meta.url)), root, native ? 'codex' : 'api'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  })
  const pending = new Map(), nonce = randomUUID()
  const authorizations = new Set()
  let closed = false
  const exited = new Promise(resolve => child.once('close', code => {
    closed = true
    for (const entry of pending.values()) { entry.cleanup(); entry.reject(new Error(`execution Host exited ${code}`)) }
    pending.clear(); resolve(code)
  }))
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('execution Host startup timeout')), 20000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', () => { clearTimeout(timer); reject(new Error('execution Host exited before ready')) })
    child.on('message', message => {
      if (message.type === 'ready') { clearTimeout(timer); resolve(); return }
      if (message.nonce !== nonce) return
      const entry = pending.get(message.requestId)
      if (!entry) return
      if (message.type === `${entry.prefix}-authorize`) {
        const operation = entry.authorize(entry.prefix === 'organization-context' ? message.revision : message.command).then(authority => {
          if (child.connected && pending.has(message.requestId)) child.send({ type: `${entry.prefix}-authorized`, nonce,
            requestId: message.requestId, authorizationId: message.authorizationId, authority })
        }, () => {
          if (child.connected && pending.has(message.requestId)) child.send({ type: `${entry.prefix}-authorized`, nonce,
            requestId: message.requestId, authorizationId: message.authorizationId, error: 'denied' })
        })
        authorizations.add(operation)
        const settled = () => { authorizations.delete(operation) }
        void operation.then(settled, settled)
      } else if (message.type === `${entry.prefix}-result`) {
        entry.cleanup(); pending.delete(message.requestId)
        if (message.error) entry.reject(new Error(message.error)); else entry.resolve(message.report ?? message.result)
      }
    })
  })
  try { await ready } catch (error) { child.kill('SIGKILL'); await exited; throw error }
  function call(prefix, operation, request, authorize, timeoutMs, signal) {
    if (closed) return Promise.reject(new Error('execution Host closed'))
    return new Promise((resolve, reject) => {
      const requestId = randomUUID()
      const cancel = () => { if (child.connected) child.send({ type: `${prefix}-cancel`, nonce, requestId }) }
      const timer = setTimeout(() => { cancel(); child.kill('SIGKILL') }, timeoutMs + 2000)
      pending.set(requestId, { prefix, authorize, resolve, reject, cleanup() { clearTimeout(timer); signal.removeEventListener('abort', cancel) } })
      signal.addEventListener('abort', cancel, { once: true })
      child.send({ type: `${prefix}-${operation}`, nonce, requestId, request, timeoutMs })
      if (signal.aborted) cancel()
    })
  }
  return {
    openOrganizationContext: (...args) => call('organization-context', 'open', ...args),
    openOrganizationExecution: (...args) => call('organization-execution', 'open', ...args),
    readOrganizationExecution: (...args) => call('organization-execution', 'report', ...args),
    async close() {
      // Parent authorization work can outlive a cancelled Host request.
      await Promise.allSettled([...authorizations])
      if (child.connected) child.send({ type: 'shutdown' })
      const timer = setTimeout(() => child.kill('SIGKILL'), 10000)
      const code = await exited; clearTimeout(timer)
      if (code !== 0) throw new Error(`execution Host exited ${code}`)
    },
  }
}
