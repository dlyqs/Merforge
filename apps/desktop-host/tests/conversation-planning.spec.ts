/** Normal-mode conversation sends through real planning tools, assignment and CSV delivery. */
import { it } from 'vitest'
import { kit } from './conversation-planning-source-kit.ts'
import { planningScenario } from './conversation-planning-fixture.mjs'
it('sends a complex goal, adjusts its plan, confirms assignment, opens employee conversations and delivers verified CSV after rework', async () => {
  await planningScenario(kit)
}, 90000)
