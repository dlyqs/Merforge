// @vitest-environment jsdom
/** Wheel zoom and fullscreen interactions in a detached DOM. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TaskMap, type TaskMapLabels } from '../src/TaskMap.tsx'
afterEach(() => { cleanup(); vi.restoreAllMocks() })
const labels: TaskMapLabels = { mindMap: 'Task map', mapCount: '1 node', mapControls: 'Controls', zoomOut: 'Zoom out',
  actualSize: 'Actual size', zoomLevel: 'Zoom {percent}%', zoomIn: 'Zoom in', fitMap: 'Fit', locateTask: 'Locate',
  invalidHierarchy: 'Invalid', mapHint: 'Scroll to zoom', rootTask: 'Root', requiredNode: 'Required', optionalNode: 'Optional',
  hierarchyHint: 'Hierarchy', expandAll: 'Expand all', expandBranch: 'Expand {goal}', collapseBranch: 'Collapse {goal}',
  fullscreen: 'Full screen', exitFullscreen: 'Exit full screen', fullscreenFailed: 'Fullscreen unavailable' }
function mount() {
  return render(<TaskMap tasks={[{ id: 'root', parentTaskId: null, goal: 'Task', phaseTitle: '', required: true, status: '', statusLabel: '' }]}
    rootId="root" selected={null} onSelect={() => {}} labels={labels} />)
}
it('zooms on the wheel and consumes scrolling while keeping the zoom bounded', () => {
  mount()
  const viewport = screen.getByRole('region', { name: labels.mapHint })
  Object.defineProperties(viewport, { clientWidth: { value: 100 }, clientHeight: { value: 100 } })
  viewport.scrollLeft = 40; viewport.scrollTop = 30
  const wheel = new WheelEvent('wheel', { deltaY: -120, clientX: 20, clientY: 30, bubbles: true, cancelable: true })
  fireEvent(viewport, wheel)
  expect(wheel.defaultPrevented).toBe(true)
  const scale = Number(viewport.firstElementChild?.getAttribute('style')?.match(/--zoom: ([^;]+)/)?.[1])
  expect((viewport.scrollLeft + 20) / scale).toBeCloseTo(60)
  expect((viewport.scrollTop + 30) / scale).toBeCloseTo(60)
  expect(screen.getByRole('button', { name: 'Zoom 120%' })).toBeTruthy()
  fireEvent.wheel(viewport, { deltaY: -10000 })
  expect(screen.getByRole('button', { name: 'Zoom 150%' })).toBeTruthy()
  fireEvent.wheel(viewport, { deltaY: 10000 })
  expect(screen.getByRole('button', { name: 'Zoom 25%' })).toBeTruthy()
})
it('requests native screen fullscreen and follows native exit events', async () => {
  const view = mount()
  const map = view.container.querySelector('section')!
  let active: Element | null = null
  Object.defineProperty(document, 'fullscreenElement', { get: () => active, configurable: true })
  const request = vi.fn(async () => { active = map; fireEvent(document, new Event('fullscreenchange')) })
  const exit = vi.fn(async () => { active = null; fireEvent(document, new Event('fullscreenchange')) })
  Object.defineProperty(map, 'requestFullscreen', { value: request, configurable: true })
  Object.defineProperty(document, 'exitFullscreen', { value: exit, configurable: true })
  fireEvent.click(screen.getByRole('button', { name: labels.fullscreen }))
  await waitFor(() => expect(view.container.querySelector('[data-fullscreen="true"]')).toBeTruthy())
  expect(request).toHaveBeenCalledOnce()
  expect(screen.getByRole('button', { name: 'Task' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: labels.exitFullscreen }))
  await waitFor(() => expect(exit).toHaveBeenCalledOnce())
  expect(view.container.querySelector('[data-fullscreen="true"]')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: labels.fullscreen }))
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  active = null; fireEvent(document, new Event('fullscreenchange'))
  expect(view.container.querySelector('[data-fullscreen="true"]')).toBeNull()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: labels.fullscreen }))
})
it('reports a refused fullscreen request without claiming fullscreen', async () => {
  const view = mount(), map = view.container.querySelector('section')!
  Object.defineProperty(map, 'requestFullscreen', { value: vi.fn().mockRejectedValue(new Error('denied')), configurable: true })
  fireEvent.click(screen.getByRole('button', { name: labels.fullscreen }))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', labels.fullscreenFailed)
  expect(view.container.querySelector('[data-fullscreen="true"]')).toBeNull()
})
