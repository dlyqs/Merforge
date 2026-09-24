/** Recover a committed Session generation through the Desktop Host composition without opening a browser. */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { launchWebScaffold, seedSession } from '../../apps/web/tests/scaffold.ts'

const sessionFixture = fileURLToPath(new URL('../web/message-feedback-protocol/session.v3.jsonl', import.meta.url))
const desktopPatch = fileURLToPath(new URL('../../apps/desktop-host/desktop.patch.yml', import.meta.url))

describe('Desktop Host recorded Session recovery', () => {
  it('reconstructs the model answer and durable event order from the committed Session', async () => {
    const scaffold = await launchWebScaffold({ extraOverlayPath: desktopPatch })
    try {
      const id = await seedSession(scaffold, await readFile(sessionFixture, 'utf8'), 'desktop-recovery')
      const resolved = await scaffold.ctx.sessionController.resolveAgent(id)
      if ('error' in resolved) throw resolved.error
      expect(resolved.agent.session.snapshotEvents().map(event => event.type)).toEqual([
        'turn/start', 'user/message', 'step/start', 'assistant/message', 'step/end', 'turn/end',
        'session/end-seed', 'permission/preset', 'sandbox/mode', 'approval/policy',
      ])
      expect(resolved.agent.session.deriveMessages().map(message => ({
        role: message.role,
        text: message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join(''),
      }))).toEqual([
        { role: 'user', text: 'Give one useful answer.' },
        { role: 'assistant', text: 'A useful answer.' },
      ])
    } finally {
      await scaffold.close()
    }
  })
})
