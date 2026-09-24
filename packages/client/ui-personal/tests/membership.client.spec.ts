import { describe, expect, it } from 'vitest'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { BotId, ProjectId } from '@deepseek-ai/dsh-personal-project/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { memberIds, unassignedIds } from '../src/client/membership.ts'

const projectA = 'project-a' as ProjectId
const projectB = 'project-b' as ProjectId
const botA = 'bot-a' as BotId
const botB = 'bot-b' as BotId
const first = 'first' as SessionId
const second = 'second' as SessionId

function summary(id: SessionId, projectId?: ProjectId, botId?: BotId): SessionSummary {
  return {
    id, displayTitle: id, running: false, blank: false, updatedAt: 1, retainedBy: {},
    projectionValues: { personalAffiliation: {
      current: { projectId, botId }, history: [],
    } },
  }
}

function catalog(rows: readonly SessionSummary[]): SessionListState {
  return {
    ids: rows.map(row => row.id), byId: Object.fromEntries(rows.map(row => [row.id, row])),
    phase: 'ready', projectionsBySession: {},
  }
}

describe('personal entrance membership', () => {
  it('indexes the same Session under its current Project and Bot', () => {
    const list = catalog([summary(first, projectA, botA), summary(second, projectA)])
    expect(memberIds(list, { kind: 'project', id: projectA })).toEqual([first, second])
    expect(memberIds(list, { kind: 'bot', id: botA })).toEqual([first])
  })

  it('uses the updated projection after moves without changing Session identity or status', () => {
    const before = catalog([summary(first, projectA, botA)])
    const after = catalog([{ ...summary(first, projectB, botB), running: true }])
    expect(memberIds(before, { kind: 'project', id: projectA })).toEqual([first])
    expect(memberIds(after, { kind: 'project', id: projectA })).toEqual([])
    expect(memberIds(after, { kind: 'project', id: projectB })).toEqual([first])
    expect(memberIds(after, { kind: 'bot', id: botB })).toEqual([first])
    expect(after.byId[first]?.running).toBe(true)
  })

  it('hides empty ordinary drafts and pending affiliations from the virtual group', () => {
    expect(unassignedIds(catalog([{ ...summary(first), blank: true }]))).toEqual([])
    expect(unassignedIds(catalog([{ ...summary(first), projectionValues: {} }]))).toEqual([])
    expect(unassignedIds(catalog([summary(first)]))).toEqual([first])
    expect(unassignedIds(catalog([summary(first, projectA), summary(second, undefined, botA)]))).toEqual([])
  })

  it('keeps a deleted object’s former Session discoverable from its event history', () => {
    const old = summary(first)
    const afterDelete = catalog([{
      ...old,
      projectionValues: { personalAffiliation: {
        current: {},
        history: [{
          from: { project: { id: projectA, name: 'Alpha' } }, to: {}, source: 'delete', seq: 3, time: 3,
        }],
      } },
    }])
    expect(memberIds(afterDelete, { kind: 'project', id: projectA })).toEqual([])
    expect(unassignedIds(afterDelete)).toEqual([first])
  })
})
