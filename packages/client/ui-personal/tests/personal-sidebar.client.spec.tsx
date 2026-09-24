// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { BotId, BotProfile, Project, ProjectId } from '@deepseek-ai/dsh-personal-project/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PersonalSidebarProps } from '../src/client/contract.ts'
import { PersonalSidebar } from '../src/client/PersonalSidebar.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const projectA = 'project-a' as ProjectId
const projectB = 'project-b' as ProjectId
const botA = 'bot-a' as BotId
const sessionId = 'conversation' as SessionId
const date = '2026-01-01T00:00:00.000Z'
const project = (id: ProjectId, name: string): Project => ({ id, name, description: '', createdAt: date, updatedAt: date })
const bot: BotProfile = { id: botA, name: 'Reviewer', identity: 'Review', direction: '', createdAt: date, updatedAt: date }
const summary: SessionSummary = {
  id: sessionId, displayTitle: 'Conversation', running: true, blank: false, updatedAt: 1, retainedBy: {},
  projectionValues: { personalAffiliation: {
    current: { projectId: projectA, botId: botA },
    history: [{ from: {}, to: { project: { id: projectA, name: 'Alpha' }, bot: { id: botA, name: 'Reviewer' } }, source: 'create', seq: 1, time: 1 }],
  } },
}
const list: SessionListState = {
  ids: [sessionId], byId: { [sessionId]: summary }, phase: 'ready', projectionsBySession: {},
}
const workspaces: WorkspaceSnapshot = {
  items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null,
}
const statuses: SessionStatusSnapshot = new Map([[sessionId, {
  running: true, pendingInteraction: undefined, completionUnread: false,
}]])
function hook<T>(value: T) {
  return function select<S>(selector: (state: T) => S): S { return selector(value) }
}
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })

function mount(sessionList: SessionListState = list) {
  const openSession = vi.fn()
  const moveSession = vi.fn(async () => {})
  const createSession = vi.fn(async () => sessionId)
  const createProject = vi.fn(async () => {})
  const pickDirectory = vi.fn(async () => '/tmp/picked-project')
  const props: PersonalSidebarProps = {
    renderSlot: () => null, renderSlotChain: () => null, SessionProvider: ({ children }) => children,
    wide: true, expandSidebar: vi.fn(),
    useSessions: hook(sessionList), useSessionStatus: hook(statuses), useWorkspaces: hook(workspaces),
    useSessionRetainInfo: () => undefined, useResource, usePanelInfo,
    useRecords: hook({ phase: 'ready' as const, projects: [project(projectA, 'Alpha'), project(projectB, 'Beta')], bots: [bot] }),
    refresh: vi.fn(async () => {}), createProject, updateProject: vi.fn(async () => {}),
    pickDirectory,
    deleteProject: vi.fn(async () => {}), createBot: vi.fn(async () => {}), updateBot: vi.fn(async () => {}),
    deleteBot: vi.fn(async () => {}), createSession, moveSession,
    refreshAffiliation: vi.fn(async () => {}), openSession, unarchiveSession: vi.fn(async () => {}),
    t: makeTranslate(zh, commonZh),
  }
  render(<PersonalSidebar {...props} />)
  return { openSession, moveSession, createSession, createProject, pickDirectory }
}

describe('personal sidebar', () => {
  it('shows Project and Bot as direct sidebar sections without a personal group toggle', () => {
    mount()
    expect(screen.getByText(zh.projects)).toBeTruthy()
    expect(screen.getByText(zh.bots)).toBeTruthy()
    expect(screen.queryByRole('button', { name: zh.expand })).toBeNull()
    expect(screen.queryByRole('button', { name: zh.collapse })).toBeNull()
  })

  it('does not create an ungrouped section for a blank ordinary conversation', () => {
    mount({ ...list, byId: { [sessionId]: {
      ...summary, blank: true, projectionValues: { personalAffiliation: { current: {}, history: [] } },
    } } })
    expect(screen.queryByRole('button', { name: zh.unassigned })).toBeNull()
  })

  it('keeps nonempty ordinary conversations accessible with one stable action container', async () => {
    mount({ ...list, byId: { [sessionId]: {
      ...summary, projectionValues: { personalAffiliation: { current: {}, history: [] } },
    } } })
    const group = screen.getByRole('button', { name: zh.unassigned })
    fireEvent.click(group)
    expect(group.getAttribute('aria-expanded')).toBe('true')
    const row = screen.getByRole('button', { name: 'Conversation · 进行中' }).parentElement
    expect(row).not.toBeNull()
    const action = within(row as HTMLElement).getByRole('button', { name: zh.manageSession })
    const container = action.parentElement
    expect(container).not.toBe(row)
    expect(within(container as HTMLElement).getAllByRole('button')).toHaveLength(1)
    fireEvent.mouseEnter(action)
    await waitFor(() => { expect(screen.getByRole('tooltip')).toBeTruthy() })
    expect(action.parentElement).toBe(container)
    expect(within(row as HTMLElement).getAllByRole('button')).toHaveLength(2)
    fireEvent.mouseLeave(action)
    fireEvent.click(action)
    expect(screen.getByRole('dialog', { name: zh.manageSession })).toBeTruthy()
  })

  it('opens one Session from both entrances with the same live state and history', () => {
    const { openSession } = mount()
    fireEvent.click(screen.getByRole('button', { name: `Alpha · ${zh.dropProject}` }))
    fireEvent.click(screen.getByRole('button', { name: 'Conversation · 进行中' }))
    expect(openSession).toHaveBeenCalledWith(sessionId)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh.manageSession }))
    expect(screen.getByText(/Alpha \/ Reviewer/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh.close }))
    fireEvent.click(screen.getByRole('button', { name: `Reviewer · ${zh.dropBot}` }))
    fireEvent.click(screen.getByRole('button', { name: 'Conversation · 进行中' }))
    expect(openSession).toHaveBeenNthCalledWith(2, sessionId)
  })

  it('creates an ordinary Project conversation and moves the same Session to another Project', async () => {
    const { createSession, moveSession } = mount()
    fireEvent.click(screen.getByRole('button', { name: `Alpha · ${zh.dropProject}` }))
    expect(screen.queryByLabelText(zh.newWithBot)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: `${zh.newSession} Alpha` }))
    const dialog = screen.getByRole('dialog', { name: zh.newSession })
    expect(screen.getByRole('region', { name: zh.section }).contains(dialog)).toBe(false)
    fireEvent.click(within(dialog).getByRole('button', { name: zh.newSession }))
    expect(createSession).toHaveBeenCalledWith({ projectId: projectA })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    fireEvent.click(screen.getByRole('button', { name: 'Conversation · 进行中' }))
    fireEvent.click(screen.getByRole('button', { name: zh.manageSession }))
    fireEvent.change(screen.getByLabelText(zh.moveProject), { target: { value: projectB } })
    expect(moveSession).toHaveBeenCalledWith({ sessionId, projectId: projectB })
  })

  it('drops a Bot conversation into a Project using its existing Session ID', () => {
    const { moveSession } = mount()
    fireEvent.click(screen.getByRole('button', { name: `Reviewer · ${zh.dropBot}` }))
    const row = screen.getByRole('button', { name: 'Conversation · 进行中' }).parentElement
    const setData = vi.fn()
    expect(row).not.toBeNull()
    fireEvent.dragStart(row as HTMLElement, { dataTransfer: { setData, effectAllowed: 'move' } })
    expect(setData).toHaveBeenCalledWith('application/x-dsh-personal-session', sessionId)
    const target = screen.getByRole('button', { name: `Beta · ${zh.dropProject}` }).parentElement
    expect(target).not.toBeNull()
    fireEvent.drop(target as HTMLElement, { dataTransfer: { getData: () => sessionId, dropEffect: 'move' } })
    expect(moveSession).toHaveBeenCalledWith({ sessionId, projectId: projectB })
  })

  it('opens Project and Bot editors through More menus outside the sidebar', () => {
    mount()
    for (const [name, title] of [['Alpha', zh.editProject], ['Reviewer', zh.editBot]]) {
      fireEvent.click(screen.getByRole('button', { name: `${zh.more} ${name}` }))
      fireEvent.click(screen.getByRole('menuitem', { name: zh.edit }))
      const dialog = screen.getByRole('dialog', { name: title })
      expect(screen.getByRole('region', { name: zh.section }).contains(dialog)).toBe(false)
      expect(within(dialog).getByLabelText<HTMLInputElement>(zh.name).value).toBe(name)
      fireEvent.click(within(dialog).getByRole('button', { name: zh.cancel }))
      expect(screen.queryByRole('dialog')).toBeNull()
    }
  })

  it('saves the picked directory directly on a new Project', async () => {
    const { createProject, pickDirectory } = mount()
    fireEvent.click(screen.getByRole('button', { name: zh.addProject }))
    fireEvent.change(screen.getByLabelText(zh.name), { target: { value: 'New project' } })
    fireEvent.click(screen.getByRole('button', { name: zh.chooseDirectory }))
    await waitFor(() => { expect(pickDirectory).toHaveBeenCalledOnce() })
    await waitFor(() => { expect(screen.getByPlaceholderText<HTMLInputElement>(zh.noDirectory).value).toBe('/tmp/picked-project') })
    fireEvent.click(screen.getByRole('button', { name: zh.save }))
    await waitFor(() => { expect(createProject).toHaveBeenCalledWith({ name: 'New project', description: '', path: '/tmp/picked-project' }) })
  })
})
