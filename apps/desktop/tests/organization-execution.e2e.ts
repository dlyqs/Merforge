/** Opt-in live organization model smoke, using real native authorization and file consumers without windows. */
import { it } from 'vitest'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import { executionModelSchema } from '@deepseek-ai/dsh-organization/execution'
import { kit } from '../../desktop-host/tests/organization-execution-source-kit.ts'
import { executionScenario } from '../../desktop-host/tests/organization-execution-fixture.mjs'

it.skipIf(!process.env.DEEPSEEK_API_KEY)('writes and reads independently verified CSV through an authorized organization model Run', async () => {
  const base = (process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/anthropic').replace(/\/$/, '')
  const route = executionModelSchema.parse({ model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
    endpoint: base.endsWith('/v1') ? base : `${base}/v1` })
  await executionScenario({ ...kit, Credentials: LocalCredentialProvider, liveRoute: { ...route,
    credential: 'DEEPSEEK_API_KEY', maxTokens: 2048, contextWindow: 65536, idleTimeoutMs: 30000 } })
}, 120000)
