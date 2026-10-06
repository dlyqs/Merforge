/** Shared real Loader/SQLite fixture with accepted leaf output and optional task fan-in. */
import { createHash, randomUUID } from 'node:crypto'
import { setupExecution } from './execution-harness.ts'
import { operationId } from './harness.ts'
export async function dependencyFixture(cleanup: (() => Promise<unknown>)[], tree = false, first: 'left' | 'right' = 'left', inheritDependencies = false) {
  const left = randomUUID(), right = randomUUID(), consumer = randomUUID()
  const h = await setupExecution(cleanup, 10, 'a'.repeat(64), ['model'], tree ? async (h) => {
    const root = h.save.definition.tasks[0]!
    h.save.definition.tasks.push(...[left, right, consumer].map(id => ({ ...root, id, parentTaskId: root.id, required: id !== consumer,
      dependsOn: id === consumer ? [left, right] : [] })))
    if (inheritDependencies) {
      const branchId = randomUUID()
      h.save.definition.tasks.push({ ...root, id: branchId, parentTaskId: root.id, required: false, dependsOn: [left, right] })
      const dependent = h.save.definition.tasks.find(t => t.id === consumer)!
      dependent.parentTaskId = branchId; dependent.dependsOn = []
    }
    await h.service.savePlan(h.owner.token, { ...h.save, operationId: operationId(), expectedRevision: 1 })
    h.approve.planRevision = 2; h.approve.taskId = first === 'left' ? left : right
    for (const id of [left, right, consumer]) await h.service.grantTask(h.owner.token, { ...h.query, taskId: id,
      membershipId: h.other.membershipId, scope: 'node', actions: ['read'], expectedVersion: 0, operationId: operationId() })
  } : undefined)
  const revision = h.approve.planRevision
  const query = { ...h.query, taskId: h.save.definition.taskId, planRevision: revision }
  const readTasks = async (token = h.owner.token) => {
    let items: import('../src/workgraph-types.ts').OrganizationTaskView[] = []
    await h.service.readTasks(token, h.query, (value) => { items = value.items })
    return items
  }
  const publish = async (base: object, path: string, content?: Buffer) => {
    const bytes = content ?? Buffer.from(`name,total\n${path},42\n`), sha256 = createHash('sha256').update(bytes).digest('hex')
    const artifact = await h.service.deliveryCommand(h.other.token, { ...base, kind: 'publish-artifact', operationId: operationId(),
      artifactKind: 'file', path, description: 'CSV', mediaType: 'text/csv', size: bytes.length, sha256, bytes: bytes.toString('base64') })
    const artifactId = artifact.delivery!.artifactId!
    const s = await h.service.deliveryCommand(h.other.token, { ...base, kind: 'submit-delivery', operationId: operationId(),
      artifactIds: [artifactId], summary: 'CSV', target: 'Target CSV', confirmed: true })
    await h.service.deliveryCommand(h.owner.token, { ...base, kind: 'accept-delivery', operationId: operationId(),
      submissionId: s.delivery!.submissionId, artifacts: [{ artifactId, sha256 }], confirmed: true })
    return { path, sha256, size: bytes.length }
  }
  await h.transition('running'); await h.transition('succeeded')
  const file = await publish({ ...h.selector, runId: h.run.runId, planRevision: revision }, `${first}.csv`)
  const prepareTask = async (taskId: string) => {
    const approved = await h.service.assignmentCommand(h.owner.token, { ...h.approve, taskId, operationId: operationId() })
    const selector = { ...h.query, assignmentId: approved.assignmentId }
    await h.service.participantCommand(h.other.token, { ...selector, kind: 'answer-assignment', operationId: operationId(),
      requestId: h.db.prepare('SELECT id FROM assignment_requests WHERE assignmentId=?').get(approved.assignmentId!)?.id,
      expectedVersion: approved.revision, answer: 'accepted' })
    const base = { ...selector, planRevision: revision }
    const granted = await h.execute({ ...base, kind: 'grant-execution', operationId: operationId(),
      capabilities: ['model'], budget: 10, expiresAt: Date.now()+30000, configDigest: 'a'.repeat(64) })
    const create = { ...base, kind: 'create-run', operationId: operationId(), executionDelegationId: granted.execution!.executionDelegationId,
      configDigest: 'a'.repeat(64) }
    return { selector, create }
  }
  return { ...h, left, right, remaining: first === 'left' ? right : left, consumer, query, readTasks, publish, file, prepareTask }
}
