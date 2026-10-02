/** Source-plane full-chain and fault regressions; no browser or live model. */
import { it } from 'vitest'
import { kit } from './organization-execution-source-kit.ts'
import { executionScenario } from './organization-execution-fixture.mjs'

it('runs CSV through native authorization, human wait, Host reopen, rework, two-child acceptance and target confirmation', async () => {
  await executionScenario(kit)
}, 90000)

it.each(['budget', 'revoked', 'lost-response', 'sleep', 'identity', 'server-restart'])('contains %s across native authorization, tools and cold Host recovery', async (fault) => {
  await executionScenario(kit, undefined, fault)
}, 30000)

it('runs two independent Codex employees through HTTPS scheduling, human Inbox, cold reopen, rework, private transcripts and final integration', async () => {
  await executionScenario({ ...kit, native: true, twoMembers: true })
}, 90000)
