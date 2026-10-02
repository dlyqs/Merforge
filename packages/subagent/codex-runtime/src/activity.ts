/** Process-local admission shared by every Merforge-owned Codex consumer. */
let executions = 0
let login = false
/**
 * Reserve native execution or login before any asynchronous preparation.
 * @param kind - execution includes personal, organization and one-shot children.
 * @returns idempotent release, called only after owned child/callback quiescence.
 */
export function acquireCodexActivity(kind: 'execution' | 'login'): () => void {
  if (login || (kind === 'login' && executions > 0)) throw new Error('codex-setup: busy')
  if (kind === 'login') login = true
  else executions++
  let released = false
  return () => {
    if (released) return
    released = true
    if (kind === 'login') login = false
    else executions--
  }
}
