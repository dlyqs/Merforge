/** Parent test driver sends production private IPC messages to a real built Loader child. */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

export async function contextChild(executable, root) {
  const child = spawn(executable, ['--expose-internals', fileURLToPath(new URL('./organization-context-host.mjs', import.meta.url)), root], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  })
  const pending = new Map()
  const nonce = randomUUID()
  const exited = new Promise(resolve => child.once('close', resolve))
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error('context child startup timeout')) }, 20000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', () => { clearTimeout(timer); reject(new Error('context child exited')) })
    child.on('message', message => {
      if (message.type === 'ready') { clearTimeout(timer); resolve(); return }
      if (message.nonce !== nonce) return
      const active = pending.get(message.requestId)
      if (!active) return
      if (message.type === 'organization-context-authorize') {
        void active.authorize(message.revision).then(authority => {
          if (child.connected) child.send({ type: 'organization-context-authorized', requestId: message.requestId, nonce, authorizationId: message.authorizationId, authority })
        }, () => {
          if (child.connected) child.send({ type: 'organization-context-authorized', requestId: message.requestId, nonce, authorizationId: message.authorizationId, error: 'denied' })
        })
      } else if (message.type === 'organization-context-result') {
        pending.delete(message.requestId); active.cleanup()
        if (message.result) active.resolve(message.result); else active.reject(new Error(message.error))
      }
    })
  })
  try { await ready } catch (error) { child.kill('SIGKILL'); await exited; throw error }
  return {
    openOrganizationContext(request, authorize, timeoutMs, signal) {
      return new Promise((resolve, reject) => {
        const requestId = randomUUID()
        const cancel = () => { if (child.connected) child.send({ type: 'organization-context-cancel', requestId, nonce }) }
        const timer = setTimeout(() => { cancel(); pending.delete(requestId); signal.removeEventListener('abort', cancel); reject(new Error('context child timeout')) }, timeoutMs + 1000)
        signal.addEventListener('abort', cancel, { once: true })
        pending.set(requestId, { authorize, resolve, reject, cleanup() { clearTimeout(timer); signal.removeEventListener('abort', cancel) } })
        child.send({ type: 'organization-context-open', requestId, nonce, timeoutMs, request })
        if (signal.aborted) cancel()
      })
    },
    async close() {
      if (child.connected) child.send({ type: 'shutdown' })
      const timer = setTimeout(() => { child.kill('SIGKILL') }, 10000)
      const code = await exited; clearTimeout(timer)
      for (const active of pending.values()) { active.cleanup(); active.reject(new Error('context child stopped')) }
      pending.clear()
      if (code !== 0) throw new Error(`context child exited ${code}`)
    },
  }
}
