import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import Typert from '@deepseek-ai/dsh-typert-registry'
import { createWorkflowHarness } from '../../../workspace/personal-workflow/tests/harness.ts'
import { ids, operation, proposal } from '../../../workspace/personal-workflow/tests/fixture.ts'
import { createSessionTestController } from './test-remote.ts'

it('dispatches plan save, review, read and export through the real Remote gateway', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-remote-'))
  const { ctx } = await createWorkflowHarness(root)
  try {
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(Typert)
    const controller = createSessionTestController(ctx, {
      defaultModelSelection: () => ({ provider: 'fixture', model: 'fixture' }), cwd: root,
    })
    await ctx.plugin(Gateway, {})
    const invoke = (method: string, request?: unknown) => ctx.typertGateway.invoke({ namespace: 'session', method, args: request === undefined ? {} : { request } })
    expect(await invoke('workflowList')).toEqual([])
    const saved = await invoke('workflowSave', proposal())
    expect(saved).toMatchObject({ revision: 1, approval: null })
    expect(await invoke('workflowSave', proposal())).toEqual(saved)
    expect(await invoke('workflowRead', { taskId: ids[0] })).toEqual(saved)
    const approval = { taskId: ids[0], operationId: operation(2), expectedRevision: 1 }
    expect(await invoke('workflowApprove', approval)).toMatchObject({ revision: 1, approval: { operationId: operation(2) } })
    expect(await invoke('workflowExport', { taskId: ids[0] })).toContain('Review: approved')
    await invoke('workflowSave', proposal(3, 1))
    await expect(invoke('workflowApprove', { ...approval, operationId: operation(4) })).rejects.toThrow('revision-conflict')
    expect(controller.workflowList()[0]?.snapshot.approval).toBeNull()
    await expect(invoke('workflowSave', { ...proposal(5, 2), approval: true })).rejects.toThrow()
    expect(controller.workflowRead({ taskId: ids[0]! }).revision).toBe(2)
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
