/** Real-model two-identity delivery lane; no windows and no preseeded task tree. */
import { it } from 'vitest'
import { executionModelSchema } from '@deepseek-ai/dsh-organization/execution'
import { kit } from '../../desktop-host/tests/conversation-planning-source-kit.ts'
import { liveDeliveryScenario } from '../../desktop-host/tests/conversation-delivery-fixture.mjs'

it.skipIf(!process.env.DEEPSEEK_API_KEY)('plans two required artifacts, waits for a person, reworks a rejected draft and confirms independently verified delivery', async () => {
  const base = (process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/anthropic').replace(/\/$/, '')
  const selection = executionModelSchema.parse({ model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
    endpoint: base.endsWith('/v1') ? base : `${base}/v1` })
  const route = { ...selection, credential: 'DEEPSEEK_API_KEY', maxTokens: 8192,
    contextWindow: 1000000, idleTimeoutMs: 60000 }
  await liveDeliveryScenario({ ...kit, planningRoute: route, liveRoute: route })
}, 600000)
